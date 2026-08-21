import UIKit
import WebKit
import UniformTypeIdentifiers

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
    private var downloadsItem = UIBarButtonItem()
    private let moreButton = UIButton(type: .system)
    private var reloadButton = UIButton(type: .system)

    private var observations: [NSKeyValueObservation] = []
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var jobs: [ScrayDownloadJob] = []
    private let downloadBar = ScrayDownloadBar()
    private var exportingTempFiles: [URL] = []
    private var pendingExportJobID: String?
    /// WKDownload keys we cancelled ourselves in order to pause, so the
    /// resulting failure callback isn't mistaken for a real one.
    private var pausingKeys: Set<ObjectIdentifier> = []
    /// Destinations for downloads being resumed — a resumed transfer must go
    /// back to the same partial file, and must not re-prompt.
    private var resumeDestinations: [ObjectIdentifier: URL] = [:]

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
        reloadButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        reloadButton.addTarget(self, action: #selector(reloadTapped), for: .touchUpInside)
        reloadButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        moreButton.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        moreButton.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)
        moreButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

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

        let header = UIStackView(arrangedSubviews: [addressField, reloadButton, moreButton])
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

        // ✕ sits bottom-left where the thumb already is, rather than up in
        // the header next to the address bar.
        let closeItem = UIBarButtonItem(image: UIImage(systemName: "xmark"),
                                        style: .plain, target: self, action: #selector(closeTapped))
        backItem = UIBarButtonItem(image: UIImage(systemName: "chevron.left"),
                                   style: .plain, target: self, action: #selector(backTapped))
        forwardItem = UIBarButtonItem(image: UIImage(systemName: "chevron.right"),
                                      style: .plain, target: self, action: #selector(forwardTapped))
        let homeItem = UIBarButtonItem(image: UIImage(systemName: "house"),
                                       style: .plain, target: self, action: #selector(homeTapped))
        tabsItem = UIBarButtonItem(title: "1 ⧉", style: .plain, target: self, action: #selector(tabsTapped))
        downloadsItem = UIBarButtonItem(image: UIImage(systemName: "tray.and.arrow.down"),
                                        style: .plain, target: self, action: #selector(downloadsTapped))
        func flex() -> UIBarButtonItem {
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        }
        backItem.isEnabled = false
        forwardItem.isEnabled = false
        toolbar.items = [closeItem, flex(), backItem, flex(), forwardItem, flex(), homeItem,
                         flex(), tabsItem, flex(), downloadsItem]
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        downloadBar.translatesAutoresizingMaskIntoConstraints = false
        downloadBar.isHidden = true
        downloadBar.onCancel = { [weak self] in self?.cancelActiveDownload() }
        // Tapping the bar opens the full list, same as the tray button.
        downloadBar.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(downloadsTapped)))

        view.addSubview(header)
        view.addSubview(progressView)
        view.addSubview(webContainer)
        view.addSubview(downloadBar)
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

            // Floats over the bottom of the page rather than resizing it —
            // a reflow mid-download would be worse than 52pt of overlap.
            downloadBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            downloadBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            downloadBar.bottomAnchor.constraint(equalTo: toolbar.topAnchor),
            downloadBar.heightAnchor.constraint(equalToConstant: 52),

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

    @objc private func downloadsTapped() {
        let list = ScrayDownloadsViewController(style: .insetGrouped)
        list.onCancel = { [weak self] id in self?.cancelDownload(id: id) }
        list.onPause  = { [weak self] id in self?.pauseDownload(id: id) }
        list.onResume = { [weak self] id in self?.resumeDownload(id: id) }
        let nav = UINavigationController(rootViewController: list)
        presentSafely(nav)
    }

    @objc private func moreTapped() {
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.popoverPresentationController?.sourceView = moreButton
        sheet.popoverPresentationController?.sourceRect = moreButton.bounds

        let active = ScrayDownloadCenter.shared.activeCount
        let downloadsTitle = active > 0 ? "Downloads (\(active) active)" : "Downloads"
        sheet.addAction(UIAlertAction(title: downloadsTitle, style: .default) { [weak self] _ in
            self?.downloadsTapped()
        })

        sheet.addAction(UIAlertAction(title: "New Tab", style: .default) { [weak self] _ in
            self?.newTabTapped()
        })

        sheet.addAction(UIAlertAction(title: "Open in Safari", style: .default) { [weak self] _ in
            self?.safariTapped()
        })

        let folder = ScrayDownloadFolder.shared
        let label = folder.hasFolder
            ? "Save Downloads To → \(folder.displayName ?? "folder")"
            : "Save Downloads To → ask every time"
        sheet.addAction(UIAlertAction(title: label, style: .default) { [weak self] _ in
            guard let self = self else { return }
            ScrayDownloadFolder.shared.choose(from: self.dialogPresenter()) { name in
                guard let name = name else { return }
                self.flash("Downloads will be saved to \(name)")
            }
        })

        if folder.hasFolder {
            sheet.addAction(UIAlertAction(title: "Ask Every Time Instead", style: .destructive) { [weak self] _ in
                ScrayDownloadFolder.shared.clear()
                self?.flash("Downloads will ask where to save")
            })
        }

        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        presentSafely(sheet)
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
        guard webView === currentWebView else { return }
        let ns = error as NSError
        // Turning a navigation into a download *cancels* the navigation, and
        // WebKit reports that as "Frame load interrupted" (WebKitErrorDomain
        // 102). Nothing went wrong — the download is starting. 101 is the same
        // story for a URL WebKit won't display itself.
        let benign = ns.code == NSURLErrorCancelled
            || (ns.domain == "WebKitErrorDomain" && (ns.code == 101 || ns.code == 102))
        guard !benign else { return }
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

      var CHUNK = 512 * 1024;
      var pending = {};
      var seq = 0;

      function isLocal(href) { return /^(blob:|data:)/i.test(href || ''); }

      function post(payload) {
        try { window.webkit.messageHandlers.scrayDownload.postMessage(payload); }
        catch (e) { console.error('[download] bridge unavailable', e); }
      }

      // Phase one: hand over the name and size straight away so the prompt
      // can appear before a single byte has been copied. Resolving a blob:
      // URL is a lookup, not a read, so this is instant.
      function offer(href, filename) {
        var id = 'dl' + (++seq);
        fetch(href)
          .then(function (r) { return r.blob(); })
          .then(function (blob) {
            pending[id] = { blob: blob, offset: 0, paused: false, running: false };
            post({ phase: 'offer', id: id, filename: filename || 'download', size: blob.size });
          })
          .catch(function (err) {
            post({ phase: 'error', id: id, message: String((err && err.message) || err) });
          });
      }

      function b64(chunk) {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () {
            var s = String(fr.result);
            resolve(s.slice(s.indexOf(',') + 1));
          };
          fr.onerror = function () { reject(fr.error); };
          fr.readAsDataURL(chunk);
        });
      }

      window.__scrayDownloadCancel = function (id) { delete pending[id]; };

      window.__scrayDownloadPause = function (id) {
        var job = pending[id];
        if (job) job.paused = true;
      };

      window.__scrayDownloadResume = function (id) {
        var job = pending[id];
        if (!job || !job.paused) return;
        job.paused = false;
        if (!job.running) pump(id);
      };

      // Phase two: stream it. Chunked so the native side can show real
      // progress, so a big export isn't one enormous bridge message, and so
      // pausing means simply not scheduling the next chunk — the offset is
      // already on the job, so resuming picks up exactly where it stopped.
      function pump(id) {
        var job = pending[id];
        if (!job) return;                                 // cancelled
        if (job.paused) { job.running = false; return; }
        job.running = true;

        if (job.offset >= job.blob.size) {
          delete pending[id];
          post({ phase: 'done', id: id });
          return;
        }

        var end = Math.min(job.offset + CHUNK, job.blob.size);
        b64(job.blob.slice(job.offset, end))
          .then(function (data) {
            var live = pending[id];
            if (!live) return;                            // cancelled mid-chunk
            post({ phase: 'chunk', id: id, base64: data });
            live.offset = end;
            if (live.paused) { live.running = false; return; }
            setTimeout(function () { pump(id); }, 0);     // let the UI breathe
          })
          .catch(function (err) {
            delete pending[id];
            post({ phase: 'error', id: id, message: String((err && err.message) || err) });
          });
      }

      window.__scrayDownloadStart = function (id) {
        if (!pending[id]) { post({ phase: 'error', id: id, message: 'Nothing to download' }); return; }
        pump(id);
      };

      // Picker builds its anchors detached and calls .click() directly, so a
      // document listener alone would never see them.
      var origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download') && isLocal(this.href)) {
          offer(this.href, this.getAttribute('download'));
          return;
        }
        return origClick.apply(this, arguments);
      };

      document.addEventListener('click', function (e) {
        var a = (e.target && e.target.closest) ? e.target.closest('a[download]') : null;
        if (a && isLocal(a.href)) {
          e.preventDefault();
          e.stopPropagation();
          offer(a.href, a.getAttribute('download'));
        }
      }, true);

      var origOpen = window.open;
      window.open = function (url) {
        if (isLocal(url)) { offer(url, 'download'); return null; }
        return origOpen.apply(window, arguments);
      };
    })();
    """

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "scrayDownload",
              let body = message.body as? [String: Any],
              let phase = body["phase"] as? String,
              let id = body["id"] as? String else { return }

        switch phase {

        case "offer":
            let name = sanitizedFilename(body["filename"] as? String)
            let size = (body["size"] as? NSNumber)?.int64Value ?? 0
            let webView = message.webView
            confirmDownload(filename: name, size: size) { [weak self] proceed in
                guard let self = self else { return }
                let escaped = id.replacingOccurrences(of: "'", with: "")
                guard proceed else {
                    webView?.evaluateJavaScript("window.__scrayDownloadCancel('\(escaped)')")
                    return
                }
                guard let url = self.makeTempDestination(filename: name),
                      FileManager.default.createFile(atPath: url.path, contents: nil),
                      let handle = try? FileHandle(forWritingTo: url) else {
                    webView?.evaluateJavaScript("window.__scrayDownloadCancel('\(escaped)')")
                    self.showAlert(title: "Download failed", message: "Couldn't open a temporary file.")
                    return
                }
                let job = ScrayDownloadJob(id: id, filename: name)
                job.totalBytes = size
                job.fileURL = url
                job.handle = handle
                job.webView = webView
                ScrayDownloadCenter.shared.begin(id: id, filename: name, total: size)
                self.jobs.append(job)
                self.refreshDownloadBar()
                webView?.evaluateJavaScript("window.__scrayDownloadStart('\(escaped)')")
            }

        case "chunk":
            guard let job = jobs.first(where: { $0.id == id }),
                  let base64 = body["base64"] as? String,
                  let data = Data(base64Encoded: base64) else { return }
            try? job.handle?.write(contentsOf: data)
            job.receivedBytes += Int64(data.count)
            refreshDownloadBar()

        case "done":
            guard let idx = jobs.firstIndex(where: { $0.id == id }) else { return }
            let job = jobs.remove(at: idx)
            try? job.handle?.close()
            refreshDownloadBar()
            if let url = job.fileURL { deliver(fileURL: url, jobID: job.id) }

        case "error":
            let reason = body["message"] as? String ?? "Unknown error"
            ScrayDownloadCenter.shared.fail(id: id, message: reason)
            discardJob(id: id)
            showAlert(title: "Download failed", message: reason)

        default:
            break
        }
    }

    fileprivate func refreshDownloadBar() {
        for job in jobs {
            ScrayDownloadCenter.shared.progress(id: job.id,
                                                received: job.receivedBytes,
                                                total: job.totalBytes)
        }
        // The tray lights up while anything is in flight.
        downloadsItem.tintColor = jobs.isEmpty
            ? nil
            : UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0)

        guard let job = jobs.first else {
            downloadBar.isHidden = true
            return
        }
        downloadBar.isHidden = false
        downloadBar.update(filename: job.filename,
                           received: job.receivedBytes,
                           total: job.totalBytes,
                           queued: jobs.count - 1)
    }

    private func discardJob(id: String) {
        guard let idx = jobs.firstIndex(where: { $0.id == id }) else { return }
        let job = jobs.remove(at: idx)
        job.progressObs?.invalidate()
        try? job.handle?.close()
        if let url = job.fileURL {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        refreshDownloadBar()
    }

    fileprivate func cancelActiveDownload() {
        guard let job = jobs.first else { return }
        cancelDownload(id: job.id)
    }

    fileprivate func pauseDownload(id: String) {
        guard let job = jobs.first(where: { $0.id == id }) else { return }

        if let webView = job.webView {
            let escaped = job.id.replacingOccurrences(of: "'", with: "")
            webView.evaluateJavaScript("window.__scrayDownloadPause && window.__scrayDownloadPause('\(escaped)')")
            job.pausedInPage = true
            ScrayDownloadCenter.shared.pause(id: id)
            return
        }

        // WKDownload has no pause. Cancelling *with resume data* is the whole
        // mechanism — the partial file stays where it is and the token we get
        // back is what lets it carry on later.
        guard #available(iOS 14.5, *) else { return }
        guard let dl = job.httpDownload as? WKDownload,
              let key = job.httpKey,
              let dest = downloadDestinations[key] else { return }

        pausingKeys.insert(key)
        job.fileURL = dest
        job.progressObs?.invalidate()
        job.progressObs = nil

        dl.cancel { [weak self] data in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.downloadDestinations.removeValue(forKey: key)
                job.httpKey = nil
                job.httpDownload = nil
                guard let data = data else {
                    // Server won't do ranged requests, so there's no resuming
                    // this one. Better to say so than to leave a dead row.
                    self.discardJob(id: id)
                    ScrayDownloadCenter.shared.cancel(id: id)
                    self.showAlert(title: "Can't pause",
                                   message: "This download can't be resumed, so it was stopped.")
                    return
                }
                job.resumeData = data
                ScrayDownloadCenter.shared.pause(id: id)
                self.refreshDownloadBar()
            }
        }
    }

    fileprivate func resumeDownload(id: String) {
        guard let job = jobs.first(where: { $0.id == id }) else { return }

        if let webView = job.webView {
            let escaped = job.id.replacingOccurrences(of: "'", with: "")
            webView.evaluateJavaScript("window.__scrayDownloadResume && window.__scrayDownloadResume('\(escaped)')")
            job.pausedInPage = false
            ScrayDownloadCenter.shared.resume(id: id)
            return
        }

        guard #available(iOS 14.5, *) else { return }
        guard let data = job.resumeData, let host = currentWebView else { return }

        job.wasResumed = true
        host.resumeDownload(fromResumeData: data) { [weak self] download in
            guard let self = self else { return }
            download.delegate = self
            let key = ObjectIdentifier(download)
            job.httpKey = key
            job.httpDownload = download
            job.resumeData = nil
            if let dest = job.fileURL {
                self.downloadDestinations[key] = dest
                self.resumeDestinations[key] = dest
            }
            job.progressObs = self.makeProgressObserver(for: job, download: download)
            ScrayDownloadCenter.shared.resume(id: id)
            self.refreshDownloadBar()
        }
    }

    /// A resumed WKDownload reports progress against the remainder, not the
    /// whole file, so its own counters would make the bar jump backwards.
    /// The partial file on disk is the one number that's always right.
    @available(iOS 14.5, *)
    fileprivate func makeProgressObserver(for job: ScrayDownloadJob,
                                          download: WKDownload) -> NSKeyValueObservation {
        return download.progress.observe(\.fractionCompleted) { [weak self, weak job] progress, _ in
            DispatchQueue.main.async {
                guard let job = job else { return }
                if job.wasResumed, let path = job.fileURL?.path,
                   let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size]) as? NSNumber {
                    job.receivedBytes = size.int64Value
                } else {
                    job.receivedBytes = progress.completedUnitCount
                }
                if progress.totalUnitCount > 0, !job.wasResumed {
                    job.totalBytes = progress.totalUnitCount
                }
                self?.refreshDownloadBar()
            }
        }
    }

    fileprivate func cancelDownload(id: String) {
        guard let job = jobs.first(where: { $0.id == id }) else {
            // No live transfer — the record is all that's left of it.
            ScrayDownloadCenter.shared.cancel(id: id)
            return
        }
        if #available(iOS 14.5, *), let dl = job.httpDownload as? WKDownload {
            dl.cancel { _ in }
        }
        job.resumeData = nil
        if let key = job.httpKey {
            downloadDestinations.removeValue(forKey: key)
            resumeDestinations.removeValue(forKey: key)
            pausingKeys.remove(key)
        }
        if let webView = job.webView {
            let escaped = job.id.replacingOccurrences(of: "'", with: "")
            webView.evaluateJavaScript("window.__scrayDownloadCancel && window.__scrayDownloadCancel('\(escaped)')")
        }
        ScrayDownloadCenter.shared.cancel(id: job.id)
        discardJob(id: job.id)
    }

    private func sanitizedFilename(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = trimmed
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return cleaned.isEmpty ? "download" : cleaned
    }

    /// The Safari-style "do you want to download this?" prompt. Also the point
    /// at which the destination is named, so there's no surprise about where
    /// the file went.
    fileprivate func confirmDownload(filename: String, size: Int64, completion: @escaping (Bool) -> Void) {
        DispatchQueue.main.async {
            let folder = ScrayDownloadFolder.shared
            var bits: [String] = []
            if size > 0 {
                let f = ByteCountFormatter()
                f.countStyle = .file
                bits.append(f.string(fromByteCount: size))
            }
            if folder.hasFolder { bits.append("Saving to \(folder.displayName ?? "your folder")") }
            let alert = UIAlertController(
                title: "Download “\(filename)”?",
                message: bits.isEmpty ? nil : bits.joined(separator: " · "),
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completion(false) })
            alert.addAction(UIAlertAction(title: "Download", style: .default) { _ in completion(true) })
            self.presentSafely(alert)
        }
    }

    /// Straight into the chosen folder if there is one, otherwise the export
    /// sheet. A folder that's been moved or deleted since it was picked falls
    /// back to the sheet rather than dropping the file on the floor.
    fileprivate func deliver(fileURL: URL, jobID: String?) {
        DispatchQueue.main.async {
            if let saved = ScrayDownloadFolder.shared.save(fileURL: fileURL) {
                try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
                if let id = jobID { ScrayDownloadCenter.shared.finish(id: id, savedURL: saved) }
                self.flash("Saved \(saved.lastPathComponent)")
                return
            }
            self.exportingTempFiles.append(fileURL)
            self.pendingExportJobID = jobID
            let picker = UIDocumentPickerViewController(forExporting: [fileURL])
            picker.delegate = self
            self.presentSafely(picker)
        }
    }

    fileprivate func makeTempDestination(filename: String) -> URL? {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("scray-downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        return dir.appendingPathComponent(filename)
    }

    /// A brief, self-dismissing confirmation — the download equivalent of
    /// Safari's little bounce, so a silent save to a folder isn't silent.
    fileprivate func flash(_ message: String) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        presentSafely(alert)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { alert.dismiss(animated: true) }
    }

    /// UIKit silently drops a present() that lands mid-transition, which is
    /// exactly what happens when a download finishes while another sheet is
    /// still animating away — the file picker then never appears, or appears
    /// much later once something else nudges the run loop.
    fileprivate func presentSafely(_ vc: UIViewController, attempt: Int = 0) {
        let top = dialogPresenter()
        if top.isBeingPresented || top.isBeingDismissed || top.transitionCoordinator != nil {
            guard attempt < 60 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.presentSafely(vc, attempt: attempt + 1)
            }
            return
        }
        top.present(vc, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        // forExporting: hands back where the file actually landed, which is
        // the only way the list can offer to open it again later.
        if let id = pendingExportJobID {
            ScrayDownloadCenter.shared.finish(id: id, savedURL: urls.first)
            pendingExportJobID = nil
        }
        cleanupExports()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let id = pendingExportJobID {
            ScrayDownloadCenter.shared.cancel(id: id)
            pendingExportJobID = nil
        }
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
        presentSafely(alert)
    }
}

// MARK: - WKDownloadDelegate

@available(iOS 14.5, *)
extension ScrayBrowserViewController: WKDownloadDelegate {

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        // A resume lands here too, but it already has a destination and an
        // answered prompt — asking again would be nonsense and would point
        // the transfer at a fresh empty file.
        let key = ObjectIdentifier(download)
        if let known = resumeDestinations.removeValue(forKey: key) {
            downloadDestinations[key] = known
            completionHandler(known)
            return
        }

        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let expected = response.expectedContentLength > 0 ? response.expectedContentLength : 0

        // The completion handler may be called asynchronously, which is what
        // lets the prompt sit in front of it. The transfer only starts once
        // this returns a destination — so everything after the tap is real
        // work, and the bar below shows it happening.
        confirmDownload(filename: name, size: expected) { [weak self] proceed in
            guard let self = self, proceed,
                  let dest = self.makeTempDestination(filename: name) else {
                completionHandler(nil)   // nil cancels the download
                return
            }
            self.downloadDestinations[key] = dest

            let job = ScrayDownloadJob(id: UUID().uuidString, filename: name)
            job.totalBytes = expected
            job.httpKey = key
            job.httpDownload = download
            job.progressObs = self.makeProgressObserver(for: job, download: download)
            ScrayDownloadCenter.shared.begin(id: job.id, filename: name, total: expected)
            self.jobs.append(job)
            self.refreshDownloadBar()
            completionHandler(dest)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        var jobID: String?
        if let idx = jobs.firstIndex(where: { $0.httpKey == key }) {
            jobID = jobs[idx].id
            jobs[idx].progressObs?.invalidate()
            jobs.remove(at: idx)
            refreshDownloadBar()
        }
        guard let url = downloadDestinations.removeValue(forKey: key) else { return }
        deliver(fileURL: url, jobID: jobID)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)

        // We cancelled this one ourselves to pause it. The job stays put.
        if pausingKeys.remove(key) != nil { return }

        if let idx = jobs.firstIndex(where: { $0.httpKey == key }) {
            ScrayDownloadCenter.shared.fail(id: jobs[idx].id, message: error.localizedDescription)
            jobs[idx].progressObs?.invalidate()
            jobs.remove(at: idx)
            refreshDownloadBar()
        }
        // No recorded destination means we cancelled it ourselves — at the
        // prompt, or from the bar. Not a failure worth an alert.
        guard downloadDestinations.removeValue(forKey: key) != nil else { return }
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