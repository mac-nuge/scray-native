import WebKit

class VideoSchemeHandler: NSObject, WKURLSchemeHandler {
    weak var webView: WKWebView?
    private var cancelledTasks = Set<ObjectIdentifier>()
    private let lock = NSLock()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            log("FAILED: no URL on request")
            task.didFailWithError(NSError(domain: "scray", code: 404)); return
        }
        let rawPath = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let relativePath = rawPath.removingPercentEncoding ?? rawPath

        guard let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath) else {
            log("FAILED: could not resolve file for '\(relativePath)' — bookmark/folder issue")
            task.didFailWithError(NSError(domain: "scray", code: 404)); return
        }
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let fileSize = attrs[.size] as? Int64,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
            log("FAILED: could not open file at \(fileURL.path)")
            task.didFailWithError(NSError(domain: "scray", code: 500)); return
        }
        defer { handle.closeFile() }

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
        handle.seek(toFileOffset: UInt64(start))
        let data = handle.readData(ofLength: Int(length))

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
}