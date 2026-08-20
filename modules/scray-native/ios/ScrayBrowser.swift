import UIKit
import WebKit

// ============================================================================
// ScrayBrowser — a self-contained in-app browser, so Picker is reachable
// without hopping out to Safari.
//
// Kept alive as a singleton: closing the browser is "hide", not "throw away".
// The page, its scroll position and any half-finished sign-in are still there
// when you come back. Sign-in itself survives further than that — the web view
// uses the default (persistent) website data store, so MSAL's localStorage
// token cache is written to disk and outlives the process.
// ============================================================================

final class ScrayBrowser: NSObject {

    static let shared = ScrayBrowser()

    private var controller: ScrayBrowserViewController?

    /// `url` is where to go on a cold start; pass nil to resume wherever the
    /// browser was left. `home` is what the house button goes to.
    func present(url: String?, home: String) {
        DispatchQueue.main.async {
            let homeURL = URL(string: home) ?? URL(string: "about:blank")!

            let vc: ScrayBrowserViewController
            if let existing = self.controller {
                vc = existing
                vc.homeURL = homeURL
            } else {
                vc = ScrayBrowserViewController(homeURL: homeURL)
                self.controller = vc
            }

            if let target = url.flatMap({ URL(string: $0) }) {
                vc.pendingURL = target
            }

            if vc.presentingViewController != nil {
                vc.applyPendingURL()   // already on screen
                return
            }

            guard let top = ScrayBrowser.topViewController() else { return }
            vc.modalPresentationStyle = .fullScreen
            top.present(vc, animated: true) { vc.applyPendingURL() }
        }
    }

    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.first(where: { $0.activationState == .foregroundActive })?
                        .windows.first(where: { $0.isKeyWindow })
                     ?? scenes.first?.windows.first(where: { $0.isKeyWindow })
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// ============================================================================

final class ScrayBrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private static let lastURLKey = "scray.browser.lastURL"

    var homeURL: URL
    var pendingURL: URL?

    private(set) var webView: WKWebView!
    private var popupWebView: WKWebView?
    private weak var popupController: UIViewController?

    private let titleLabel = UILabel()
    private let urlLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let toolbar = UIToolbar()
    private var backItem = UIBarButtonItem()
    private var forwardItem = UIBarButtonItem()
    private var observations: [NSKeyValueObservation] = []
    private var didInitialLoad = false

    init(homeURL: URL) {
        self.homeURL = homeURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit { observations.forEach { $0.invalidate() } }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildWebView()
        buildChrome()
        observeWebView()
        applyPendingURL()
    }

    // MARK: - Setup

    private func buildWebView() {
        let config = WKWebViewConfiguration()

        // The persistent, on-disk store. This single line is what "remember
        // the login" comes down to: cookies and localStorage — where MSAL
        // keeps its token cache, including the refresh token — are written
        // exactly as Safari writes them, and survive the app being killed.
        config.websiteDataStore = .default()

        config.allowsInlineMediaPlayback = true

        // MSAL opens its sign-in window from a click handler, but WebKit is
        // stricter than Safari about what counts as a user gesture once a
        // promise chain is involved.
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Makes the UA read as ordinary Mobile Safari. Microsoft's sign-in
        // pages behave differently — occasionally refusing outright — when
        // they think they're inside an embedded browser.
        config.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
    }

    private func buildChrome() {
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.widthAnchor.constraint(equalToConstant: 44).isActive = true

        let homeButton = UIButton(type: .system)
        homeButton.setImage(UIImage(systemName: "house"), for: .normal)
        homeButton.addTarget(self, action: #selector(homeTapped), for: .touchUpInside)
        homeButton.widthAnchor.constraint(equalToConstant: 44).isActive = true

        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail

        urlLabel.font = .systemFont(ofSize: 10)
        urlLabel.textColor = .secondaryLabel
        urlLabel.textAlignment = .center
        urlLabel.lineBreakMode = .byTruncatingMiddle

        let labels = UIStackView(arrangedSubviews: [titleLabel, urlLabel])
        labels.axis = .vertical
        labels.spacing = 1

        let header = UIStackView(arrangedSubviews: [closeButton, labels, homeButton])
        header.axis = .horizontal
        header.alignment = .center
        header.translatesAutoresizingMaskIntoConstraints = false

        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800
        progressView.trackTintColor = .clear
        progressView.isHidden = true

        backItem = UIBarButtonItem(image: UIImage(systemName: "chevron.left"),
                                   style: .plain, target: self, action: #selector(backTapped))
        forwardItem = UIBarButtonItem(image: UIImage(systemName: "chevron.right"),
                                      style: .plain, target: self, action: #selector(forwardTapped))
        let reloadItem = UIBarButtonItem(image: UIImage(systemName: "arrow.clockwise"),
                                         style: .plain, target: self, action: #selector(reloadTapped))
        let safariItem = UIBarButtonItem(image: UIImage(systemName: "safari"),
                                         style: .plain, target: self, action: #selector(safariTapped))
        func flex() -> UIBarButtonItem {
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        }
        backItem.isEnabled = false
        forwardItem.isEnabled = false
        toolbar.items = [backItem, flex(), forwardItem, flex(), reloadItem, flex(), safariItem]
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(header)
        view.addSubview(progressView)
        view.addSubview(webView)
        view.addSubview(toolbar)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),

            progressView.topAnchor.constraint(equalTo: header.bottomAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 2),

            webView.topAnchor.constraint(equalTo: progressView.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: toolbar.topAnchor),

            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    private func observeWebView() {
        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
                guard let self = self else { return }
                self.progressView.progress = Float(wv.estimatedProgress)
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] wv, _ in
                self?.progressView.isHidden = !wv.isLoading
            },
            webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
                let t = (wv.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                self?.titleLabel.text = t.isEmpty ? "Loading…" : t
            },
            webView.observe(\.url, options: [.new]) { [weak self] wv, _ in
                self?.urlLabel.text = wv.url?.host.map { $0 + (wv.url?.path ?? "") }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] wv, _ in
                self?.backItem.isEnabled = wv.canGoBack
            },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] wv, _ in
                self?.forwardItem.isEnabled = wv.canGoForward
            }
        ]
    }

    /// Loads only on a cold start. Re-opening the browser must never blow away
    /// whatever page — or half-finished sign-in — was already sitting there.
    func applyPendingURL() {
        guard isViewLoaded else { return }   // pendingURL survives until viewDidLoad
        let saved = UserDefaults.standard.string(forKey: Self.lastURLKey).flatMap { URL(string: $0) }
        let target = pendingURL ?? saved ?? homeURL
        pendingURL = nil
        guard !didInitialLoad else { return }
        didInitialLoad = true
        webView.load(URLRequest(url: target))
    }

    // MARK: - Chrome actions

    @objc private func closeTapped()   { dismiss(animated: true) }
    @objc private func homeTapped()    { webView.load(URLRequest(url: homeURL)) }
    @objc private func backTapped()    { if webView.canGoBack { webView.goBack() } }
    @objc private func forwardTapped() { if webView.canGoForward { webView.goForward() } }

    @objc private func reloadTapped() {
        if webView.isLoading { webView.stopLoading() } else { webView.reload() }
    }

    @objc private func safariTapped() {
        guard let url = webView.url else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = (url.scheme ?? "").lowercased()
        if ["http", "https", "about", "data", "blob", "file"].contains(scheme) {
            decisionHandler(.allow)
            return
        }
        // msauth://, ms-authenticator://, tel:, mailto: … hand off to iOS.
        decisionHandler(.cancel)
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView,
              let url = webView.url,
              (url.scheme ?? "").hasPrefix("http") else { return }
        UserDefaults.standard.set(url.absoluteString, forKey: Self.lastURLKey)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        guard webView === self.webView, (error as NSError).code != NSURLErrorCancelled else { return }
        titleLabel.text = "Couldn't load page"
        urlLabel.text = error.localizedDescription
    }

    // MARK: - WKUIDelegate (window.open — this is the MSAL popup)

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {

        // An ordinary target="_blank" link. No reason to spawn a window —
        // just follow it here, the way a tab would.
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           (url.scheme ?? "").hasPrefix("http") {
            webView.load(URLRequest(url: url))
            return nil
        }

        // Scripted window.open. Built from the configuration WebKit handed
        // us — a fresh WKWebViewConfiguration here would not be a real child
        // window and window.opener would come back nil, which is exactly the
        // failure MSAL reports as empty_window_error.
        let popup = WKWebView(frame: view.bounds, configuration: configuration)
        popup.uiDelegate = self
        popup.navigationDelegate = self
        popup.allowsBackForwardNavigationGestures = true
        presentPopup(popup)

        // Belt and braces. window.open("about:blank") followed by assigning
        // location works on its own, but a popup opened straight at a URL
        // occasionally arrives blank. If nothing is happening a moment later,
        // start it off.
        if let url = navigationAction.request.url, url.absoluteString != "about:blank" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak popup] in
                guard let popup = popup, popup.url == nil, !popup.isLoading else { return }
                popup.load(URLRequest(url: url))
            }
        }
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popupWebView { dismissPopup() }
    }

    private func presentPopup(_ popup: WKWebView) {
        dismissPopup()
        popupWebView = popup
        popup.translatesAutoresizingMaskIntoConstraints = false

        let vc = UIViewController()
        vc.view.backgroundColor = .systemBackground

        let bar = UIToolbar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.items = [
            UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancelPopupTapped)),
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        ]

        vc.view.addSubview(bar)
        vc.view.addSubview(popup)
        let guide = vc.view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: guide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
            popup.topAnchor.constraint(equalTo: bar.bottomAnchor),
            popup.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            popup.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
            popup.bottomAnchor.constraint(equalTo: vc.view.bottomAnchor)
        ])

        popupController = vc
        vc.modalPresentationStyle = .fullScreen
        present(vc, animated: true)
    }

    @objc private func cancelPopupTapped() { dismissPopup() }

    private func dismissPopup() {
        // Releasing the web view is what makes window.closed flip to true on
        // the JS side — which is how MSAL notices a cancelled sign-in instead
        // of sitting on its poll loop forever.
        popupWebView?.stopLoading()
        popupWebView?.removeFromSuperview()
        popupWebView = nil
        popupController?.dismiss(animated: true)
        popupController = nil
    }

    // MARK: - WKUIDelegate (JS dialogs)

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        (presentedViewController ?? self).present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        (presentedViewController ?? self).present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        (presentedViewController ?? self).present(alert, animated: true)
    }
}