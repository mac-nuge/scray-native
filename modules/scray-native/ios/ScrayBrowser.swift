import UIKit
import WebKit

// ============================================================================
// ScrayBrowser — a self-contained tabbed browser, so Picker and the DB console
// are reachable without hopping out to Safari.
//
// Kept alive as a singleton: closing it is "hide", not "throw away". Tabs, the
// pages in them and any half-finished sign-in are still there when you come
// back, and the open tab list is written to UserDefaults so it survives a cold
// start too.
//
// Three things here are load-bearing and easy to break:
//
//   1. WKWebsiteDataStore.default() — the on-disk store. MSAL is configured
//      with cacheLocation "localStorage", so its token cache (refresh token
//      included) is written to disk and outlives the process. That is the
//      whole of "remember the login".
//
//   2. createWebViewWith — WKWebView drops window.open on the floor without
//      it, which MSAL reports as empty_window_error. The child view must be
//      built from the configuration WebKit hands the delegate, or it is not a
//      real child window and window.opener comes back nil.
//
//   3. Downloads arrive by two completely separate routes. See MARK: Downloads.
// ============================================================================

final class ScrayBrowser: NSObject {

    static let shared = ScrayBrowser()

    private var controller: ScrayBrowserViewController?

    /// `url` is where to go; nil resumes wherever the browser was left.
    /// `home` is what the house button goes to.
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

            vc.pendingURL = url.flatMap { URL(string: $0) }

            if vc.presentingViewController != nil {
                vc.consumePendingURL()
                return
            }

            guard let top = ScrayBrowser.topViewController() else { return }
            vc.modalPresentationStyle = .fullScreen
            top.present(vc, animated: true) { vc.consumePendingURL() }
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
// A message handler holds its target strongly, and the content controller is
// owned by the configuration which is owned by the view controller — so a
// direct registration is a retain cycle. Same reason ScrayNativeView has one.
// ============================================================================

private final class ScrayBrowserMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(ucc, didReceive: message)
    }
}

// ============================================================================

final class ScrayBrowserTab {
    let webView: WKWebView
    /// Set for tabs restored from disk but not yet loaded — they load on first
    /// selection rather than all at once when the browser opens.
    var pending: URL?

    init(webView: WKWebView, pending: URL? = nil) {
        self.webView = webView
        self.pending = pending
    }

    var displayURL: URL? { webView.url ?? pending }

    var displayTitle: String {
        let t = (webView.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
        return displayURL?.host ?? "New tab"
    }
}

// ============================================================================

final class ScrayBrowserViewController: UIViewController,
                                        WKNavigationDelegate,
                                        WKUIDelegate,
                                        WKScriptMessageHandler,
                                        UITextFieldDelegate,
                                        UIDocumentPickerDelegate {

    private static let tabsKey  = "scray.browser.tabs"
    private static let indexKey = "scray.browser.tabIndex"

    var homeURL: URL
    var pendingURL: URL?

    private var tabs: [ScrayBrowserTab] = []
    private var currentIndex = 0
    private var currentTab: ScrayBrowserTab? { tabs.indices.contains(currentIndex) ? tabs[currentIndex] : nil }
    private var currentWebView: WKWebView? { currentTab?.webView }

    private var webConfig: WKWebViewConfiguration!
    private let messageProxy = ScrayBrowserMessageProxy()

    private var popupWebView: WKWebView?
    private weak var popupController: UIViewController?

    private let addressField = UITextField()
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let webContainer = UIView()
    private let toolbar = UIToolbar()
    private var backItem = UIBarButtonItem()
    private var forwardItem = UIBarButtonItem()
    private var tabsItem = UIBarButtonItem()
    private var reloadButton = UIButton(type: .system)

    private var observations: [NSKeyValueObservation] = []
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var exportingTempFiles: [URL] = []

    init(homeURL: URL) {
        self.homeURL = homeURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit {
        observations.forEach { $0.invalidate() }
        webConfig?.userContentController.removeScriptMessageHandler(forName: "scrayDownload")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildConfiguration()
        buildChrome()
        restoreTabs()
        consumePendingURL()
    }

    // MARK: - Configuration

    private func buildConfiguration() {
        let config = WKWebViewConfiguration()

        // The persistent, on-disk store — cookies and localStorage written
        // exactly as Safari writes them. This is what remembers the login.
        config.websiteDataStore = .default()

        config.allowsInlineMediaPlayback = true

        // WKWebView is stricter than Safari about what counts as a user
        // gesture once a promise chain is involved, and MSAL's popup opens
        // from inside one.
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Reads as ordinary Mobile Safari. Microsoft's sign-in pages behave
        // differently — occasionally refusing outright — when they think they
        // are inside an embedded browser.
        config.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1"

        messageProxy.target = self
        config.userContentController.add(messageProxy, name: "scrayDownload")
        config.userContentController.addUserScript(
            WKUserScript(source: Self.downloadShimJS,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: false)
        )

        webConfig = config
    }

    // MARK: - Chrome

    private func buildChrome() {
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.widthAnchor.constraint(equalToConstant: 40).isActive = true

        reloadButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        reloadButton.addTarget(self, action: #selector(reloadTapped), for: .touchUpInside)
        reloadButton.widthAnchor.constraint(equalToConstant: 40).isActive = true

        addressField.font = .systemFont(ofSize: 13)
        addressField.backgroundColor = .secondarySystemBackground
        addressField.layer.cornerRadius = 9
        addressField.textAlignment = .center
        addressField.clearButtonMode = .whileEditing
        addressField.autocapitalizationType = .none
        addressField.autocorrectionType = .no
        addressField.spellCheckingType = .no
        addressField.keyboardType = .URL
        addressField.returnKeyType = .go
        addressField.delegate = self
        addressField.placeholder = "Search or enter address"
        addressField.heightAnchor.constraint(equalToConstant: 34).isActive = true

        let header = UIStackView(arrangedSubviews: [closeButton, addressField, reloadButton])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 4
        header.isLayoutMarginsRelativeArrangement = true
        header.layoutMargins = UIEdgeInsets(top: 4, left: 6, bottom: 4, right: 6)
        header.translatesAutoresizingMaskIntoConstraints = false

        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800
        progressView.trackTintColor = .clear
        progressView.isHidden = true

        webContainer.translatesAutoresizingMaskIntoConstraints = false

        backItem = UIBarButtonItem(image: UIImage(systemName: "chevron.left"),
                                   style: .plain, target: self, action: #selector(backTapped))
        forwardItem = UIBarButtonItem(image: UIImage(systemName: "chevron.right"),
                                      style: .plain, target: self, action: #selector(forwardTapped))
        let homeItem = UIBarButtonItem(image: UIImage(systemName: "house"),
                                       style: .plain, target: self, action: #selector(homeTapped))
        tabsItem = UIBarButtonItem(title: "1 ⧉", style: .plain, target: self, action: #selector(tabsTapped))
        let newTabItem = UIBarButtonItem(image: UIImage(systemName: "plus"),
                                         style: .plain, target: self, action: #selector(newTabTapped))
        let safariItem = UIBarButtonItem(image: UIImage(systemName: "safari"),
                                         style: .plain, target: self, action: #selector(safariTapped))
        func flex() -> UIBarButtonItem {
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        }
        backItem.isEnabled = false
        forwardItem.isEnabled = false
        toolbar.items = [backItem, flex(), forwardItem, flex(), homeItem,
                         flex(), tabsItem, flex(), newTabItem, flex(), safariItem]
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(header)
        view.addSubview(progressView)
        view.addSubview(webContainer)
        view.addSubview(toolbar)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor),

            progressView.topAnchor.constraint(equalTo: header.bottomAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 2),

            webContainer.topAnchor.constraint(equalTo: progressView.bottomAnchor),
            webContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webContainer.bottomAnchor.constraint(equalTo: toolbar.topAnchor),

            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    // MARK: - Tabs

    private func makeWebView(configuration: WKWebViewConfiguration?) -> WKWebView {
        let wv = WKWebView(frame: webContainer.bounds, configuration: configuration ?? webConfig)
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.scrollView.keyboardDismissMode = .interactive
        return wv
    }

    @discardableResult
    private func addTab(url: URL?,
                        configuration: WKWebViewConfiguration? = nil,
                        select: Bool = true) -> ScrayBrowserTab {
        let tab = ScrayBrowserTab(webView: makeWebView(configuration: configuration))
        tabs.append(tab)
        if select { selectTab(tabs.count - 1) }
        // Popup/target=_blank views are loaded by WebKit itself — passing a
        // URL here as well would fire the request twice.
        if let url = url { tab.webView.load(URLRequest(url: url)) }
        persistTabs()
        return tab
    }

    private func selectTab(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        currentIndex = index
        let tab = tabs[index]

        webContainer.subviews.forEach { $0.removeFromSuperview() }
        let wv = tab.webView
        wv.translatesAutoresizingMaskIntoConstraints = false
        webContainer.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: webContainer.topAnchor),
            wv.leadingAnchor.constraint(equalTo: webContainer.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: webContainer.trailingAnchor),
            wv.bottomAnchor.constraint(equalTo: webContainer.bottomAnchor)
        ])

        bindObservations(to: wv)

        if let pending = tab.pending {
            tab.pending = nil
            wv.load(URLRequest(url: pending))
        }

        refreshChrome()
        persistTabs()
    }

    private func closeTab(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        let tab = tabs.remove(at: index)
        tab.webView.stopLoading()
        tab.webView.removeFromSuperview()

        if tabs.isEmpty {
            addTab(url: homeURL, select: true)
            return
        }
        selectTab(min(index, tabs.count - 1))
    }

    /// If a tab is already sitting on this target, go to it rather than
    /// opening a duplicate — tapping "Picker" twice should not give you two
    /// Pickers.
    private func openOrFocus(_ url: URL) {
        let wanted = url.absoluteString.hasSuffix("/")
            ? String(url.absoluteString.dropLast())
            : url.absoluteString
        if let idx = tabs.firstIndex(where: { ($0.displayURL?.absoluteString ?? "").hasPrefix(wanted) }) {
            selectTab(idx)
            return
        }
        addTab(url: url, select: true)
    }

    func consumePendingURL() {
        guard isViewLoaded else { return }   // pendingURL survives until viewDidLoad
        let target = pendingURL
        pendingURL = nil
        if let target = target {
            openOrFocus(target)
        } else if tabs.isEmpty {
            addTab(url: homeURL, select: true)
        }
    }

    private func restoreTabs() {
        let saved = UserDefaults.standard.stringArray(forKey: Self.tabsKey) ?? []
        for s in saved {
            guard let u = URL(string: s), (u.scheme ?? "").hasPrefix("http") else { continue }
            tabs.append(ScrayBrowserTab(webView: makeWebView(configuration: nil), pending: u))
        }
        guard !tabs.isEmpty else { return }
        let idx = UserDefaults.standard.integer(forKey: Self.indexKey)
        selectTab(min(max(idx, 0), tabs.count - 1))
    }

    private func persistTabs() {
        let urls = tabs.compactMap { $0.displayURL?.absoluteString }
            .filter { $0.hasPrefix("http") }
        UserDefaults.standard.set(urls, forKey: Self.tabsKey)
        UserDefaults.standard.set(currentIndex, forKey: Self.indexKey)
    }

    // MARK: - Chrome state

    private func bindObservations(to wv: WKWebView) {
        observations.forEach { $0.invalidate() }
        observations = [
            wv.observe(\.estimatedProgress, options: [.new]) { [weak self] w, _ in
                self?.progressView.progress = Float(w.estimatedProgress)
            },
            wv.observe(\.isLoading, options: [.new]) { [weak self] w, _ in
                guard let self = self else { return }
                self.progressView.isHidden = !w.isLoading
                let symbol = w.isLoading ? "xmark" : "arrow.clockwise"
                self.reloadButton.setImage(UIImage(systemName: symbol), for: .normal)
            },
            wv.observe(\.title, options: [.new]) { [weak self] _, _ in self?.refreshChrome() },
            wv.observe(\.url, options: [.new]) { [weak self] _, _ in
                self?.refreshChrome()
                self?.persistTabs()
            },
            wv.observe(\.canGoBack, options: [.new]) { [weak self] w, _ in
                self?.backItem.isEnabled = w.canGoBack
            },
            wv.observe(\.canGoForward, options: [.new]) { [weak self] w, _ in
                self?.forwardItem.isEnabled = w.canGoForward
            }
        ]
    }

    private func refreshChrome() {
        tabsItem.title = "\(tabs.count) ⧉"
        backItem.isEnabled = currentWebView?.canGoBack ?? false
        forwardItem.isEnabled = currentWebView?.canGoForward ?? false
        guard !addressField.isFirstResponder else { return }
        addressField.text = compactAddress(currentTab?.displayURL)
    }

    private func compactAddress(_ url: URL?) -> String {
        guard let url = url else { return "" }
        guard let host = url.host else { return url.absoluteString }
        let path = url.path
        return path.isEmpty || path == "/" ? host : host + path
    }

    // MARK: - Address bar

    func textFieldDidBeginEditing(_ textField: UITextField) {
        textField.textAlignment = .left
        textField.text = currentTab?.displayURL?.absoluteString ?? ""
        DispatchQueue.main.async { textField.selectAll(nil) }
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        textField.textAlignment = .center
        refreshChrome()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        defer { textField.resignFirstResponder() }
        guard let url = normalizedURL(from: textField.text ?? "") else { return true }
        if currentWebView == nil { addTab(url: url, select: true) }
        else { currentWebView?.load(URLRequest(url: url)) }
        return true
    }

    /// Address-bar text to a URL: a real URL is used as typed, a bare
    /// hostname gets https://, anything else is a search.
    private func normalizedURL(from text: String) -> URL? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if let u = URL(string: t), let scheme = u.scheme, !scheme.isEmpty,
           u.host != nil || scheme == "about" || scheme == "file" {
            return u
        }
        if !t.contains(" "), t.contains("."), let u = URL(string: "https://" + t) {
            return u
        }
        var comps = URLComponents(string: "https://www.google.com/search")
        comps?.queryItems = [URLQueryItem(name: "q", value: t)]
        return comps?.url
    }

    // MARK: - Actions

    @objc private func closeTapped()   { dismiss(animated: true) }
    @objc private func homeTapped()    { openOrFocus(homeURL) }
    @objc private func backTapped()    { if currentWebView?.canGoBack == true { currentWebView?.goBack() } }
    @objc private func forwardTapped() { if currentWebView?.canGoForward == true { currentWebView?.goForward() } }
    @objc private func newTabTapped()  { addTab(url: homeURL, select: true); addressField.becomeFirstResponder() }

    @objc private func reloadTapped() {
        guard let wv = currentWebView else { return }
        if wv.isLoading { wv.stopLoading() } else if wv.url != nil { wv.reload() }
        else { wv.load(URLRequest(url: homeURL)) }
    }

    @objc private func safariTapped() {
        guard let url = currentWebView?.url else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    @objc private func tabsTapped() {
        let list = ScrayTabListViewController(style: .plain)
        list.provider = { [weak self] in
            (self?.tabs ?? []).map { ($0.displayTitle, self?.compactAddress($0.displayURL) ?? "") }
        }
        list.selectedIndex = { [weak self] in self?.currentIndex ?? 0 }
        list.onSelect = { [weak self] idx in
            self?.selectTab(idx)
            self?.dismiss(animated: true)
        }
        list.onClose = { [weak self] idx in self?.closeTab(idx) }
        list.onNew = { [weak self] in
            self?.dismiss(animated: true) {
                self?.newTabTapped()
            }
        }
        let nav = UINavigationController(rootViewController: list)
        present(nav, animated: true)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = (url.scheme ?? "").lowercased()

        if !["http", "https", "about", "data", "blob", "file"].contains(scheme) {
            // msauth://, ms-authenticator://, tel:, mailto: … hand off to iOS.
            decisionHandler(.cancel)
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }

        // <a download href="https://…">
        if #available(iOS 14.5, *), navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if #available(iOS 14.5, *) {
            let http = navigationResponse.response as? HTTPURLResponse
            let disposition = (http?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased()
            if !navigationResponse.canShowMIMEType || disposition.contains("attachment") {
                decisionHandler(.download)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshChrome()
        persistTabs()
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        guard webView === currentWebView else { return }
        showAlert(title: "Couldn't load page", message: error.localizedDescription)
    }

    @available(iOS 14.5, *)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    @available(iOS 14.5, *)
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: - WKUIDelegate (window.open)

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {

        // An ordinary target="_blank" link — a new tab, like any browser.
        if navigationAction.navigationType == .linkActivated {
            let tab = addTab(url: nil, configuration: configuration, select: true)
            return tab.webView
        }

        // Scripted window.open — MSAL's sign-in popup. A modal sheet rather
        // than a tab, because MSAL polls the child for the redirect and then
        // calls window.close() on it. Built from the configuration WebKit
        // handed us: a fresh one would not be a real child window and
        // window.opener would come back nil.
        let popup = makeWebView(configuration: configuration)
        presentPopup(popup)

        // Belt and braces. window.open("about:blank") followed by assigning
        // location works on its own, but a popup opened straight at a URL
        // occasionally arrives blank.
        if let url = navigationAction.request.url, url.absoluteString != "about:blank" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak popup] in
                guard let popup = popup, popup.url == nil, !popup.isLoading else { return }
                popup.load(URLRequest(url: url))
            }
        }
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popupWebView { dismissPopup(); return }
        if let idx = tabs.firstIndex(where: { $0.webView === webView }) { closeTab(idx) }
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
        // the JS side, which is how MSAL notices a cancelled sign-in instead
        // of sitting on its poll loop forever.
        popupWebView?.stopLoading()
        popupWebView?.removeFromSuperview()
        popupWebView = nil
        popupController?.dismiss(animated: true)
        popupController = nil
    }

    // MARK: - WKUIDelegate (JS dialogs)

    private func dialogPresenter() -> UIViewController {
        var top: UIViewController = self
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        dialogPresenter().present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        dialogPresenter().present(alert, animated: true)
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
        dialogPresenter().present(alert, animated: true)
    }

    // MARK: - Downloads
    //
    // Two routes, and they do not overlap:
    //
    //   http(s)  — WKDownload, driven by the navigation delegate above.
    //              A file the *server* sends: a DB backup, an attachment.
    //
    //   blob:/data: — the JS shim below. Everything Picker "downloads" is a
    //              blob built in the page and handed to a synthetic
    //              <a download> that gets .click()ed. WKWebView's download
    //              machinery never sees those, so nothing happens at all
    //              without this. The shim reads the blob back out, base64s
    //              it and posts it over the bridge.
    //
    // Both land in the same place: a temp file and the iOS export picker,
    // which is the "save to Files" sheet Safari gives you.

    private static let downloadShimJS = """
    (function () {
      if (window.__scrayDownloadShim) return;
      window.__scrayDownloadShim = true;

      function isLocal(href) { return /^(blob:|data:)/i.test(href || ''); }

      function post(payload) {
        try { window.webkit.messageHandlers.scrayDownload.postMessage(payload); }
        catch (e) { console.error('[download] bridge unavailable', e); }
      }

      function grab(href, filename) {
        fetch(href)
          .then(function (r) { return r.blob(); })
          .then(function (b) {
            return new Promise(function (resolve, reject) {
              var fr = new FileReader();
              fr.onload = function () { resolve(String(fr.result)); };
              fr.onerror = function () { reject(fr.error); };
              fr.readAsDataURL(b);
            });
          })
          .then(function (dataUrl) {
            var comma = dataUrl.indexOf(',');
            post({ filename: filename || 'download', base64: dataUrl.slice(comma + 1) });
          })
          .catch(function (err) { post({ error: String((err && err.message) || err) }); });
      }

      // Picker builds its anchors detached and calls .click() directly, so a
      // document listener alone would never see them.
      var origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download') && isLocal(this.href)) {
          grab(this.href, this.getAttribute('download'));
          return;
        }
        return origClick.apply(this, arguments);
      };

      document.addEventListener('click', function (e) {
        var a = (e.target && e.target.closest) ? e.target.closest('a[download]') : null;
        if (a && isLocal(a.href)) {
          e.preventDefault();
          e.stopPropagation();
          grab(a.href, a.getAttribute('download'));
        }
      }, true);

      var origOpen = window.open;
      window.open = function (url) {
        if (isLocal(url)) { grab(url, 'download'); return null; }
        return origOpen.apply(window, arguments);
      };
    })();
    """

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "scrayDownload",
              let body = message.body as? [String: Any] else { return }

        if let err = body["error"] as? String {
            showAlert(title: "Download failed", message: err)
            return
        }
        guard let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64) else {
            showAlert(title: "Download failed", message: "Couldn't read the file data.")
            return
        }

        let name = sanitizedFilename(body["filename"] as? String)
        guard let fileURL = writeTempFile(data: data, filename: name) else {
            showAlert(title: "Download failed", message: "Couldn't write a temporary file.")
            return
        }
        presentSaveToFiles(fileURL: fileURL)
    }

    private func sanitizedFilename(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = trimmed
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return cleaned.isEmpty ? "download" : cleaned
    }

    private func writeTempFile(data: Data, filename: String) -> URL? {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("scray-downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(filename)
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    fileprivate func presentSaveToFiles(fileURL: URL) {
        DispatchQueue.main.async {
            self.exportingTempFiles.append(fileURL)
            let picker = UIDocumentPickerViewController(forExporting: [fileURL])
            picker.delegate = self
            self.dialogPresenter().present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        cleanupExports()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        cleanupExports()
    }

    private func cleanupExports() {
        // forExporting: moves the file on success; on cancel it is still in
        // temp. Either way the enclosing UUID folder is ours to bin.
        for url in exportingTempFiles {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        exportingTempFiles.removeAll()
    }

    fileprivate func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        dialogPresenter().present(alert, animated: true)
    }
}

// MARK: - WKDownloadDelegate

@available(iOS 14.5, *)
extension ScrayBrowserViewController: WKDownloadDelegate {

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("scray-downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let dest = dir.appendingPathComponent(name)
        downloadDestinations[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        presentSaveToFiles(fileURL: url)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        showAlert(title: "Download failed", message: error.localizedDescription)
    }
}

// ============================================================================
// The tab list.
// ============================================================================

final class ScrayTabListViewController: UITableViewController {

    var provider: (() -> [(String, String)])?
    var selectedIndex: (() -> Int)?
    var onSelect: ((Int) -> Void)?
    var onClose: ((Int) -> Void)?
    var onNew: (() -> Void)?

    private var items: [(String, String)] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Tabs"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done,
                                                           target: self, action: #selector(doneTapped))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add,
                                                            target: self, action: #selector(newTapped))
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "tab")
        reload()
    }

    private func reload() {
        items = provider?() ?? []
        title = items.count == 1 ? "1 Tab" : "\(items.count) Tabs"
        tableView.reloadData()
    }

    @objc private func doneTapped() { dismiss(animated: true) }
    @objc private func newTapped()  { onNew?() }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        items.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        // .subtitle needs a fresh cell rather than a dequeued .default one.
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: "tab")
        let item = items[indexPath.row]
        cell.textLabel?.text = item.0
        cell.textLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        cell.detailTextLabel?.text = item.1
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.accessoryType = indexPath.row == (selectedIndex?() ?? -1) ? .checkmark : .none
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        onSelect?(indexPath.row)
    }

    override func tableView(_ tableView: UITableView,
                            commit editingStyle: UITableViewCell.EditingStyle,
                            forRowAt indexPath: IndexPath) {
        guard editingStyle == .delete else { return }
        onClose?(indexPath.row)
        reload()
    }
}