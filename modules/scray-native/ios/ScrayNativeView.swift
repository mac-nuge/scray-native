import ExpoModulesCore
import WebKit

class ScrayNativeView: ExpoView {
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