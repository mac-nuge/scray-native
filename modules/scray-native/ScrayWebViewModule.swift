import ExpoModulesCore
import WebKit

class ScrayWebView: ExpoView {
    let webView: WKWebView

    required init(appContext: AppContext? = nil) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(VideoSchemeHandler(), forURLScheme: "scray-video")
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(appContext: appContext)
        addSubview(webView)
    }

    override func layoutSubviews() {
        webView.frame = bounds
    }
}

public class ScrayWebViewModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ScrayWebView")

        View(ScrayWebView.self) {
            Prop("source") { (view: ScrayWebView, path: String) in
                if path.hasPrefix("http") {
                    if let url = URL(string: path) {
                        view.webView.load(URLRequest(url: url))
                    }
                } else if let url = Bundle.main.url(forResource: "web/" + path, withExtension: nil) {
                    view.webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
                }
            }
        }

        Function("pickFolder") { () -> Void in
            DispatchQueue.main.async {
                guard let root = UIApplication.shared.connectedScenes
                    .compactMap({ $0 as? UIWindowScene })
                    .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
                picker.delegate = FolderPickerDelegate.shared
                root.present(picker, animated: true)
            }
        }

        Function("listVideoFiles") { () -> [String] in
            BookmarkStore.shared.listVideoFiles()
        }
    }
}