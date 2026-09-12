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

    /// Whether the browser is up right now (or on its way up or down).
    var isShowing: Bool { controller?.presentingViewController != nil }

    /// Open the browser where it was left - the run monitor's ring.
    func resume() {
        guard let vc = controller else { return }
        present(url: nil, home: vc.homeURL.absoluteString)
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

    /// The tab that asked for a StashDB search via scraynative://newtab.
    /// The return-arrow button hands the scene URL back to this tab rather
    /// than dismissing, because when Picker is the requester the modal
    /// waiting for that URL lives inside this browser, not behind it.
    private weak var stashRequester: WKWebView?

    private var webConfig: WKWebViewConfiguration!
    private let messageProxy = ScrayBrowserMessageProxy()
    /// Serves scray-video:// in this browser too, so Wholesale can preview a
    /// file that is already on the device without going near the network.
    private let videoSchemeHandler = VideoSchemeHandler()

    private var popupWebView: WKWebView?
    private weak var popupController: UIViewController?

    private let addressField = UITextField()
    /// The row the address field sits in. Held because the collapsed chrome
    /// (see setChrome) tightens its margins and hides its buttons.
    private var headerStack: UIStackView!
    private var addressHeight: NSLayoutConstraint!
    private var toolbarHeight: NSLayoutConstraint!
    /// Whether the page is scrolled far enough down that the chrome has got
    /// out of the way, the way Safari's does.
    private var chromeCollapsed = false
    /// stashButton's own reason to be hidden, kept apart from the collapsed
    /// state so the two cannot fight over the same flag.
    private var stashEligible = false
    private var lastScrollY: CGFloat = 0
    private var scrollObservation: NSKeyValueObservation?
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let webContainer = UIView()
    private let toolbar = UIToolbar()
    private var backItem = UIBarButtonItem()
    private var forwardItem = UIBarButtonItem()
    private var tabsItem = UIBarButtonItem()
    private var downloadsItem = UIBarButtonItem()
    private let trayButton = ScrayTrayButton(frame: .zero)
    private let toastView = ScrayToastView(frame: .zero)
    private var toastBottom: NSLayoutConstraint!
    private var toastHide: DispatchWorkItem?
    private let moreButton = UIButton(type: .system)
    private var reloadButton = UIButton(type: .system)
    /// StashDB only — see refreshChrome(). Hands the scene URL back to the
    /// stash modal that is still open behind this browser.
    private var stashButton = UIButton(type: .system)
    private var homeButton = UIButton(type: .system)

    private var observations: [NSKeyValueObservation] = []
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var jobs: [ScrayDownloadJob] = []
    private let downloadBar = ScrayDownloadBar()
    private let downloadPill = ScrayDownloadPill()
    /// Bar folded down to the pill. Cleared once the queue empties, so a
    /// minimise only ever applies to the downloads it was tapped for.
    private var downloadBarMinimised = false
    /// Downloads started by Wholesale over the bridge. Their failures are
    /// reported to the page, which is already showing a run summary — forty
    /// modal alerts stacking up behind a batch is not a useful way to learn
    /// that the wifi dropped.
    private var wholesaleJobIDs: Set<String> = []
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
        webConfig?.userContentController.removeScriptMessageHandler(forName: "scrayBridge")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildConfiguration()
        buildChrome()
        ScrayDownloadCenter.shared.onCountChange = { [weak self] in self?.refreshTray() }
        refreshTray()
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

        // Picker's Wholesale page runs HERE, not in Native's own web view, so
        // without this it has no way to see what is actually on the device.
        // Same action names and the same resolve/reject contract as
        // ScrayNativeView's handler, so one page's code works in both.
        config.userContentController.add(messageProxy, name: "scrayBridge")
        config.setURLSchemeHandler(videoSchemeHandler, forURLScheme: "scray-video")

        // Lets Picker tell it is inside Native's own browser rather than
        // Safari. The "N" button only works here, because this is the only
        // place the scraynative:// hop can be caught and this modal dismissed.
        config.userContentController.addUserScript(
            WKUserScript(source: "window.SCRAY_IN_APP_BROWSER = true;",
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )
        config.userContentController.addUserScript(
            WKUserScript(source: Self.downloadShimJS,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: false)
        )
        config.userContentController.addUserScript(
            WKUserScript(source: bridgeShimJS(host: homeURL.host ?? ""),
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )

        webConfig = config
    }

    // MARK: - Chrome

    private func buildChrome() {
        reloadButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        reloadButton.addTarget(self, action: #selector(reloadTapped), for: .touchUpInside)
        reloadButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        homeButton.setImage(UIImage(systemName: "house"), for: .normal)
        homeButton.addTarget(self, action: #selector(homeTapped), for: .touchUpInside)
        homeButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        moreButton.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        moreButton.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)
        moreButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        // Hidden everywhere except stashdb.org, so it reads as "this page is
        // the one Scray is waiting for" rather than as general chrome.
        stashButton.setImage(UIImage(systemName: "arrow.turn.right.up"), for: .normal)
        stashButton.tintColor = .systemGreen
        stashButton.addTarget(self, action: #selector(stashTapped), for: .touchUpInside)
        stashButton.widthAnchor.constraint(equalToConstant: 36).isActive = true
        stashButton.isHidden = true

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
        addressHeight = addressField.heightAnchor.constraint(equalToConstant: 34)
        addressHeight.isActive = true

        let header = UIStackView(arrangedSubviews: [addressField, stashButton, homeButton, moreButton])
        headerStack = header
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
        // reloadButton stays a UIButton rather than becoming a plain bar item,
        // because updateChrome() swaps its image to xmark while a page is
        // loading - the same reason trayButton is a custom view.
        let reloadItem = UIBarButtonItem(customView: reloadButton)
        tabsItem = UIBarButtonItem(title: "1 ⧉", style: .plain, target: self, action: #selector(tabsTapped))
        // A custom view rather than a plain item, because a bar button item
        // has nowhere to hang a badge.
        trayButton.addTarget(self, action: #selector(downloadsTapped), for: .touchUpInside)
        downloadsItem = UIBarButtonItem(customView: trayButton)
        func flex() -> UIBarButtonItem {
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        }
        backItem.isEnabled = false
        forwardItem.isEnabled = false
        toolbar.items = [closeItem, flex(), backItem, flex(), forwardItem, flex(), reloadItem,
                         flex(), tabsItem, flex(), downloadsItem]
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        downloadBar.translatesAutoresizingMaskIntoConstraints = false
        downloadBar.isHidden = true
        // The corner button minimises rather than cancels — the bar covers
        // the page's own bottom-corner controls, and getting at them shouldn't
        // cost you the transfer. Cancelling is still in the downloads list.
        downloadBar.onMinimise = { [weak self] in
            guard let self = self else { return }
            self.downloadBarMinimised = true
            self.refreshDownloadBar()
        }
        downloadPill.onTap = { [weak self] in
            guard let self = self else { return }
            self.downloadBarMinimised = false
            self.refreshDownloadBar()
        }
        // Tapping the bar opens the full list, same as the tray button.
        downloadBar.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(downloadsTapped)))

        view.addSubview(header)
        view.addSubview(progressView)
        view.addSubview(webContainer)
        view.addSubview(downloadBar)
        view.addSubview(downloadPill)
        view.addSubview(toolbar)

        toastView.translatesAutoresizingMaskIntoConstraints = false
        toastView.onTap = { [weak self] in
            self?.hideToast(animated: false)
            self?.downloadsTapped()
        }
        view.addSubview(toastView)
        toastBottom = toastView.bottomAnchor.constraint(equalTo: toolbar.topAnchor, constant: -6)

        toolbar.clipsToBounds = true        // its items must not spill out of a 0pt bar
        toolbarHeight = toolbar.heightAnchor.constraint(equalToConstant: 44)

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

            // Top-right, just under the address bar: clear of the page's
            // corner buttons at bottom-left and of the tray button and its
            // toast at bottom-right.
            downloadPill.topAnchor.constraint(equalTo: progressView.bottomAnchor, constant: 10),
            downloadPill.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),

            toastBottom,
            toastView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            toastView.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),

            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            toolbarHeight
        ])
    }

    // MARK: - Chrome that gets out of the way
    //
    // The same bargain every mobile browser makes: scrolling down hands the
    // page the screen, scrolling up hands the controls back. The address bar
    // shrinks to a strip with the URL still on it - so you can always see
    // where you are - and the bottom bar goes altogether.
    //
    // The web view is LAID OUT between the two (webContainer is pinned to the
    // progress bar and to the toolbar), not overlaid by them, so collapsing
    // the chrome genuinely gives the page those points: its viewport grows,
    // it fires a resize, and anything the page positions from the top of the
    // screen - Picker's fullscreen title bar, for one - moves up with it.

    // ⚙️ The collapsed strip's height, and how far you have to scroll before
    // anything happens. The thresholds are deliberately uneven: coming back
    // should take a more definite gesture than going away.
    private static let chromeStripHeight: CGFloat = 20
    private static let chromeFullHeight:  CGFloat = 34
    private static let chromeHideAfter:   CGFloat = 6
    private static let chromeShowAfter:   CGFloat = 10

    /// Follows the page's scroll without taking its delegate. WKWebView's
    /// scroll view already has one - its own - and replacing it is what
    /// breaks pinch-zoom and rubber-banding in other people's browsers.
    private func observeScroll(of wv: WKWebView) {
        scrollObservation?.invalidate()
        lastScrollY = wv.scrollView.contentOffset.y
        scrollObservation = wv.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] sv, _ in
            self?.scrollChanged(sv)
        }
    }

    private func scrollChanged(_ sv: UIScrollView) {
        let y = sv.contentOffset.y
        defer { lastScrollY = y }

        // The top of a page always shows the chrome, however you got there.
        if y <= 4 { setChrome(collapsed: false); return }
        // Only a finger moves it: a page that scrolls itself - an anchor, a
        // restored position, the player seeking - is not a request for room.
        guard sv.isDragging || sv.isDecelerating else { return }
        // Nothing to get out of the way of on a page that barely scrolls.
        guard sv.contentSize.height > sv.bounds.height + 120 else { return }

        let dy = y - lastScrollY
        if dy > Self.chromeHideAfter { setChrome(collapsed: true) }
        else if dy < -Self.chromeShowAfter { setChrome(collapsed: false) }
    }

    private func setChrome(collapsed: Bool) {
        guard collapsed != chromeCollapsed, isViewLoaded else { return }
        // Never while you are typing in it, and never with something on top.
        if collapsed && (addressField.isFirstResponder || presentedViewController != nil) { return }
        chromeCollapsed = collapsed

        addressHeight.constant = collapsed ? Self.chromeStripHeight : Self.chromeFullHeight
        toolbarHeight.constant = collapsed ? 0 : 44

        UIView.animate(withDuration: 0.22, delay: 0,
                       options: [.curveEaseOut, .beginFromCurrentState]) {
            self.addressField.font = .systemFont(ofSize: collapsed ? 10.5 : 13)
            self.headerStack.layoutMargins = UIEdgeInsets(top: collapsed ? 1 : 4, left: 6,
                                                          bottom: collapsed ? 1 : 4, right: 6)
            // isHidden inside a stack view animates the width away, which is
            // what makes the strip go full width rather than leaving gaps.
            self.homeButton.isHidden  = collapsed
            self.moreButton.isHidden  = collapsed
            self.stashButton.isHidden = collapsed || !self.stashEligible
            self.toolbar.alpha = collapsed ? 0 : 1
            self.view.layoutIfNeeded()
        }
    }

    /// Put the chrome back. Anything that changes what the page IS - a new
    /// URL, a new tab, coming back to the browser - starts from the top.
    private func showChrome() { setChrome(collapsed: false) }

    // MARK: - Tabs

    private func makeWebView(configuration: WKWebViewConfiguration?) -> WKWebView {
        let wv = WKWebView(frame: webContainer.bounds, configuration: configuration ?? webConfig)
        videoSchemeHandler.webView = wv
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
        observeScroll(of: wv)
        showChrome()

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

    /// Close a batch picked in the tab list. Indices are into the list as the
    /// user saw it, so they are removed high-to-low — deleting low-first would
    /// shift everything after it and close the wrong rows.
    private func closeTabs(_ indices: [Int]) {
        let valid = indices.filter { tabs.indices.contains($0) }
        guard !valid.isEmpty else { return }

        // If the tab currently on screen survives the cull, stay on it rather
        // than jumping somewhere arbitrary.
        let survivor = valid.contains(currentIndex) ? nil : currentTab

        for i in valid.sorted(by: >) {
            let tab = tabs.remove(at: i)
            tab.webView.stopLoading()
            tab.webView.removeFromSuperview()
        }

        if tabs.isEmpty {
            addTab(url: homeURL, select: true)
            return
        }
        if let survivor = survivor, let idx = tabs.firstIndex(where: { $0 === survivor }) {
            selectTab(idx)
        } else {
            selectTab(min(valid.min() ?? 0, tabs.count - 1))
        }
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
                self?.showChrome()      // a new page starts with its controls
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
        // Deliberately above the isFirstResponder guard below: the button's
        // visibility has nothing to do with whether the address bar is being
        // edited, and hiding it mid-edit would be a nasty surprise.
        let stashHost = (currentTab?.displayURL?.host ?? "").lowercased()
        stashEligible = (stashHost == "stashdb.org" || stashHost.hasSuffix(".stashdb.org"))
        // Two reasons to be hidden, and only one of them is about the host.
        stashButton.isHidden = !stashEligible || chromeCollapsed
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

    /// Set when a download actually lands somewhere. The rescan waits for
    /// dismissal rather than firing per file: the main list is behind this
    /// modal so nothing is visible until then, and scanLocalLibrary is a full
    /// metadata pass over the folder.
    fileprivate var libraryNeedsRefresh = false

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        ScrayRunMonitor.shared.browserWillShow()
        // A checkout page parked in the window while the browser was closed
        // has just been taken back out of it (see ScrayRunMonitor). Put the
        // tab on screen back in its container. A no-op on every other
        // appearance, including a sheet going away over the browser.
        if let tab = currentTab, tab.webView.superview !== webContainer {
            selectTab(currentIndex)
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // Keeps a running basket checkout alive and on the screen as a ring.
        if isBeingDismissed { ScrayRunMonitor.shared.browserDidHide() }
        // This also fires when a document picker or share sheet goes up over
        // the browser, which is not the browser going away.
        guard isBeingDismissed, libraryNeedsRefresh else { return }
        libraryNeedsRefresh = false
        ScrayNativeView.current?.refreshLocalFolder()
    }
    @objc private func homeTapped()    { openOrFocus(homeURL) }
    @objc private func backTapped()    { if currentWebView?.canGoBack == true { currentWebView?.goBack() } }
    @objc private func forwardTapped() { if currentWebView?.canGoForward == true { currentWebView?.goForward() } }
    @objc private func newTabTapped()  { addTab(url: homeURL, select: true); addressField.becomeFirstResponder() }

    @objc private func reloadTapped() {
        guard let wv = currentWebView else { return }
        if wv.isLoading { wv.stopLoading() } else if wv.url != nil { wv.reload() }
        else { wv.load(URLRequest(url: homeURL)) }
    }

    /// StashDB only. Dismiss first, then deliver — same reasoning as the
    /// scraynative:// branch in decidePolicyFor: the stash modal is behind
    /// this full-screen browser, so writing into it before dismissal would
    /// update something nobody can see.
    @objc private func stashTapped() {
        guard let url = currentTab?.displayURL?.absoluteString, !url.isEmpty else { return }

        // Picker asked for this search from a tab in here, so the modal waiting
        // for the URL is one tab away rather than behind the browser. Switch to
        // it and inject; dismissing would hide the thing being filled in.
        if let requester = stashRequester,
           let idx = tabs.firstIndex(where: { $0.webView === requester }) {
            stashRequester = nil
            selectTab(idx)
            requester.evaluateJavaScript(Self.stashDeliveryJS(url))
            return
        }

        dismiss(animated: true) {
            ScrayNativeView.current?.deliverStashURL(url)
        }
    }

    /// Single-quoted so the URL's own & and ? need no escaping; only the two
    /// characters that could close or extend that literal are handled.
    private static func stashDeliveryJS(_ url: String) -> String {
        let escaped = url
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return "window.scrayStashUrlFromBrowser && window.scrayStashUrlFromBrowser('\(escaped)');"
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
        list.onRetry  = { [weak self] id in self?.retryDownload(id: id) }
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
        list.onCloseMany = { [weak self] rows in self?.closeTabs(rows) }
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

        // Picker's "N" button. Handled in-process, NOT via the generic
        // UIApplication.shared.open below: opening our own scheme relaunches
        // us behind this modal, so the browser would still be full-screen over
        // the player. Dismiss first, then hand the key to the main web view.
        if scheme == "scraynative" {
            decisionHandler(.cancel)
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let query = { (name: String) -> String? in
                comps?.queryItems?.first(where: { $0.name == name })?.value
            }

            // scraynative://newtab?url=… — Picker's stash search, running in a
            // tab of this browser. It cannot just call window.open: a scripted
            // open is not a link activation, so createWebViewWith below routes
            // it to the MSAL popup sheet and you end up with a browser nested
            // inside the browser. This opens a real tab and stays put.
            if (url.host ?? "").lowercased() == "newtab" {
                guard let target = query("url").flatMap({ URL(string: $0) }) else { return }
                stashRequester = webView
                addTab(url: target, select: true)
                return
            }

            // Picker's "N" button. Handled in-process, NOT via the generic
            // UIApplication.shared.open below: opening our own scheme relaunches
            // us behind this modal, so the browser would still be full-screen over
            // the player. Dismiss first, then hand the key to the main web view.
            let key = query("key")
            dismiss(animated: true) {
                if let key, !key.isEmpty {
                    ScrayNativeView.current?.playVideo(key: key)
                }
            }
            return
        }

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

    // MARK: - Device bridge

    /// The read/delete slice of ScrayBridge, for pages loaded in this browser.
    ///
    /// Gated to the home host. This browser can navigate anywhere — StashDB, a
    /// Microsoft sign-in — and deleteFile is not something to hand to whatever
    /// page happens to be loaded. The gate is enforced HERE rather than only in
    /// the injected script, because a page can rewrite anything we inject.
    private func bridgeShimJS(host: String) -> String {
        let escaped = host.lowercased()
            .replacingOccurrences(of: "\\", with: "")
            .replacingOccurrences(of: "'", with: "")
        return """
        (function () {
          if (window.ScrayBridge) return;
          if (String(location.hostname || '').toLowerCase() !== '\(escaped)') return;

          window._scrayPending = window._scrayPending || {};
          window._scrayResolve = function (id, result) {
            var p = window._scrayPending[id];
            if (p) { p.resolve(result); delete window._scrayPending[id]; }
          };
          window._scrayReject = function (id, error) {
            var p = window._scrayPending[id];
            if (p) { p.reject(new Error(error)); delete window._scrayPending[id]; }
          };

          function callNative(action, payload) {
            return new Promise(function (resolve, reject) {
              var id = Math.random().toString(36).slice(2);
              window._scrayPending[id] = { resolve: resolve, reject: reject };
              try {
                window.webkit.messageHandlers.scrayBridge.postMessage({
                  id: id, action: action, payload: payload || null
                });
              } catch (e) {
                delete window._scrayPending[id];
                reject(new Error('Bridge unavailable: ' + e));
              }
            });
          }

          // Lets a page tell this apart from Native's own web view, where the
          // bridge is the full ScrayBridge from scray-bridge.js.
          window.SCRAY_DEVICE_BRIDGE = 'browser';
          window.ScrayBridge = {
            listVideoFiles: function () { return callNative('listVideoFiles'); },
            listVideoFilesDetailed: function () { return callNative('listVideoFilesDetailed'); },
            deviceStorage: function () { return callNative('deviceStorage'); },
            deleteFile: function (relativePath) { return callNative('deleteFile', { path: relativePath }); },
            folderInfo: function () { return callNative('folderInfo'); },
            enqueueDownload: function (item) { return callNative('enqueueDownload', item); },
            downloadStatus: function (ids) { return callNative('downloadStatus', { ids: ids || null }); },
            forgetDownload: function (id) { return callNative('forgetDownload', { id: id }); },
            refreshLibrary: function () { return callNative('refreshLibrary'); },
            runStatus: function (status) { return callNative('runStatus', status || {}); }
          };
        })();
        """
    }

    private func handleBridgeMessage(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let action = body["action"] as? String else { return }

        let webView = message.webView
        let origin = message.frameInfo.securityOrigin.host.lowercased()
        guard !origin.isEmpty, origin == (homeURL.host ?? "").lowercased() else {
            bridgeReject(webView, id: id, error: "Bridge is not available on this site")
            return
        }

        switch action {
        case "listVideoFiles":
            bridgeResolve(webView, id: id, result: BookmarkStore.shared.listVideoFiles())

        case "listVideoFilesDetailed":
            bridgeResolve(webView, id: id, result: BookmarkStore.shared.listVideoFilesDetailed())

        case "deviceStorage":
            // ForImportantUsage counts purgeable space, which is what iOS
            // actually frees when a write needs room — the same reasoning as
            // ScrayNativeView's copy, and the two must agree or Wholesale's
            // figure would disagree with the app's.
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
            bridgeResolve(webView, id: id, result: storage)

        case "folderInfo":
            // Wholesale's pre-flight. Two independent bookmarks: the video
            // folder BookmarkStore lists, and the folder finished downloads
            // are copied into. They are usually the same folder, and a refresh
            // is meaningless when they are not.
            var info: [String: Any] = [
                "hasVideoFolder": BookmarkStore.shared.folderName != nil,
                "hasDownloadFolder": ScrayDownloadFolder.shared.hasFolder
            ]
            if let v = BookmarkStore.shared.folderName { info["videoFolder"] = v }
            if let d = ScrayDownloadFolder.shared.displayName { info["downloadFolder"] = d }
            bridgeResolve(webView, id: id, result: info)

        case "enqueueDownload":
            guard #available(iOS 14.5, *) else {
                bridgeReject(webView, id: id, error: "Downloads need iOS 14.5 or later")
                return
            }
            guard let payload = body["payload"] as? [String: Any],
                  let urlString = payload["url"] as? String,
                  let source = URL(string: urlString) else {
                bridgeReject(webView, id: id, error: "Invalid download payload")
                return
            }
            // Without a remembered folder, deliver() opens a document picker
            // for every finished file. Forty of those in a row is not a
            // refresh, so refuse rather than start something unstoppable.
            guard ScrayDownloadFolder.shared.hasFolder else {
                bridgeReject(webView, id: id, error: "No download folder is set")
                return
            }
            let dlName = sanitizedFilename(payload["filename"] as? String)
            let dlID = (payload["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
            let dlTotal = (payload["sizeBytes"] as? NSNumber)?.int64Value ?? 0
            guard let dlHost = (message.webView ?? currentWebView),
                  let dest = makeTempDestination(filename: dlName) else {
                bridgeReject(webView, id: id, error: "Couldn't open a temporary file")
                return
            }

            let job = ScrayDownloadJob(id: dlID, filename: dlName)
            job.totalBytes = dlTotal
            job.fileURL = dest
            ScrayDownloadCenter.shared.begin(id: dlID, filename: dlName, total: dlTotal, source: source)
            wholesaleJobIDs.insert(dlID)
            jobs.append(job)
            refreshDownloadBar()

            dlHost.startDownload(using: URLRequest(url: source)) { [weak self] download in
                guard let self = self else { return }
                download.delegate = self
                let key = ObjectIdentifier(download)
                job.httpKey = key
                job.httpDownload = download
                self.downloadDestinations[key] = dest
                // begin() has already made the record and the destination is
                // settled, so borrow the resume path's "already decided" slot:
                // decideDestinationUsing would otherwise prompt and add a
                // duplicate row for every single file.
                self.resumeDestinations[key] = dest
                job.progressObs = self.makeProgressObserver(for: job, download: download)
                self.refreshDownloadBar()
            }
            bridgeResolve(webView, id: id, result: ["started": true, "id": dlID])

        case "downloadStatus":
            let wanted = ((body["payload"] as? [String: Any])?["ids"] as? [String]).map(Set.init)
            let rows: [[String: Any]] = ScrayDownloadCenter.shared.records
                .filter { wanted == nil || wanted!.contains($0.id) }
                .map { r in
                    var row: [String: Any] = [
                        "id": r.id,
                        "filename": r.filename,
                        "state": Self.stateName(r.state),
                        "received": r.received,
                        "total": r.total,
                        "bytesPerSecond": r.bytesPerSecond
                    ]
                    // Only when there is one: a nil here would make the whole
                    // payload unserialisable and take the poll down with it.
                    if let saved = r.savedURL?.lastPathComponent { row["savedAs"] = saved }
                    return row
                }
            bridgeResolve(webView, id: id, result: rows)

        case "forgetDownload":
            guard let payload = body["payload"] as? [String: Any],
                  let dropID = payload["id"] as? String else {
                bridgeReject(webView, id: id, error: "Invalid forget payload")
                return
            }
            ScrayDownloadCenter.shared.remove(id: dropID)
            wholesaleJobIDs.remove(dropID)
            bridgeResolve(webView, id: id, result: ["success": true])

        case "refreshLibrary":
            // libraryNeedsRefresh only fires on the way out of the browser, so
            // without this the offline list stays stale until the browser is
            // closed — and Wholesale wants to show the finished state straight
            // away.
            ScrayNativeView.current?.refreshLocalFolder()
            libraryNeedsRefresh = false
            bridgeResolve(webView, id: id, result: ["success": true])

        case "runStatus":
            // basket-checkout.js, about once a second while a run is going and
            // once more with active: false at the end. Screen-on, the ring over
            // Native and keeping the page alive all hang off this.
            let status = body["payload"] as? [String: Any] ?? [:]
            let progress = ScrayRunMonitor.Progress(
                done: (status["done"] as? NSNumber)?.intValue ?? 0,
                total: (status["total"] as? NSNumber)?.intValue ?? 0,
                bytesDone: (status["bytesDone"] as? NSNumber)?.int64Value ?? 0,
                bytesTotal: (status["bytesTotal"] as? NSNumber)?.int64Value ?? 0
            )
            let active = (status["active"] as? NSNumber)?.boolValue ?? false
            ScrayRunMonitor.shared.heartbeat(active: active, progress: progress, from: webView)
            bridgeResolve(webView, id: id, result: ["success": true])

        case "deleteFile":
            guard let payload = body["payload"] as? [String: Any],
                  let relativePath = payload["path"] as? String else {
                bridgeReject(webView, id: id, error: "Invalid delete payload")
                return
            }
            do {
                try BookmarkStore.shared.deleteFile(relativePath: relativePath)
                bridgeResolve(webView, id: id, result: ["success": true, "deleted": true])
            } catch {
                bridgeReject(webView, id: id, error: error.localizedDescription)
            }

        default:
            bridgeReject(webView, id: id, error: "Unknown action: \(action)")
        }
    }

    private static func stateName(_ s: ScrayDownloadRecord.State) -> String {
        switch s {
        case .active:    return "active"
        case .paused:    return "paused"
        case .finished:  return "finished"
        case .failed:    return "failed"
        case .cancelled: return "cancelled"
        }
    }

    private func bridgeResolve(_ webView: WKWebView?, id: String, result: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: []),
              let json = String(data: data, encoding: .utf8) else {
            bridgeReject(webView, id: id, error: "Failed to serialize result")
            return
        }
        let escapedId = id.replacingOccurrences(of: "'", with: "")
        DispatchQueue.main.async {
            webView?.evaluateJavaScript("window._scrayResolve('\(escapedId)', \(json));")
        }
    }

    private func bridgeReject(_ webView: WKWebView?, id: String, error: String) {
        let escapedId = id.replacingOccurrences(of: "'", with: "")
        let escaped = error
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        DispatchQueue.main.async {
            webView?.evaluateJavaScript("window._scrayReject('\(escapedId)', '\(escaped)');")
        }
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "scrayBridge" {
            handleBridgeMessage(message)
            return
        }

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
        refreshTray()

        guard let job = jobs.first else {
            downloadBar.isHidden = true
            downloadPill.isHidden = true
            downloadBarMinimised = false
            toastBottom.constant = -6
            return
        }

        if downloadBarMinimised {
            downloadBar.isHidden = true
            downloadPill.isHidden = false
            toastBottom.constant = -6
            downloadPill.update(received: job.receivedBytes,
                                total: job.totalBytes,
                                queued: jobs.count - 1,
                                paused: job.isPaused)
            return
        }

        downloadPill.isHidden = true
        downloadBar.isHidden = false
        toastBottom.constant = -58   // clear the progress bar
        downloadBar.update(filename: job.filename,
                           received: job.receivedBytes,
                           total: job.totalBytes,
                           queued: jobs.count - 1,
                           speed: ScrayDownloadCenter.shared.speedText(id: job.id))
    }

    /// Badge counts finished-and-not-yet-cleared; the tint marks in-flight.
    fileprivate func refreshTray() {
        trayButton.badgeCount = ScrayDownloadCenter.shared.completedCount
        trayButton.tintColor = jobs.isEmpty
            ? nil
            : UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0)
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

    /// Start a failed download again from its original URL.
    ///
    /// Deliberately not a resume: a stop that produced resume data was a pause,
    /// and what actually lands in .failed is dropped connections, timeouts and
    /// 5xx - nothing worth resuming a byte range from. So this re-requests the
    /// whole file into a fresh temp destination.
    fileprivate func retryDownload(id: String) {
        guard #available(iOS 14.5, *) else { return }
        guard let record = ScrayDownloadCenter.shared.records.first(where: { $0.id == id }),
              record.state == .failed,
              let source = record.sourceURL,
              let host = currentWebView else { return }

        guard let dest = makeTempDestination(filename: record.filename) else {
            showAlert(title: "Can't retry", message: "Couldn't open a temporary file.")
            return
        }

        let job = ScrayDownloadJob(id: record.id, filename: record.filename)
        job.totalBytes = record.total
        job.fileURL = dest

        // Flip the record before the async start: it's what stops a second tap
        // on the same row queueing a duplicate transfer.
        ScrayDownloadCenter.shared.retry(id: record.id)
        jobs.append(job)
        refreshDownloadBar()

        host.startDownload(using: URLRequest(url: source)) { [weak self] download in
            guard let self = self else { return }
            download.delegate = self
            let key = ObjectIdentifier(download)
            job.httpKey = key
            job.httpDownload = download
            self.downloadDestinations[key] = dest
            // Borrowing the resume path's "destination already decided" slot.
            // The confirm prompt was answered when this was first started, and
            // tapping Retry is the answer the second time round - asking again
            // would be nonsense, and decideDestinationUsing would otherwise
            // call begin() and add a duplicate row.
            self.resumeDestinations[key] = dest
            job.progressObs = self.makeProgressObserver(for: job, download: download)
            self.refreshDownloadBar()
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
    /// The copy into the Files folder is a real byte copy. On the main thread
    /// a multi-gigabyte video freezes the app for its duration, and an
    /// iCloud-backed folder turns it into an upload. Do it off the main queue
    /// and come back only for the UI.
    fileprivate func deliver(fileURL: URL, jobID: String?) {
        guard ScrayDownloadFolder.shared.hasFolder else {
            deliverOnMain(fileURL: fileURL, jobID: jobID, saved: nil)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let saved = ScrayDownloadFolder.shared.save(fileURL: fileURL)
            self.deliverOnMain(fileURL: fileURL, jobID: jobID, saved: saved)
        }
    }

    private func deliverOnMain(fileURL: URL, jobID: String?, saved: URL?) {
        DispatchQueue.main.async {
            if let saved = saved {
                try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
                if let id = jobID { ScrayDownloadCenter.shared.finish(id: id, savedURL: saved) }
                self.libraryNeedsRefresh = true
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

    /// A tooltip above the tray, not a dialog. A finished download is worth
    /// noticing; it isn't worth blocking everything until it's dismissed.
    fileprivate func flash(_ message: String) {
        DispatchQueue.main.async {
            self.toastHide?.cancel()
            self.toastView.setText(message)
            self.toastView.isHidden = false
            self.view.bringSubviewToFront(self.toastView)
            self.view.layoutIfNeeded()
            UIView.animate(withDuration: 0.2) { self.toastView.alpha = 1 }

            let hide = DispatchWorkItem { [weak self] in self?.hideToast(animated: true) }
            self.toastHide = hide
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: hide)
        }
    }

    fileprivate func hideToast(animated: Bool) {
        toastHide?.cancel()
        toastHide = nil
        guard animated else {
            toastView.alpha = 0
            toastView.isHidden = true
            return
        }
        UIView.animate(withDuration: 0.25, animations: {
            self.toastView.alpha = 0
        }, completion: { _ in
            self.toastView.isHidden = true
        })
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
        libraryNeedsRefresh = true
        if let name = urls.first?.lastPathComponent { flash("Saved \(name)") }
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
            ScrayDownloadCenter.shared.begin(id: job.id, filename: name, total: expected,
                                             source: download.originalRequest?.url)
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

        var startedByWholesale = false
        if let idx = jobs.firstIndex(where: { $0.httpKey == key }) {
            startedByWholesale = wholesaleJobIDs.contains(jobs[idx].id)
            ScrayDownloadCenter.shared.fail(id: jobs[idx].id, message: error.localizedDescription)
            jobs[idx].progressObs?.invalidate()
            jobs.remove(at: idx)
            refreshDownloadBar()
        }
        // No recorded destination means we cancelled it ourselves — at the
        // prompt, or from the bar. Not a failure worth an alert.
        guard downloadDestinations.removeValue(forKey: key) != nil else { return }
        // Wholesale polls for this and shows it in its own run summary.
        guard !startedByWholesale else { return }
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
    var onCloseMany: (([Int]) -> Void)?
    var onNew: (() -> Void)?

    private var items: [(String, String)] = []

    /// Multi-select mode: rows tick instead of switching tabs.
    private var picking = false

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "tab")
        tableView.allowsMultipleSelectionDuringEditing = true
        reload()
    }

    private func reload() {
        items = provider?() ?? []
        tableView.reloadData()
        refreshChrome()
    }

    /// Title and buttons depend on the mode, and while picking on how many
    /// rows are ticked, so this also runs on every selection change.
    private func refreshChrome() {
        if picking {
            let n = tableView.indexPathsForSelectedRows?.count ?? 0
            title = n == 0 ? "Select Tabs" : "\(n) Selected"

            navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel,
                                                               target: self, action: #selector(cancelPickingTapped))
            let allOn = n > 0 && n == items.count
            navigationItem.rightBarButtonItems = [
                UIBarButtonItem(title: allOn ? "None" : "All", style: .plain,
                                target: self, action: #selector(toggleAllTapped))
            ]

            let close = UIBarButtonItem(title: n == 0 ? "Close" : "Close \(n)",
                                        style: .plain, target: self, action: #selector(closeSelectedTapped))
            close.tintColor = .systemRed
            close.isEnabled = n > 0
            toolbarItems = [flexSpace(), close, flexSpace()]
            navigationController?.setToolbarHidden(false, animated: true)
        } else {
            title = items.count == 1 ? "1 Tab" : "\(items.count) Tabs"

            navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done,
                                                               target: self, action: #selector(doneTapped))
            let select = UIBarButtonItem(title: "Select", style: .plain,
                                         target: self, action: #selector(startPickingTapped))
            select.isEnabled = !items.isEmpty
            navigationItem.rightBarButtonItems = [
                UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(newTapped)),
                select
            ]
            navigationController?.setToolbarHidden(true, animated: true)
        }
    }

    private func flexSpace() -> UIBarButtonItem {
        UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
    }

    @objc private func doneTapped() { dismiss(animated: true) }
    @objc private func newTapped()  { onNew?() }

    @objc private func startPickingTapped() {
        picking = true
        tableView.setEditing(true, animated: true)
        refreshChrome()
    }

    @objc private func cancelPickingTapped() {
        picking = false
        tableView.setEditing(false, animated: true)
        refreshChrome()
    }

    @objc private func toggleAllTapped() {
        let selected = tableView.indexPathsForSelectedRows ?? []
        if selected.count == items.count {
            for ip in selected { tableView.deselectRow(at: ip, animated: false) }
        } else {
            for row in items.indices {
                tableView.selectRow(at: IndexPath(row: row, section: 0),
                                    animated: false, scrollPosition: .none)
            }
        }
        refreshChrome()
    }

    @objc private func closeSelectedTapped() {
        let rows = (tableView.indexPathsForSelectedRows ?? []).map { $0.row }
        guard !rows.isEmpty else { return }
        let closingEverything = rows.count == items.count

        onCloseMany?(rows)
        picking = false
        tableView.setEditing(false, animated: false)

        // Closing the lot leaves the browser on a fresh home tab, so there is
        // nothing left to pick from — drop straight back to the page.
        if closingEverything {
            dismiss(animated: true)
            return
        }
        reload()
    }

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
        if picking { refreshChrome(); return }
        tableView.deselectRow(at: indexPath, animated: true)
        onSelect?(indexPath.row)
    }

    override func tableView(_ tableView: UITableView, didDeselectRowAt indexPath: IndexPath) {
        if picking { refreshChrome() }
    }

    override func tableView(_ tableView: UITableView,
                            commit editingStyle: UITableViewCell.EditingStyle,
                            forRowAt indexPath: IndexPath) {
        guard editingStyle == .delete else { return }
        onClose?(indexPath.row)
        reload()
    }
}