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

class ScrayNativeView: ExpoView, WKScriptMessageHandler {
    let webView: WKWebView
    let messageProxy = ScriptMessageProxy()

    required init(appContext: AppContext? = nil) {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let videoHandler = VideoSchemeHandler()
        config.setURLSchemeHandler(videoHandler, forURLScheme: "scray-video")
        config.userContentController.add(messageProxy, name: "scrayBridge")
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(appContext: appContext)
        messageProxy.target = self
        videoHandler.webView = webView
        addSubview(webView)
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
                self.resolve(id: id, result: seconds)
            }
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