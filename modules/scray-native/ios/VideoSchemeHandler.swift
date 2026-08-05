import WebKit

class VideoSchemeHandler: NSObject, WKURLSchemeHandler {
    weak var webView: WKWebView?
    private var cancelledTasks = Set<ObjectIdentifier>()
    private let lock = NSLock()

    // ✅ PERFORMANCE: WebKit issues MANY range requests while streaming a
    // local file (not just during scrubbing - normal buffering does this
    // constantly too). Previously every single request opened a fresh
    // FileHandle and ran a stat() call via FileManager.attributesOfItem -
    // needless disk/IO overhead repeated dozens of times per video. Now we
    // resolve and stat a file once, then reuse the same open FileHandle
    // for every subsequent range request against that same path.
    private var openFiles: [String: (handle: FileHandle, size: Int64, url: URL)] = [:]
    private let fileCacheLock = NSLock()

    private func openFile(forId relativePath: String) -> (handle: FileHandle, size: Int64, url: URL)? {
        fileCacheLock.lock()
        if let cached = openFiles[relativePath] {
            fileCacheLock.unlock()
            return cached
        }
        fileCacheLock.unlock()

        guard let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath) else {
            return nil
        }
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let fileSize = attrs[.size] as? Int64,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
            return nil
        }

        let entry = (handle: handle, size: fileSize, url: fileURL)
        fileCacheLock.lock()
        openFiles[relativePath] = entry
        fileCacheLock.unlock()
        return entry
    }

    // ✅ A '%' in a filename passes through two encoders on its way here: the
    // JS side percent-encodes it ("50%.mp4" is requested as "50%25.mp4"), and
    // Foundation's `url.path` already decodes it once. Decoding a second time
    // (as we used to) either mangles the name or returns nil on the now-invalid
    // escape sequence, so files containing '%' failed to resolve. Build the
    // candidates in order of correctness instead and use the first that opens.
    private func candidatePaths(for url: URL) -> [String] {
        var results: [String] = []
        func add(_ value: String?) {
            guard var path = value, !path.isEmpty else { return }
            if path.hasPrefix("/") { path = String(path.dropFirst()) }
            guard !path.isEmpty, !results.contains(path) else { return }
            results.append(path)
        }
        let encodedPath = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath
        add(encodedPath?.removingPercentEncoding)  // decoded exactly once — correct
        add(url.path)                              // Foundation's own single decode
        add(encodedPath)                           // raw, if nothing needed decoding
        return results
    }

    private func resolvedPath(for url: URL) -> String? {
        for candidate in candidatePaths(for: url) where openFile(forId: candidate) != nil {
            return candidate
        }
        return nil
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            log("FAILED: no URL on request")
            task.didFailWithError(NSError(domain: "scray", code: 404)); return
        }

        guard let relativePath = resolvedPath(for: url),
              let file = openFile(forId: relativePath) else {
            log("FAILED: could not resolve/open file for '\(url.path)' — bookmark/folder issue")
            task.didFailWithError(NSError(domain: "scray", code: 404)); return
        }
        let handle = file.handle
        let fileSize = file.size

        var start: Int64 = 0
        var end: Int64 = fileSize - 1
        var statusCode = 200

        if let range = task.request.value(forHTTPHeaderField: "Range") {
            let parts = range.replacingOccurrences(of: "bytes=", with: "").split(separator: "-")
            if let s = parts.first, let sVal = Int64(s) { start = sVal }
            if parts.count > 1, let e = Int64(parts[1]) { end = e }
            statusCode = 206
        } else {
            let initialChunk: Int64 = 2 * 1024 * 1024
            end = min(fileSize - 1, initialChunk - 1)
            statusCode = fileSize > initialChunk ? 206 : 200
        }

        let length = end - start + 1

        // Reused handles are shared across requests, so guard concurrent
        // seek+read pairs on the same file handle from racing each other.
        fileCacheLock.lock()
        handle.seek(toFileOffset: UInt64(start))
        let data = handle.readData(ofLength: Int(length))
        fileCacheLock.unlock()

        // Check whether WebKit cancelled this exact task while we were
        // reading — responding to an already-stopped task is what was
        // likely confusing AVFoundation's buffering/metadata state machine.
        let taskId = ObjectIdentifier(task)
        lock.lock()
        let wasCancelled = cancelledTasks.remove(taskId) != nil
        lock.unlock()

        if wasCancelled {
            log("SKIPPED: task for bytes \(start)-\(end) was cancelled before response was ready")
            return
        }

        var headers = [
            "Content-Type": mimeType(for: relativePath),
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes"
        ]
        if statusCode == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(fileSize)" }

        let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        let taskId = ObjectIdentifier(task)
        lock.lock()
        cancelledTasks.insert(taskId)
        lock.unlock()
        log("task stopped/cancelled by WebKit")
    }

    private func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "mkv": return "video/x-matroska"
        case "avi": return "video/x-msvideo"
        default: return "video/mp4"
        }
    }

    private func log(_ message: String) {
        let escaped = message
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("console.log('[VideoScheme] \(escaped)');")
        }
    }

    deinit {
        fileCacheLock.lock()
        for (_, entry) in openFiles {
            entry.handle.closeFile()
        }
        openFiles.removeAll()
        fileCacheLock.unlock()
    }
}