import ExpoModulesCore
import WebKit
import AVFoundation

// Proxy exists because WKUserContentController needs a handler registered
// *before* the WKWebView is created (its configuration is copied at init time),
// but `self` isn't available until after super.init() runs.
class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

class ScrayNativeView: ExpoView, WKScriptMessageHandler, WKUIDelegate {
    let webView: WKWebView
    let messageProxy = ScriptMessageProxy()

    /// The live main web view, so ScrayBrowser can hand a scraynative:// link
    /// back to the app that is already running rather than round-tripping
    /// through iOS. Weak — Expo owns the view's lifetime, not this reference.
    static weak var current: ScrayNativeView?

    /// Re-scan the linked video folder. ScrayBrowser calls this once a
    /// download has landed, so a file saved in the browser turns up in the
    /// list without anyone having to hit Refresh.
    func refreshLocalFolder() {
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(
                "window.scrayRefreshLocalFolder && window.scrayRefreshLocalFolder();"
            )
        }
    }

    /// Play a catalogue key. Called by ScrayBrowser after it dismisses itself,
    /// so the player is already on screen by the time this lands.
    func playVideo(key: String) {
        let escaped = key
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(
                "window.scrayPlayByKey && window.scrayPlayByKey('\(escaped)');"
            )
        }
    }

    required init(appContext: AppContext? = nil) {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let videoHandler = VideoSchemeHandler()
        config.setURLSchemeHandler(videoHandler, forURLScheme: "scray-video")
        config.userContentController.add(messageProxy, name: "scrayBridge")

        // Expose the IPA's own identity to the web layer at documentStart, so
        // it's available however the page was loaded (bundled file:// or the
        // dev server) and stays correct even when the web assets are being
        // served from another machine.
        let info = Bundle.main.infoDictionary ?? [:]
        let shortVersion = (info["CFBundleShortVersionString"] as? String) ?? "0.0.0"
        let bundleBuild = (info["CFBundleVersion"] as? String) ?? "0"
        let isDevVariant = (Bundle.main.bundleIdentifier ?? "").hasSuffix(".dev")
        let nativeInfoJS = """
        window.SCRAY_NATIVE = {
          variant: "\(isDevVariant ? "dev" : "prd")",
          version: "\(shortVersion)",
          build: "\(bundleBuild)",
          buildId: "\(BuildInfo.id)"
        };
        """
        config.userContentController.addUserScript(
            WKUserScript(source: nativeInfoJS,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )

        webView = WKWebView(frame: .zero, configuration: config)
        super.init(appContext: appContext)
        messageProxy.target = self
        videoHandler.webView = webView
        // ✅ Without a UI delegate, WKWebView silently ignores alert()/confirm()
        // and confirm() returns false
        webView.uiDelegate = self
        addSubview(webView)
        ScrayNativeView.current = self
    }

    override func layoutSubviews() {
        webView.frame = bounds
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let action = body["action"] as? String else {
            DispatchQueue.main.async { [weak self] in
                self?.webView.evaluateJavaScript("console.error('[Bridge] failed to parse message body');")
            }
            return
        }

        let payload = body["payload"]
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("console.log('[Bridge build=\(BuildInfo.id)] received action=<' + '\(action)' + '> length=\(action.count)');")
        }

        switch action {
        case "pickFolder":
            FolderPickerDelegate.shared.presentPicker { [weak self] result in
                self?.resolve(id: id, result: result)
            }
        case "listVideoFiles":
            resolve(id: id, result: BookmarkStore.shared.listVideoFiles())
        case "getVideoDuration":
            guard let relativePath = payload as? String,
                  let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath) else {
                resolve(id: id, result: 0)
                return
            }
            Task {
                let asset = AVURLAsset(url: fileURL)
                let seconds: Double
                if let duration = try? await asset.load(.duration) {
                    let value = CMTimeGetSeconds(duration)
                    seconds = value.isFinite ? value : 0
                } else {
                    seconds = 0
                }
                self.resolve(id: id, result: ["duration": seconds])
            }
        case "getVideoMetadata":
            guard let relativePath = payload as? String,
                  let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath) else {
                resolve(id: id, result: [String: Any]())
                return
            }
            Task {
                let asset = AVURLAsset(url: fileURL)

                var seconds: Double = 0
                if let duration = try? await asset.load(.duration) {
                    let value = CMTimeGetSeconds(duration)
                    seconds = value.isFinite ? value : 0
                }

                var width: Double?
                var height: Double?
                var bitrate: Double?
                if let track = try? await asset.loadTracks(withMediaType: .video).first {
                    if let naturalSize = try? await track.load(.naturalSize),
                       let transform = try? await track.load(.preferredTransform) {
                        let size = naturalSize.applying(transform)
                        width = abs(size.width)
                        height = abs(size.height)
                    }
                    if let rate = try? await track.load(.estimatedDataRate) {
                        bitrate = Double(rate)
                    }
                }

                var sizeBytes: Int64?
                var createdDate: String?
                var modifiedDate: String?
                if let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path) {
                    sizeBytes = (attrs[.size] as? NSNumber)?.int64Value
                    let formatter = ISO8601DateFormatter()
                    if let created = attrs[.creationDate] as? Date {
                        createdDate = formatter.string(from: created)
                    }
                    if let modified = attrs[.modificationDate] as? Date {
                        modifiedDate = formatter.string(from: modified)
                    }
                }

                var result: [String: Any] = ["duration": seconds]
                if let width { result["width"] = width }
                if let height { result["height"] = height }
                if let bitrate { result["bitrate"] = bitrate }
                if let sizeBytes { result["sizeBytes"] = sizeBytes }
                if let createdDate { result["createdDate"] = createdDate }
                if let modifiedDate { result["modifiedDate"] = modifiedDate }

                self.resolve(id: id, result: result)
            }
        case "exportCsv":
            guard let payloadDict = payload as? [String: Any],
                  let csvText = payloadDict["csv"] as? String,
                  let filename = payloadDict["filename"] as? String else {
                resolve(id: id, result: ["success": false])
                return
            }
            CsvExportDelegate.shared.presentExporter(csvText: csvText, filename: filename) { [weak self] result in
                self?.resolve(id: id, result: result)
            }
        case "renameFile":
            guard let payloadDict = payload as? [String: Any],
                  let relativePath = payloadDict["path"] as? String,
                  let newName = payloadDict["newName"] as? String,
                  !newName.isEmpty,
                  !newName.contains("/") else {
                reject(id: id, error: "Invalid rename payload")
                return
            }
            do {
                let newPath = try BookmarkStore.shared.renameFile(relativePath: relativePath, newName: newName)
                resolve(id: id, result: ["success": true, "path": newPath])
            } catch {
                reject(id: id, error: error.localizedDescription)
            }
        case "deleteFile":
            guard let payloadDict = payload as? [String: Any],
                  let relativePath = payloadDict["path"] as? String else {
                reject(id: id, error: "Invalid delete payload")
                return
            }
            do {
                try BookmarkStore.shared.deleteFile(relativePath: relativePath)
                resolve(id: id, result: ["success": true, "deleted": true])
            } catch {
                reject(id: id, error: error.localizedDescription)
            }
        case "openBrowser":
            // Payload is either a bare URL string, or { url, home }. Both are
            // optional — no URL means "resume wherever the browser was left".
            var browserURL: String? = nil
            var browserHome = "https://macnguyen.com/sp-staging-sql/"
            if let s = payload as? String, !s.isEmpty {
                browserURL = s
            } else if let d = payload as? [String: Any] {
                browserURL = (d["url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                if let h = d["home"] as? String, !h.isEmpty { browserHome = h }
            }
            ScrayBrowser.shared.present(url: browserURL, home: browserHome)
            resolve(id: id, result: ["success": true])
        case "deviceStorage":
            // ForImportantUsage counts purgeable space, which is what iOS
            // actually frees up when a write needs room. The raw free-bytes
            // attribute can read tens of gigabytes lower and would look wrong
            // next to what Settings says.
            var storage: [String: Any] = [:]
            if let values = try? URL(fileURLWithPath: NSHomeDirectory())
                .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey,
                                          .volumeTotalCapacityKey]) {
                if let free = values.volumeAvailableCapacityForImportantUsage {
                    storage["freeBytes"] = free
                }
                if let total = values.volumeTotalCapacity {
                    storage["totalBytes"] = total
                }
            }
            resolve(id: id, result: storage)
        case "debugBundle":
            let resourcePath = Bundle.main.resourcePath ?? "nil"
            let rootContents = (try? FileManager.default.contentsOfDirectory(atPath: resourcePath)) ?? []
            let webContents = (try? FileManager.default.contentsOfDirectory(atPath: resourcePath + "/web")) ?? []
            resolve(id: id, result: [
                "resourcePath": resourcePath,
                "rootContents": rootContents,
                "webFolderContents": webContents
            ])
        default:
            reject(id: id, error: "Unknown action: \(action)")
        }
    }

    // MARK: - WKUIDelegate (JS dialogs)

    private func topViewController() -> UIViewController? {
        var top = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard let top = topViewController() else { completionHandler(); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        guard let top = topViewController() else { completionHandler(false); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        top.present(alert, animated: true)
    }

    private func resolve(id: String, result: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: []),
              let json = String(data: data, encoding: .utf8) else {
            reject(id: id, error: "Failed to serialize result")
            return
        }
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript("window._scrayResolve('\(id)', \(json));")
        }
    }

    private func reject(id: String, error: String) {
        let escaped = error.replacingOccurrences(of: "'", with: "\\'")
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript("window._scrayReject('\(id)', '\(escaped)');")
        }
    }
}