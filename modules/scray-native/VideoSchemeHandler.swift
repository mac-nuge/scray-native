import WebKit

class VideoSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let fileURL = BookmarkStore.shared.resolveFile(forId: url.host ?? "") else {
            task.didFailWithError(NSError(domain: "scray", code: 404)); return
        }
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let fileSize = attrs[.size] as? Int64,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
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
        }

        let length = end - start + 1
        handle.seek(toFileOffset: UInt64(start))
        let data = handle.readData(ofLength: Int(length))

        var headers = [
            "Content-Type": "video/mp4",
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes"
        ]
        if statusCode == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(fileSize)" }

        let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}