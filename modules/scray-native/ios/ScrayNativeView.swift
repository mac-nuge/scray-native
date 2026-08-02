import ExpoModulesCore
import WebKit

class ScrayNativeView: ExpoView, WKScriptMessageHandler {
    let webView: WKWebView

    required init(appContext: AppContext? = nil) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(VideoSchemeHandler(), forURLScheme: "scray-video")
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(appContext: appContext)
        config.userContentController.add(self, name: "scrayBridge")
        addSubview(webView)
    }

    override func layoutSubviews() {
        webView.frame = bounds
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let action = body["action"] as? String else { return }

        switch action {
        case "pickFolder":
            FolderPickerDelegate.shared.presentPicker { [weak self] result in
                self?.resolve(id: id, result: result)
            }
        case "listVideoFiles":
            resolve(id: id, result: BookmarkStore.shared.listVideoFiles())
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