import WebKit

// ============================================================================
// VideoSchemeHandler - serves scray-video:// (the phone's own video files) to
// the main web view.
//
// Rewritten in native 13.180 for long-session performance. The old handler
// was the likeliest native-side reason Native got sluggish after 15-20
// minutes and only a restart fixed it:
//
//   1. It read the file ON THE MAIN THREAD. WebKit calls start() on main, and
//      the whole requested range was seek+read there before returning. Every
//      buffering request a video makes (dozens per video, constantly while
//      scrubbing) blocked touches, gestures and the scrub for the duration of
//      the disk read. Reads now happen on a background queue.
//
//   2. It read the whole range into ONE Data. A big range meant a big
//      allocation per request. Ranges are now streamed in fixed-size chunks,
//      so memory per request is bounded however large the range.
//
//   3. Open file handles were cached forever - one more for every video ever
//      played, never closed. Now a small most-recently-used set.
//
//   4. Stopped tasks went into a Set keyed by ObjectIdentifier and were never
//      taken out. Besides growing, an identifier is just a memory address:
//      once WebKit freed a stopped task, a NEW request could land at the same
//      address and be silently skipped as "cancelled" - a stall that looked
//      like the video grinding to a halt. Live tasks are now held (strongly,
//      so their address can't be reused) until they finish or are stopped.
//
//   5. Every stopped task (WebKit stops them all the time while seeking)
//      evaluated JavaScript to console.log it. Gone; only failures log.
// ============================================================================

/// Owns the open FileHandles. Used only on the handler's I/O queue. A separate
/// object so queued reads can hold it without keeping the handler alive.
private final class ScrayVideoFileCache {
    struct Entry {
        let handle: FileHandle
        let size: Int64
    }

    /// ⚙️ How many files stay open at once. The playing video, the one being
    /// preloaded / TinEye'd, and a spare.
    static let maxOpen = 3

    private var entries: [String: Entry] = [:]
    private var order: [String] = []   // most recently used last

    func entry(for relativePath: String) -> Entry? {
        if let hit = entries[relativePath] {
            touch(relativePath)
            return hit
        }
        guard let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath),
              let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
            return nil
        }
        let entry = Entry(handle: handle, size: size)
        entries[relativePath] = entry
        touch(relativePath)
        // Evicted handles are only dropped, not closed: a response still
        // streaming from one holds its own reference, and FileHandle closes
        // itself once the last reference goes.
        while order.count > Self.maxOpen {
            entries.removeValue(forKey: order.removeFirst())
        }
        return entry
    }

    private func touch(_ key: String) {
        if let i = order.firstIndex(of: key) { order.remove(at: i) }
        order.append(key)
    }

}

class VideoSchemeHandler: NSObject, WKURLSchemeHandler {
    weak var webView: WKWebView?

    /// ⚙️ Bytes read and handed to WebKit per step of a response.
    private static let chunkBytes = 512 * 1024
    /// ⚙️ First response when WebKit sends no Range header (as before).
    private static let initialChunk: Int64 = 2 * 1024 * 1024

    private let ioQueue = DispatchQueue(label: "scray.video-scheme.io", qos: .userInitiated)
    private let files = ScrayVideoFileCache()

    /// Tasks WebKit has started and not stopped, and that haven't finished.
    /// Main thread only - WebKit calls start/stop on main, and every delivery
    /// back to a task is made on main after checking it is still here, so a
    /// stopped task is never written to.
    private var liveTasks: [ObjectIdentifier: WKURLSchemeTask] = [:]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            log("FAILED: no URL on request")
            task.didFailWithError(NSError(domain: "scray", code: 404))
            return
        }
        let taskId = ObjectIdentifier(task)
        liveTasks[taskId] = task
        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")
        let candidates = candidatePaths(for: url)
        let files = self.files

        ioQueue.async { [weak self] in
            // Resolve + open (or reuse) off the main thread.
            var resolved: (path: String, entry: ScrayVideoFileCache.Entry)?
            for candidate in candidates {
                if let entry = files.entry(for: candidate) { resolved = (candidate, entry); break }
            }
            guard let file = resolved else {
                DispatchQueue.main.async {
                    guard let self = self, self.liveTasks.removeValue(forKey: taskId) != nil else { return }
                    self.log("FAILED: could not resolve/open file for '\(url.path)' - bookmark/folder issue")
                    task.didFailWithError(NSError(domain: "scray", code: 404))
                }
                return
            }

            let fileSize = file.entry.size
            var start: Int64 = 0
            var end: Int64 = max(0, fileSize - 1)
            var statusCode = 200

            if let range = rangeHeader {
                let parts = range.replacingOccurrences(of: "bytes=", with: "")
                    .split(separator: "-", omittingEmptySubsequences: false)
                if let s = parts.first, let sVal = Int64(s) { start = sVal }
                if parts.count > 1, let e = Int64(parts[1]) { end = e }
                statusCode = 206
            } else {
                end = min(fileSize - 1, Self.initialChunk - 1)
                statusCode = fileSize > Self.initialChunk ? 206 : 200
            }
            start = max(0, min(start, max(0, fileSize - 1)))
            end = max(start, min(end, fileSize - 1))
            let length = fileSize > 0 ? end - start + 1 : 0

            var headers = [
                "Content-Type": Self.mimeType(for: file.path),
                "Content-Length": "\(length)",
                "Accept-Ranges": "bytes",
                // TinEye (native 13.179): lets the page copy a frame of a phone
                // copy onto a canvas. The page is file:// and this scheme is a
                // different origin, so without this header a crossorigin video
                // fails and a plain one taints the canvas. These are the user's
                // own files served only to this web view, so '*' grants nothing.
                "Access-Control-Allow-Origin": "*"
            ]
            if statusCode == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(fileSize)" }

            DispatchQueue.main.async {
                guard let self = self, self.liveTasks[taskId] != nil else { return }
                guard let response = HTTPURLResponse(url: url, statusCode: statusCode,
                                                     httpVersion: "HTTP/1.1", headerFields: headers) else {
                    self.liveTasks.removeValue(forKey: taskId)
                    task.didFailWithError(NSError(domain: "scray", code: 500))
                    return
                }
                task.didReceive(response)
                self.streamChunk(task: task, taskId: taskId, handle: file.entry.handle,
                                 offset: start, remaining: length)
            }
        }
    }

    /// Reads the next chunk on the I/O queue and hands it over on main, then
    /// asks for the one after. Stops as soon as WebKit stops the task.
    private func streamChunk(task: WKURLSchemeTask, taskId: ObjectIdentifier,
                             handle: FileHandle, offset: Int64, remaining: Int64) {
        guard remaining > 0 else {
            if liveTasks.removeValue(forKey: taskId) != nil { task.didFinish() }
            return
        }
        let want = Int(min(Int64(Self.chunkBytes), remaining))
        ioQueue.async { [weak self] in
            // Handles are shared between requests; the serial queue keeps each
            // seek+read pair together.
            var data = Data()
            var failed = false
            do {
                try handle.seek(toOffset: UInt64(offset))
                data = try handle.read(upToCount: want) ?? Data()
            } catch {
                failed = true
            }
            DispatchQueue.main.async {
                guard let self = self, self.liveTasks[taskId] != nil else { return }
                if failed || data.isEmpty {
                    // Closed under us (evicted by a newer file) or short read.
                    self.liveTasks.removeValue(forKey: taskId)
                    if failed {
                        task.didFailWithError(NSError(domain: "scray", code: 500))
                    } else {
                        task.didFinish()
                    }
                    return
                }
                task.didReceive(data)
                self.streamChunk(task: task, taskId: taskId, handle: handle,
                                 offset: offset + Int64(data.count),
                                 remaining: remaining - Int64(data.count))
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        liveTasks.removeValue(forKey: ObjectIdentifier(task))
    }

    // A '%' in a filename passes through two encoders on its way here: the
    // JS side percent-encodes it ("50%.mp4" is requested as "50%25.mp4"), and
    // Foundation's `url.path` already decodes it once. Decoding a second time
    // either mangles the name or returns nil on the now-invalid escape
    // sequence. Candidates in order of correctness; the first that opens wins.
    private func candidatePaths(for url: URL) -> [String] {
        var results: [String] = []
        func add(_ value: String?) {
            guard var path = value, !path.isEmpty else { return }
            if path.hasPrefix("/") { path = String(path.dropFirst()) }
            guard !path.isEmpty, !results.contains(path) else { return }
            results.append(path)
        }
        let encodedPath = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath
        add(encodedPath?.removingPercentEncoding)  // decoded exactly once - correct
        add(url.path)                              // Foundation's own single decode
        add(encodedPath)                           // raw, if nothing needed decoding
        return results
    }

    private static func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "mkv": return "video/x-matroska"
        case "avi": return "video/x-msvideo"
        default: return "video/mp4"
        }
    }

    /// Failures only. Main thread.
    private func log(_ message: String) {
        let escaped = message
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
        webView?.evaluateJavaScript("console.log('[VideoScheme] \(escaped)');")
    }
}
