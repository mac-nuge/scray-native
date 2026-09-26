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

    /// OneDrive uploads (native 14.37): the queue lives in Native's web layer,
    /// which this browser covers, so the web layer reports a one-line state
    /// (uploadBadge) and the browser shows it as a pill of its own.
    fileprivate(set) var uploadBadge: (label: String, active: Bool) = ("", false)
    func setUploadBadge(label: String, active: Bool) {
        DispatchQueue.main.async {
            self.uploadBadge = (label, active)
            self.controller?.refreshUploadPill()
        }
    }

    /// `url` is where to go; nil resumes wherever the browser was left.
    /// `home` is what the house button goes to.
    ///
    /// `fromNative` marks a trip that started in the app's own view rather
    /// than on a page inside the browser (native 14.49). For that session the
    /// ‹P button becomes ‹N and closes the browser, putting you back where you
    /// were in Native - the same thing ‹P does for Picker.
    func present(url: String?, home: String, fromNative: Bool = false) {
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
            if fromNative { vc.cameFromNative = true }

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

    /// Pinned tabs (native 14.4) sit at the top of the list and act like
    /// bookmarks: they survive Select > All > Close, can't be swiped closed,
    /// and reopen at the page they were pinned on. Unpin first to close one.
    var pinned = false
    /// The page it was pinned on - what it reopens at after a restart, even
    /// if it has been browsed away from since.
    var pinnedURL: URL?
    /// The tab that opened this one through scraynative://newtab (native
    /// 14.9) - Picker, when its TinEye or Stash search opened here. A TinEye
    /// result's Search goes back to it; with none, to Native's main view.
    weak var opener: WKWebView?
    /// Opened by the page's own window.open (native 14.53), so a
    /// window.close() from it returns to `opener`.
    var openedByScript = false

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
    /// One Bool per entry in tabsKey (native 14.4). Kept as a parallel list
    /// so the tab list saved by older builds still reads as all unpinned.
    private static let pinsKey  = "scray.browser.tabPins"
    /// Favourites (native 14.8): [{ "title", "url" }], in the order added.
    private static let favouritesKey = "scray.browser.favourites"

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
    /// Address-bar suggestions (native 15.7): this device's history, under the
    /// bar while you type. See the SUGGESTIONS section further down.
    private let suggestTable = UITableView(frame: .zero, style: .plain)
    private var suggestions: [ScrayBrowserSync.Suggestion] = []
    private var suggestHeight: NSLayoutConstraint!
    /// ⚙️ How many rows the list shows, and how tall each one is.
    private static let SUGGEST_ROWS = 6
    private static let SUGGEST_ROW_H: CGFloat = 46
    /// The row the address field sits in. Held because the collapsed chrome
    /// (see setChrome) tightens its margins and hides its buttons.
    private var headerStack: UIStackView!
    private var addressHeight: NSLayoutConstraint!
    private var toolbarHeight: NSLayoutConstraint!
    /// Whether the page is scrolled far enough down that the chrome has got
    /// out of the way, the way Safari's does.
    private var chromeCollapsed = false
    /// The page has asked for the chrome to stay out of the way - it is on a
    /// surface that does not scroll, so scrolling cannot be what dismisses it.
    private var chromeLocked = false
    /// stashButton's own reason to be hidden, kept apart from the collapsed
    /// state so the two cannot fight over the same flag.
    private var stashEligible = false
    private var lastScrollY: CGFloat = 0
    private var scrollObservation: NSKeyValueObservation?
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let webContainer = UIView()
    private let toolbar = UIToolbar()
    // Plain buttons rather than bar items (native 14.25): on iOS 26 every
    // bar item separated by a space gets its own glass circle, which is what
    // spread the row off both edges. As buttons in one stack they sit in a
    // single pill at sizes we control.
    private let backButton = UIButton(type: .system)
    /// ✕, last in the strip since native 14.50 - see buildChrome.
    private let closeButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    /// Back to the tab you were on before this one (native 15.8). Tapping it
    /// again comes back, so two taps flick between a pair of tabs.
    private let lastTabButton = UIButton(type: .system)
    /// The tab on screen before the current one, and the one on screen now -
    /// held by identity, not index, because closing and pinning shift indices.
    private weak var lastTab: ScrayBrowserTab?
    private weak var shownTab: ScrayBrowserTab?
    /// Where each control lives (native 15.8) - see ScrayBrowserControls.swift.
    private var controlsLayout = ScrayBrowserLayout.load()
    /// The bottom bar's buttons. Refilled by applyControlsLayout.
    private let navStack = UIStackView()
    /// The bottom bar's height when it's showing: none at all if every
    /// control has been moved off it.
    private var toolbarShownHeight: CGFloat { controlsLayout.controls(in: .bottom).isEmpty ? 0 : 44 }
    private let tabsButton = UIButton(type: .system)
    /// ‹P (native 14.20) - back to Picker from an external page Picker sent
    /// you to. See pickerReturn(). Reads ‹N instead when the trip started in
    /// Native's own view (native 14.49).
    private let pickerButton = UIButton(type: .system)

    /// This browser session was opened from Native's own view, so there is
    /// somewhere in Native to go back to. Cleared when the browser closes.
    var cameFromNative = false
    private let newTabButton = UIButton(type: .system)
    private static let pickerPurple = UIColor(red: 0.424, green: 0.361, blue: 0.906, alpha: 1)  // #6c5ce7
    /// ‹N wears Native's green, so the two are never mistaken for each other.
    private static let nativeGreen = UIColor(red: 0.157, green: 0.655, blue: 0.271, alpha: 1)   // #28a745
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
    /// Uploads to OneDrive still going (native 14.37). Top-left, mirroring the
    /// download pill; a tap goes back to Native with the upload panel open.
    private let uploadPill = UIButton(type: .system)
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
        scrollObservation?.invalidate()
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
        // Password AutoFill on email-only sign-in boxes (native 14.21).
        // iOS only offers saved logins above the keyboard when a field says
        // it's a username; a bare type=email box gets the @ keyboard and no
        // suggestions. See loginHintJS.
        config.userContentController.addUserScript(
            WKUserScript(source: Self.loginHintJS,
                         injectionTime: .atDocumentEnd,
                         forMainFrameOnly: false)
        )
        // Scray's own view of TinEye's results (native 14.9). The script
        // checks the host itself and does nothing anywhere but tineye.com.
        config.userContentController.addUserScript(
            WKUserScript(source: ScrayTinEye.overlayJS,
                         injectionTime: .atDocumentEnd,
                         forMainFrameOnly: true)
        )

        webConfig = config
    }

    /// Marks sign-in email boxes as usernames (native 14.21), so iOS puts the
    /// saved logins (Passwords, 1Password) above the keyboard the way it does
    /// in Safari. Only boxes that give no hint of their own - no autocomplete,
    /// or "email" / "on" / "off" - and that look like an email or login field:
    /// type=email, or a text box whose name, id or placeholder says email,
    /// user or login. Anything already saying username, a password, a one-
    /// time code etc. is left alone, as is any form asking for a NEW password
    /// (sign-up), where offering an existing login would be wrong. Runs on
    /// load, on every DOM change (sign-in forms are often drawn late), and on
    /// focus as a last catch - iOS reads the hint when the keyboard opens.
    static let loginHintJS = #"""
    (function () {
      if (window.__scrayLoginHint) return;
      window.__scrayLoginHint = true;
      var LOOSE = { '': 1, 'on': 1, 'off': 1, 'email': 1 };
      var WORDS = /e-?mail|user|login|account|identifier/i;
      function wants(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        var ac = String(el.getAttribute('autocomplete') || '').trim().toLowerCase();
        if (!LOOSE[ac]) return false;
        var t = String(el.type || 'text').toLowerCase();
        if (t !== 'email' && t !== 'text') return false;
        if (t === 'text' && !WORDS.test((el.name || '') + ' ' + (el.id || '') + ' ' +
            (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || ''))) return false;
        var scope = el.form || document;
        if (scope.querySelector && scope.querySelector('input[autocomplete~="new-password"]')) return false;
        return true;
      }
      function mark(el) { if (wants(el)) el.setAttribute('autocomplete', 'username'); }
      function scan(root) {
        var list = (root && root.querySelectorAll) ? root.querySelectorAll('input') : [];
        for (var i = 0; i < list.length; i++) mark(list[i]);
      }
      scan(document);
      document.addEventListener('focusin', function (e) { mark(e.target); }, true);
      var queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        setTimeout(function () { queued = false; scan(document); }, 150);
      }).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """#

    // MARK: - Chrome

    // ⚙️ BOTTOM TOOLBAR SIZING (native 14.24, reworked 14.25, 14.26, 14.50).
    // Nine controls - ‹P ‹ › ↻ + tabs tray ⋯ ✕ - all in one right-aligned
    // stack, so iOS 26 draws them as a single pill instead of separate
    // spaced-out glass circles. ✕ sat on its own at the LEFT until 14.50;
    // it is now last in the strip, where the thumb reaches it.
    // TOOLBAR_BUTTON_WIDTH/HEIGHT = each button's tap box, TOOLBAR_ITEM_GAP =
    // space between them, TOOLBAR_SYMBOL_POINTS / TITLE_POINTS = glyph size.
    private static let TOOLBAR_SYMBOL_POINTS: CGFloat = 15
    private static let TOOLBAR_TITLE_POINTS: CGFloat = 14
    private static let TOOLBAR_ITEM_GAP: CGFloat = 2
    private static let TOOLBAR_BUTTON_WIDTH: CGFloat = 34
    private static let TOOLBAR_BUTTON_HEIGHT: CGFloat = 34
    private static var toolbarSymbol: UIImage.Configuration {
        UIImage.SymbolConfiguration(pointSize: TOOLBAR_SYMBOL_POINTS, weight: .regular)
    }

    private func buildChrome() {
        reloadButton.setImage(UIImage(systemName: "arrow.clockwise",
                                      withConfiguration: Self.toolbarSymbol), for: .normal)
        reloadButton.addTarget(self, action: #selector(reloadTapped), for: .touchUpInside)

        homeButton.setImage(UIImage(systemName: "house"), for: .normal)
        homeButton.addTarget(self, action: #selector(homeTapped), for: .touchUpInside)
        homeButton.widthAnchor.constraint(equalToConstant: 36).isActive = true
        homeButton.heightAnchor.constraint(equalToConstant: Self.TOOLBAR_BUTTON_HEIGHT).isActive = true

        // ⋯ sits up by the address with home and downloads (native 15.8; it
        // was in the bottom strip since 14.26) - wherever the controls layout
        // puts it. Sized with the other control buttons below.
        moreButton.setImage(UIImage(systemName: "ellipsis.circle", withConfiguration: Self.toolbarSymbol),
                            for: .normal)
        moreButton.addTarget(self, action: #selector(moreTapped), for: .touchUpInside)

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

        addressField.addTarget(self, action: #selector(addressEditingChanged), for: .editingChanged)
        // The address gives way to the buttons beside it, however many the
        // controls layout puts up here (native 15.8).
        addressField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        addressField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        // The suggestion list. Floats over the page like the download pill
        // rather than resizing it: the keyboard is already up and a reflow of
        // the page underneath would be one movement too many.
        suggestTable.translatesAutoresizingMaskIntoConstraints = false
        suggestTable.dataSource = self
        suggestTable.delegate = self
        suggestTable.register(ScraySuggestCell.self, forCellReuseIdentifier: "suggest")
        suggestTable.rowHeight = Self.SUGGEST_ROW_H
        suggestTable.backgroundColor = .secondarySystemBackground
        suggestTable.layer.cornerRadius = 10
        suggestTable.layer.shadowColor = UIColor.black.cgColor
        suggestTable.layer.shadowOpacity = 0.18
        suggestTable.layer.shadowRadius = 6
        suggestTable.layer.shadowOffset = CGSize(width: 0, height: 3)
        suggestTable.separatorInset = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        suggestTable.keyboardDismissMode = .onDrag
        suggestTable.isHidden = true

        // The controls placed at the top follow these two (applyControlsLayout).
        let header = UIStackView(arrangedSubviews: [addressField, stashButton])
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

        // ✕ closes the browser. Last in the strip (native 14.50), so the
        // whole row sits under the right thumb; it was alone at the far left
        // before. Its own tint, so the one button that ends the session does
        // not read as just another arrow.
        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: Self.toolbarSymbol), for: .normal)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.tintColor = .secondaryLabel
        backButton.setImage(UIImage(systemName: "chevron.left", withConfiguration: Self.toolbarSymbol), for: .normal)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        forwardButton.setImage(UIImage(systemName: "chevron.right", withConfiguration: Self.toolbarSymbol), for: .normal)
        forwardButton.addTarget(self, action: #selector(forwardTapped), for: .touchUpInside)
        // Two rectangles trading places: back to the last tab, and again to return.
        lastTabButton.setImage(UIImage(systemName: "rectangle.2.swap", withConfiguration: Self.toolbarSymbol)
                                ?? UIImage(systemName: "arrow.left.arrow.right", withConfiguration: Self.toolbarSymbol),
                               for: .normal)
        lastTabButton.addTarget(self, action: #selector(lastTabTapped), for: .touchUpInside)
        lastTabButton.accessibilityLabel = "Last tab"
        lastTabButton.isEnabled = false
        // reloadButton swaps its image to xmark while a page is loading
        // (see the isLoading observer).
        tabsButton.setTitle("1 ⧉", for: .normal)
        tabsButton.titleLabel?.font = .systemFont(ofSize: Self.TOOLBAR_TITLE_POINTS, weight: .semibold)
        // "12 ⧉" would otherwise truncate in a 34pt box - shrink instead.
        tabsButton.titleLabel?.adjustsFontSizeToFitWidth = true
        tabsButton.titleLabel?.minimumScaleFactor = 0.7
        tabsButton.addTarget(self, action: #selector(tabsTapped), for: .touchUpInside)
        // trayButton is its own class because it carries a badge.
        trayButton.addTarget(self, action: #selector(downloadsTapped), for: .touchUpInside)
        pickerButton.setTitle("\u{2039}P", for: .normal)
        pickerButton.titleLabel?.font = .systemFont(ofSize: Self.TOOLBAR_TITLE_POINTS, weight: .bold)
        pickerButton.addTarget(self, action: #selector(pickerTapped), for: .touchUpInside)
        // ‹P is always live (native 14.26): back to the Picker page you came
        // from if there is one, otherwise straight to Picker home.
        pickerButton.tintColor = Self.pickerPurple
        // + opens a new tab (same as "New Tab" in the ⋯ menu).
        newTabButton.setImage(UIImage(systemName: "plus", withConfiguration: Self.toolbarSymbol), for: .normal)
        newTabButton.addTarget(self, action: #selector(newTabTapped), for: .touchUpInside)
        backButton.isEnabled = false
        forwardButton.isEnabled = false

        let sized: [UIButton] = [pickerButton, backButton, forwardButton, lastTabButton, reloadButton,
                                 newTabButton, tabsButton, trayButton, moreButton, closeButton, homeButton]
        for b in sized {
            b.translatesAutoresizingMaskIntoConstraints = false
            // trayButton pins its own size in ScrayDownloads; match it there.
            // homeButton has its own width, above.
            if b === trayButton || b === homeButton { continue }
            b.widthAnchor.constraint(equalToConstant: Self.TOOLBAR_BUTTON_WIDTH).isActive = true
            b.heightAnchor.constraint(equalToConstant: Self.TOOLBAR_BUTTON_HEIGHT).isActive = true
        }
        // One group, right-aligned (native 14.50). Which buttons, and in what
        // order, is the controls layout's call: applyControlsLayout fills it.
        navStack.axis = .horizontal
        navStack.alignment = .center
        navStack.spacing = Self.TOOLBAR_ITEM_GAP
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

        var upCfg = UIButton.Configuration.filled()
        upCfg.baseBackgroundColor = UIColor(red: 0.11, green: 0.45, blue: 0.91, alpha: 0.95)
        upCfg.baseForegroundColor = .white
        upCfg.cornerStyle = .capsule
        upCfg.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
        upCfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a
            a.font = .systemFont(ofSize: 13, weight: .semibold)
            return a
        }
        uploadPill.configuration = upCfg
        uploadPill.translatesAutoresizingMaskIntoConstraints = false
        uploadPill.isHidden = true
        uploadPill.accessibilityLabel = "OneDrive uploads"
        uploadPill.layer.shadowColor = UIColor.black.cgColor
        uploadPill.layer.shadowOpacity = 0.18
        uploadPill.layer.shadowRadius = 4
        uploadPill.layer.shadowOffset = CGSize(width: 0, height: 1)
        uploadPill.addTarget(self, action: #selector(uploadPillTapped), for: .touchUpInside)
        view.addSubview(uploadPill)
        view.addSubview(toolbar)

        toastView.translatesAutoresizingMaskIntoConstraints = false
        toastView.onTap = { [weak self] in
            self?.hideToast(animated: false)
            self?.downloadsTapped()
        }
        view.addSubview(toastView)
        // Above the page and the pills, below nothing: while you are typing an
        // address the list is the thing being used.
        view.addSubview(suggestTable)
        toastBottom = toastView.bottomAnchor.constraint(equalTo: toolbar.topAnchor, constant: -6)

        toolbar.clipsToBounds = true        // its items must not spill out of a 0pt bar
        toolbarHeight = toolbar.heightAnchor.constraint(equalToConstant: 44)

        let guide = view.safeAreaLayoutGuide
        suggestHeight = suggestTable.heightAnchor.constraint(equalToConstant: 0)

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

            uploadPill.topAnchor.constraint(equalTo: progressView.bottomAnchor, constant: 10),
            uploadPill.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),

            suggestTable.topAnchor.constraint(equalTo: progressView.bottomAnchor, constant: 4),
            suggestTable.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            suggestTable.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            suggestHeight,

            toastBottom,
            toastView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            toastView.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),

            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            toolbarHeight
        ])
        applyControlsLayout()
    }

    // MARK: - Controls layout (native 15.8)
    //
    // Which control is a button at the top, a button in the bottom bar, a
    // line in the ⋯ menu, or nowhere - edited in ⋯ > Browser Controls… and
    // kept in ScrayBrowserLayout (ScrayBrowserControls.swift). The buttons
    // themselves are made once, in buildChrome; this only moves them.

    private func controlButton(for c: ScrayBrowserControl) -> UIButton {
        switch c {
        case .picker:    return pickerButton
        case .back:      return backButton
        case .forward:   return forwardButton
        case .lastTab:   return lastTabButton
        case .reload:    return reloadButton
        case .newTab:    return newTabButton
        case .tabs:      return tabsButton
        case .downloads: return trayButton
        case .more:      return moreButton
        case .close:     return closeButton
        case .home:      return homeButton
        }
    }

    private func applyControlsLayout() {
        let top = controlsLayout.controls(in: .top)
        let bottom = controlsLayout.controls(in: .bottom)

        for v in headerStack.arrangedSubviews where v !== addressField && v !== stashButton {
            headerStack.removeArrangedSubview(v)
            v.removeFromSuperview()
        }
        for c in top {
            let b = controlButton(for: c)
            b.isHidden = chromeCollapsed        // the collapsed strip is the address alone
            headerStack.addArrangedSubview(b)
        }

        for v in navStack.arrangedSubviews {
            navStack.removeArrangedSubview(v)
            v.removeFromSuperview()
        }
        for c in bottom {
            let b = controlButton(for: c)
            b.isHidden = false
            navStack.addArrangedSubview(b)
        }
        // A fresh bar item each time, so the toolbar measures the new width.
        navStack.frame.size = navStack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        toolbar.items = bottom.isEmpty ? [] : [flex, UIBarButtonItem(customView: navStack)]
        toolbarHeight.constant = chromeCollapsed ? 0 : toolbarShownHeight
        view.setNeedsLayout()
        refreshChrome()
    }

    /// A control placed in the ⋯ menu does what its button would.
    private func performControl(_ c: ScrayBrowserControl) {
        switch c {
        case .picker:    pickerTapped()
        case .back:      backTapped()
        case .forward:   forwardTapped()
        case .lastTab:   lastTabTapped()
        case .reload:    reloadTapped()
        case .newTab:    newTabTapped()
        case .tabs:      tabsTapped()
        case .downloads: downloadsTapped()
        case .more:      moreTapped()
        case .close:     closeTapped()
        case .home:      homeTapped()
        }
    }

    /// The ⋯ menu's line for a control placed there - worded for the moment.
    private func menuAction(for c: ScrayBrowserControl) -> UIAlertAction {
        var title = c.title
        var enabled = true
        switch c {
        case .picker:
            title = (pickerReturn() == nil && cameFromNative) ? "Back to Native" : "Back to Picker"
        case .back:      enabled = currentWebView?.canGoBack ?? false
        case .forward:   enabled = currentWebView?.canGoForward ?? false
        case .lastTab:   enabled = lastTabIndex != nil
        case .reload:    title = (currentWebView?.isLoading ?? false) ? "Stop Loading" : "Reload"
        case .tabs:      title = "Tabs (\(tabs.count))"
        case .downloads:
            let active = ScrayDownloadCenter.shared.activeCount
            title = active > 0 ? "Downloads (\(active) active)" : "Downloads"
        default: break
        }
        let a = UIAlertAction(title: title, style: .default) { [weak self] _ in self?.performControl(c) }
        a.setValue(UIImage(systemName: c.symbol), forKey: "image")
        a.isEnabled = enabled
        return a
    }

    private func controlsTapped() {
        let editor = ScrayBrowserControlsViewController(style: .insetGrouped)
        editor.onChange = { [weak self] layout in
            guard let self = self else { return }
            self.controlsLayout = layout
            self.applyControlsLayout()
        }
        presentSafely(UINavigationController(rootViewController: editor))
    }

    // MARK: - Last tab (native 15.8)

    /// Where the last tab is now, if it's still open.
    private var lastTabIndex: Int? {
        guard let t = lastTab else { return nil }
        return tabs.firstIndex { $0 === t }
    }

    @objc private func lastTabTapped() {
        guard let i = lastTabIndex else { flash("No other tab to go back to"); return }
        selectTab(i)
    }

    // MARK: - Jira report (native 15.8)

    /// The report modal lives in Scray's own page, behind this browser, so
    /// the browser steps aside for it - the tabs stay as they are, as for ✕.
    /// The page you were on goes into the report's details.
    private func jiraTapped() {
        guard let host = ScrayNativeView.current else {
            flash("Couldn't reach Scray's report - open it from the app's menu")
            return
        }
        let url = currentTab?.displayURL?.absoluteString ?? ""
        let title = currentTab?.displayTitle ?? ""
        dismiss(animated: true) { host.openBugReport(browserURL: url, browserTitle: title) }
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

        // Fullscreen holds it collapsed, including at the top of the page.
        if chromeLocked { return }

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

    /**
     * Hold the chrome out of the way regardless of scrolling, or stop.
     *
     * A fullscreen player fills the web view and never scrolls, so there is
     * no gesture left to collapse the chrome with - and entering one handed
     * it straight back, because the page sits at offset 0 and "the top of a
     * page always shows the chrome". The page knows which surface it is on,
     * so it says so: window.ScrayBridge.chromeLock(true) on the way into
     * FLS/MPFS, false on the way out.
     */
    func setChromeLock(_ on: Bool) {
        guard chromeLocked != on else { return }
        chromeLocked = on
        setChrome(collapsed: on, force: true)
    }

    private func setChrome(collapsed: Bool, force: Bool = false) {
        // While locked, only the lock decides - the scroll observer and the
        // per-page resets are both asking about a state they no longer own.
        guard force || !chromeLocked else { return }
        guard collapsed != chromeCollapsed, isViewLoaded else { return }
        // Never while you are typing in it, and never with something on top.
        if collapsed && (addressField.isFirstResponder || presentedViewController != nil) { return }
        chromeCollapsed = collapsed

        addressHeight.constant = collapsed ? Self.chromeStripHeight : Self.chromeFullHeight
        toolbarHeight.constant = collapsed ? 0 : toolbarShownHeight

        UIView.animate(withDuration: 0.22, delay: 0,
                       options: [.curveEaseOut, .beginFromCurrentState]) {
            self.addressField.font = .systemFont(ofSize: collapsed ? 10.5 : 13)
            self.headerStack.layoutMargins = UIEdgeInsets(top: collapsed ? 1 : 4, left: 6,
                                                          bottom: collapsed ? 1 : 4, right: 6)
            // isHidden inside a stack view animates the width away, which is
            // what makes the strip go full width rather than leaving gaps.
            // Every control placed at the top, not just home (native 15.8).
            for c in self.controlsLayout.controls(in: .top) { self.controlButton(for: c).isHidden = collapsed }
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
        // The tab leaving the screen becomes the last tab (native 15.8) -
        // unless it has just been closed, when the last tab stays as it was.
        if let was = shownTab, was !== tabs[index], tabs.contains(where: { $0 === was }) {
            lastTab = was
        }
        currentIndex = index
        let tab = tabs[index]
        shownTab = tab

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
        // A pinned tab only goes once it's been unpinned (native 14.4) - this
        // also covers a page calling window.close() on itself.
        guard !tabs[index].pinned else { return }
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
        // Pinned tabs are exempt (native 14.4), whatever was ticked.
        let valid = indices.filter { tabs.indices.contains($0) && !tabs[$0].pinned }
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
        let pins = UserDefaults.standard.array(forKey: Self.pinsKey) as? [Bool] ?? []
        for (i, s) in saved.enumerated() {
            guard let u = URL(string: s), (u.scheme ?? "").hasPrefix("http") else { continue }
            let tab = ScrayBrowserTab(webView: makeWebView(configuration: nil), pending: u)
            if i < pins.count, pins[i] {
                tab.pinned = true
                tab.pinnedURL = u
            }
            tabs.append(tab)
        }
        // Pinned first, in case an older list ever saved them out of order.
        tabs = tabs.filter { $0.pinned } + tabs.filter { !$0.pinned }
        guard !tabs.isEmpty else { return }
        let idx = UserDefaults.standard.integer(forKey: Self.indexKey)
        selectTab(min(max(idx, 0), tabs.count - 1))
        lastTab = nil       // a fresh start has no tab before this one
        refreshChrome()
    }

    private func persistTabs() {
        // A pinned tab is saved at the page it was pinned on, not wherever it
        // has wandered to - that's the bookmark part (native 14.4).
        var urls: [String] = []
        var pins: [Bool] = []
        for tab in tabs {
            guard let s = (tab.pinned ? (tab.pinnedURL ?? tab.displayURL) : tab.displayURL)?.absoluteString,
                  s.hasPrefix("http") else { continue }
            urls.append(s)
            pins.append(tab.pinned)
        }
        UserDefaults.standard.set(urls, forKey: Self.tabsKey)
        UserDefaults.standard.set(pins, forKey: Self.pinsKey)
        UserDefaults.standard.set(currentIndex, forKey: Self.indexKey)
    }

    /// Pin or unpin (native 14.4). Either way the tab moves to the boundary:
    /// pinning puts it at the end of the pinned block, unpinning puts it at
    /// the top of the ordinary tabs just below. The tab on screen stays on
    /// screen - only its index changes.
    private func togglePin(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        let onScreen = currentTab
        let tab = tabs.remove(at: index)
        tab.pinned.toggle()
        tab.pinnedURL = tab.pinned ? tab.displayURL : nil
        let boundary = tabs.filter { $0.pinned }.count
        tabs.insert(tab, at: boundary)
        if let onScreen = onScreen, let i = tabs.firstIndex(where: { $0 === onScreen }) {
            currentIndex = i
        }
        persistTabs()
        refreshChrome()
    }

    // MARK: - Favourites (native 14.8, reworked 14.14)
    //
    // Bookmarks, called favourites, kept in UserDefaults. Added from the ⋯
    // menu, listed in the Favourites panel beside Tabs.
    //
    // Pinning a favourite (14.14) no longer turns it into a pinned tab. It
    // stays a LINK: the same favourite, also shown at the top of the Tabs
    // panel with a blue pin, always opening its own address however much you
    // browse in the tab it opens. Orange pins are still pinned tabs (14.4) -
    // live tabs that can wander. Unpinning just takes the link off Tabs.

    private func loadFavourites() -> [(title: String, url: URL, pinned: Bool)] {
        let raw = UserDefaults.standard.array(forKey: Self.favouritesKey) as? [[String: String]] ?? []
        return raw.compactMap { d -> (title: String, url: URL, pinned: Bool)? in
            guard let s = d["url"], let u = URL(string: s) else { return nil }
            return (title: d["title"] ?? (u.host ?? s), url: u, pinned: d["pinned"] == "1")
        }
    }

    private func saveFavourites(_ list: [(title: String, url: URL, pinned: Bool)]) {
        let raw: [[String: String]] = list.map { f in
            var d = ["title": f.title, "url": f.url.absoluteString]
            if f.pinned { d["pinned"] = "1" }
            return d
        }
        UserDefaults.standard.set(raw, forKey: Self.favouritesKey)
        ScrayBrowserSync.shared.pushFavourites(raw)   // native 14.29
    }

    /// Addresses compared without a trailing slash, so /x and /x/ are one page.
    private func favKey(_ url: URL) -> String {
        var s = url.absoluteString
        if s.hasSuffix("/") { s.removeLast() }
        return s
    }

    private func isFavourite(_ url: URL) -> Bool {
        loadFavourites().contains { favKey($0.url) == favKey(url) }
    }

    private func toggleFavourite(url: URL) {
        var list = loadFavourites()
        if let i = list.firstIndex(where: { favKey($0.url) == favKey(url) }) {
            deleteFavourite(i)
            flash("Removed from Favourites")
            return
        }
        let t = (currentTab?.displayTitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        list.append((title: t.isEmpty ? (url.host ?? url.absoluteString) : t, url: url, pinned: false))
        saveFavourites(list)
        flash("Added to Favourites")
    }

    /// Open a favourite: the tab already on that exact page if there is one,
    /// otherwise a new tab at it. Always the favourite's own address.
    private func openFavourite(_ index: Int) {
        let list = loadFavourites()
        guard list.indices.contains(index) else { return }
        let url = list[index].url
        if let t = tabs.firstIndex(where: { $0.displayURL.map { favKey($0) == favKey(url) } == true }) {
            selectTab(t)
        } else {
            addTab(url: url, select: true)
        }
    }

    /// Pin / unpin: just the flag. No tab is made, moved or changed.
    private func toggleFavouritePin(_ index: Int) {
        var list = loadFavourites()
        guard list.indices.contains(index) else { return }
        list[index].pinned.toggle()
        saveFavourites(list)
    }

    private func deleteFavourite(_ index: Int) {
        var list = loadFavourites()
        guard list.indices.contains(index) else { return }
        list.remove(at: index)
        saveFavourites(list)
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
                self.reloadButton.setImage(UIImage(systemName: symbol, withConfiguration: Self.toolbarSymbol), for: .normal)
            },
            wv.observe(\.title, options: [.new]) { [weak self] _, _ in self?.refreshChrome() },
            wv.observe(\.url, options: [.new]) { [weak self] _, _ in
                self?.refreshChrome()
                self?.persistTabs()
                self?.showChrome()      // a new page starts with its controls
            },
            wv.observe(\.canGoBack, options: [.new]) { [weak self] w, _ in
                self?.backButton.isEnabled = w.canGoBack
                self?.refreshPickerItem()
            },
            wv.observe(\.canGoForward, options: [.new]) { [weak self] w, _ in
                self?.forwardButton.isEnabled = w.canGoForward
            }
        ]
    }

    private func refreshChrome() {
        UIView.performWithoutAnimation {
            tabsButton.setTitle("\(tabs.count) ⧉", for: .normal)
            tabsButton.layoutIfNeeded()
        }
        backButton.isEnabled = currentWebView?.canGoBack ?? false
        forwardButton.isEnabled = currentWebView?.canGoForward ?? false
        lastTabButton.isEnabled = lastTabIndex != nil
        refreshPickerItem()
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
        // You cannot type into a 20pt strip: editing always gets the full bar
        // and the toolbar back, even while a fullscreen page holds the lock.
        setChrome(collapsed: false, force: true)
        textField.textAlignment = .left
        textField.text = currentTab?.displayURL?.absoluteString ?? ""
        DispatchQueue.main.async { textField.selectAll(nil) }
        // Focus alone offers the places you go most - the address is selected,
        // so a tap on one of them replaces it.
        refreshSuggestions()
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        textField.textAlignment = .center
        hideSuggestions()
        refreshChrome()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        defer { textField.resignFirstResponder() }
        hideSuggestions()
        guard let url = normalizedURL(from: textField.text ?? "") else { return true }
        if currentWebView == nil { addTab(url: url, select: true) }
        else { currentWebView?.load(URLRequest(url: url)) }
        return true
    }

    // MARK: - SUGGESTIONS (native 15.7)
    //
    // The address bar completes from this phone's own history: one row per
    // URL, ranked by how often and how recently you've been there (the
    // ranking is in ScrayBrowserSync.suggestions). Each row carries an ✕ that
    // forgets that URL, so a page you don't want offered again stops coming
    // back. That drops it from THIS phone's history only - the History screen
    // is the server's copy, and clearing a suggestion shouldn't quietly wipe a
    // page off every device.

    @objc private func addressEditingChanged() { refreshSuggestions() }

    private func refreshSuggestions() {
        guard addressField.isFirstResponder else { hideSuggestions(); return }
        let typed = addressField.text ?? ""
        // What's already in the bar when you focus it is the page you are on;
        // completing against itself would just offer you where you already are.
        let q = (typed == currentTab?.displayURL?.absoluteString) ? "" : typed
        suggestions = ScrayBrowserSync.shared.suggestions(matching: q, limit: Self.SUGGEST_ROWS)
        suggestTable.reloadData()
        let rows = CGFloat(suggestions.count)
        suggestHeight.constant = rows * Self.SUGGEST_ROW_H
        suggestTable.isHidden = suggestions.isEmpty
        view.bringSubviewToFront(suggestTable)
    }

    private func hideSuggestions() {
        suggestions = []
        suggestHeight.constant = 0
        suggestTable.isHidden = true
    }

    @objc fileprivate func forgetSuggestionTapped(_ sender: UIButton) {
        guard suggestions.indices.contains(sender.tag) else { return }
        let gone = suggestions[sender.tag]
        ScrayBrowserSync.shared.forgetSuggestion(url: gone.url)
        refreshSuggestions()
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

    // MARK: - Upload pill (native 14.37)

    fileprivate func refreshUploadPill() {
        guard isViewLoaded else { return }
        let badge = ScrayBrowser.shared.uploadBadge
        uploadPill.isHidden = !badge.active
        uploadPill.configuration?.title = "⬆ " + (badge.label.isEmpty ? "Uploading" : badge.label)
        if badge.active { view.bringSubviewToFront(uploadPill) }
    }

    @objc private func uploadPillTapped() {
        dismiss(animated: true) { ScrayNativeView.current?.showUploads() }
    }

    /// Set when a download actually lands somewhere. The rescan waits for
    /// dismissal rather than firing per file: the main list is behind this
    /// modal so nothing is visible until then, and scanLocalLibrary is a full
    /// metadata pass over the folder.
    fileprivate var libraryNeedsRefresh = false

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        ScrayRunMonitor.shared.browserWillShow()
        refreshUploadPill()
        // Synced favourites and logins (native 14.29, ScrayBrowserSync.swift).
        // Saved straight to UserDefaults, not saveFavourites: that would push
        // the server's own list straight back to it.
        ScrayBrowserSync.shared.pullFavourites(
            local: { UserDefaults.standard.array(forKey: Self.favouritesKey) as? [[String: String]] ?? [] },
            adopt: { UserDefaults.standard.set($0, forKey: Self.favouritesKey) })
        ScrayBrowserSync.shared.restoreAfterReinstallIfNeeded { [weak self] msg in
            self?.flash(msg)
            self?.currentWebView?.reload()
        }
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
        // The ‹N trip is over (native 14.49): opening the browser again from
        // the ring or from a page in here has nothing in Native to go back to.
        if isBeingDismissed { cameFromNative = false }
        if isBeingDismissed {
            ScrayBrowserSync.shared.flushHistory()
            ScrayBrowserSync.shared.backupLogins(force: false, completion: nil)
        }
        // This also fires when a document picker or share sheet goes up over
        // the browser, which is not the browser going away.
        guard isBeingDismissed, libraryNeedsRefresh else { return }
        libraryNeedsRefresh = false
        ScrayNativeView.current?.refreshLocalFolder()
    }
    @objc private func homeTapped()    { openOrFocus(homeURL) }
    // MARK: - ‹P, back to Picker (native 14.20)
    //
    // Lit only on an external page that Picker sent you to. Two ways that
    // happens, and ‹P undoes whichever it was:
    //   - the page opened in THIS tab from Picker (a plain link): Picker is in
    //     the tab's back history, so ‹P jumps back to the latest Picker page
    //     in it - however many external pages you've clicked through since;
    //   - Picker opened it in a NEW tab (target=_blank, or scraynative://newtab
    //     for its Stash / TinEye searches): the tab's opener is Picker's tab,
    //     so ‹P switches to that tab and leaves this one open behind it.
    private func isPickerURL(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased(), !host.isEmpty else { return false }
        return host == (homeURL.host ?? "").lowercased()
    }

    private enum PickerReturn { case history(WKBackForwardListItem), tab(Int) }

    private func pickerReturn() -> PickerReturn? {
        guard let tab = currentTab else { return nil }
        let here = tab.displayURL
        let scheme = (here?.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https", !isPickerURL(here) else { return nil }
        if let item = tab.webView.backForwardList.backList.last(where: { isPickerURL($0.url) }) {
            return .history(item)
        }
        if let opener = tab.opener,
           let idx = tabs.firstIndex(where: { $0.webView === opener }),
           isPickerURL(tabs[idx].displayURL) {
            return .tab(idx)
        }
        return nil
    }

    @objc private func pickerTapped() {
        switch pickerReturn() {
        case .history(let item)?: currentWebView?.go(to: item)
        case .tab(let idx)?:      selectTab(idx)
        case nil:
            // ‹N: back to Native, where this trip started. Closing the browser
            // IS that - the app's view is still on the page that sent you -
            // and the tabs stay open behind it, as they do for ✕.
            if cameFromNative { closeTapped() }
            else { openOrFocus(homeURL) }   // no trail either way - act as Picker home
        }
    }

    /// ‹P, or ‹N when this session came from Native and this page has no
    /// Picker trail of its own (native 14.49). Called from refreshChrome, so
    /// it follows the tab you are on.
    private func refreshPickerItem() {
        let native = (pickerReturn() == nil) && cameFromNative
        pickerButton.setTitle(native ? "\u{2039}N" : "\u{2039}P", for: .normal)
        pickerButton.tintColor = native ? Self.nativeGreen : Self.pickerPurple
    }

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
    /// The same escaping, for TinEye's picked words (native 14.9).
    fileprivate static func stashSearchJS(_ q: String) -> String {
        let escaped = q
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
        return "window.scrayStashSearchFromBrowser && window.scrayStashSearchFromBrowser('\(escaped)');"
    }

    private static func stashDeliveryJS(_ url: String) -> String {
        let escaped = url
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return "window.scrayStashUrlFromBrowser && window.scrayStashUrlFromBrowser('\(escaped)');"
    }

    // MARK: - NordVPN (native 15.20)

    /// The NordVPN app's own URL scheme. Opening another app's scheme needs no
    /// LSApplicationQueriesSchemes entry - that is only for canOpenURL.
    private static let nordVPNApp = URL(string: "nordvpn://")!
    /// Its App Store page: the way in if the scheme ever stops answering (or
    /// the app isn't installed) - the page has an Open button when it is.
    private static let nordVPNStore = URL(string: "https://apps.apple.com/app/id905953485")!

    /// Scray stays as it is underneath; switch back from the app switcher or
    /// the ◀ Scray link iOS puts in the corner.
    private func nordVPNTapped() {
        UIApplication.shared.open(Self.nordVPNApp, options: [:]) { [weak self] opened in
            guard !opened else { return }
            UIApplication.shared.open(Self.nordVPNStore, options: [:]) { ok in
                if !ok { self?.flash("Couldn't open NordVPN") }
            }
        }
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
        list.onPlayInScray = { [weak self] path in self?.playDownloaded(relativePath: path) }
        let nav = UINavigationController(rootViewController: list)
        presentSafely(nav)
    }

    /// A finished download tapped in the Downloads list, and it's in the video
    /// folder (native 13.195). Same hop as Picker's N button: the player is
    /// behind the browser, so close it first - asking the browser's presenter
    /// takes Downloads, sitting on top, down with it - then hand over.
    private func playDownloaded(relativePath: String) {
        (presentingViewController ?? self).dismiss(animated: true) {
            ScrayNativeView.current?.playDownloadedFile(relativePath: relativePath)
        }
    }

    @objc private func moreTapped() {
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.popoverPresentationController?.sourceView = moreButton
        sheet.popoverPresentationController?.sourceRect = moreButton.bounds

        // Downloads and New Tab are buttons now, not lines here (native 15.8).
        // What goes here instead is whatever Browser Controls puts in the menu.
        for c in controlsLayout.controls(in: .menu) { sheet.addAction(menuAction(for: c)) }

        // Favourites (native 14.8). Offered for a real web page only.
        if let url = currentTab?.displayURL, (url.scheme ?? "").hasPrefix("http") {
            let already = isFavourite(url)
            let fav = UIAlertAction(title: already ? "Remove from Favourites" : "Add to Favourites",
                                    style: already ? .destructive : .default) { [weak self] _ in
                self?.toggleFavourite(url: url)
            }
            fav.setValue(UIImage(systemName: already ? "bookmark.slash" : "bookmark"), forKey: "image")
            sheet.addAction(fav)
        }

        let history = UIAlertAction(title: "History", style: .default) { [weak self] _ in self?.historyTapped() }
        history.setValue(UIImage(systemName: "clock"), forKey: "image")
        sheet.addAction(history)
        let logins = UIAlertAction(title: "Logins Backup…", style: .default) { [weak self] _ in self?.loginsTapped() }
        logins.setValue(UIImage(systemName: "key"), forKey: "image")
        sheet.addAction(logins)

        sheet.addAction(UIAlertAction(title: "Open in Safari", style: .default) { [weak self] _ in
            self?.safariTapped()
        })

        // native 15.20: the NordVPN app, to turn it on or change server before
        // a site - see nordVPNTapped.
        let vpn = UIAlertAction(title: "Open NordVPN", style: .default) { [weak self] _ in self?.nordVPNTapped() }
        vpn.setValue(UIImage(systemName: "network.badge.shield.half.filled"), forKey: "image")
        sheet.addAction(vpn)

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

        // native 15.8
        let jira = UIAlertAction(title: "Jira Report", style: .default) { [weak self] _ in self?.jiraTapped() }
        jira.setValue(UIImage(systemName: "ladybug"), forKey: "image")
        sheet.addAction(jira)
        let controls = UIAlertAction(title: "Browser Controls…", style: .default) { [weak self] _ in
            self?.controlsTapped()
        }
        controls.setValue(UIImage(systemName: "slider.horizontal.3"), forKey: "image")
        sheet.addAction(controls)

        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        presentSafely(sheet)
    }

    // MARK: - History and logins backup (native 14.29) - see ScrayBrowserSync.swift

    private func historyTapped() {
        let list = ScrayHistoryViewController(style: .plain)
        // The tab already on that exact page, else a new tab - as favourites do.
        list.onOpen = { [weak self] url in
            guard let self = self else { return }
            if let t = self.tabs.firstIndex(where: { $0.displayURL.map { self.favKey($0) == self.favKey(url) } == true }) {
                self.selectTab(t)
            } else {
                self.addTab(url: url, select: true)
            }
        }
        present(UINavigationController(rootViewController: list), animated: true)
    }

    private func loginsTapped() {
        let sync = ScrayBrowserSync.shared
        guard sync.passphrase != nil else { askLoginsPassphrase(); return }
        let when = sync.lastBackup.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .short) }
            ?? "not yet from this phone"
        let sheet = UIAlertController(title: "Logins Backup",
                                      message: "This browser's cookies, encrypted with your passphrase before they leave the phone. Backed up automatically when you close the browser. Last backup: \(when).",
                                      preferredStyle: .actionSheet)
        sheet.popoverPresentationController?.sourceView = moreButton
        sheet.popoverPresentationController?.sourceRect = moreButton.bounds
        sheet.addAction(UIAlertAction(title: "Back Up Now", style: .default) { [weak self] _ in
            self?.flash("Backing up logins…")
            sync.backupLogins(force: true) { self?.flash($0) }
        })
        sheet.addAction(UIAlertAction(title: "Restore From Server", style: .default) { [weak self] _ in
            self?.restoreLogins(backUpIfNone: false)
        })
        sheet.addAction(UIAlertAction(title: "Forget Passphrase on This Phone", style: .destructive) { [weak self] _ in
            sync.setPassphrase(nil)
            self?.flash("Passphrase forgotten - logins won't back up")
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        presentSafely(sheet)
    }

    /// Restore also proves the passphrase: it's the only thing that can open
    /// the server's copy.
    private func restoreLogins(backUpIfNone: Bool) {
        flash("Restoring logins…")
        ScrayBrowserSync.shared.restoreLogins { [weak self] r in
            guard let self = self else { return }
            switch r {
            case .restored(let n):
                self.flash("Restored \(n) cookies")
                self.currentWebView?.reload()
            case .nothingSaved:
                if backUpIfNone { ScrayBrowserSync.shared.backupLogins(force: true) { self.flash($0) } }
                else { self.flash("Nothing backed up on the server yet") }
            case .failed(let m):
                self.showAlert(title: "Couldn't restore logins", message: m)
            case .wrongPassphrase:
                let a = UIAlertController(title: "Wrong passphrase",
                                          message: "That passphrase doesn't open the logins already backed up on the server.",
                                          preferredStyle: .alert)
                a.addAction(UIAlertAction(title: "Try Another", style: .cancel) { _ in
                    ScrayBrowserSync.shared.setPassphrase(nil)
                    self.askLoginsPassphrase()
                })
                a.addAction(UIAlertAction(title: "Replace Server Copy With This Phone's", style: .destructive) { _ in
                    ScrayBrowserSync.shared.backupLogins(force: true) { self.flash($0) }
                })
                self.presentSafely(a)
            }
        }
    }

    private func askLoginsPassphrase() {
        let a = UIAlertController(title: "Logins passphrase",
                                  message: "Encrypts your logins before they go to the server. Use the same one on every device. It can't be recovered if you forget it.",
                                  preferredStyle: .alert)
        a.addTextField { $0.placeholder = "Passphrase"; $0.isSecureTextEntry = true }
        a.addTextField { $0.placeholder = "Same again"; $0.isSecureTextEntry = true }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        a.addAction(UIAlertAction(title: "Save", style: .default) { [weak self, weak a] _ in
            let p1 = a?.textFields?[0].text ?? "", p2 = a?.textFields?[1].text ?? ""
            guard p1.count >= 8, p1 == p2 else {
                self?.showAlert(title: "Passphrase not saved",
                                message: p1 == p2 ? "Use at least 8 characters." : "The two didn't match.")
                return
            }
            ScrayBrowserSync.shared.setPassphrase(p1)
            // Logins already on the server: bring them in. None yet: this
            // phone's become the first backup.
            self?.restoreLogins(backUpIfNone: true)
        })
        presentSafely(a)
    }

    @objc private func tabsTapped() {
        let list = ScrayTabListViewController(style: .plain)
        list.provider = { [weak self] in
            (self?.tabs ?? []).map { ($0.displayTitle, self?.compactAddress($0.displayURL) ?? "", $0.pinned) }
        }
        list.onTogglePin = { [weak self] idx in self?.togglePin(idx) }
        list.favProvider = { [weak self] in
            guard let self = self else { return [] }
            return self.loadFavourites().map { f in
                (f.title, self.compactAddress(f.url), f.pinned)
            }
        }
        list.onOpenFavourite = { [weak self] idx in
            self?.dismiss(animated: true) { self?.openFavourite(idx) }
        }
        list.onToggleFavouritePin = { [weak self] idx in self?.toggleFavouritePin(idx) }
        list.onDeleteFavourite = { [weak self] idx in self?.deleteFavourite(idx) }
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
                let tab = addTab(url: target, select: true)
                tab.opener = webView
                return
            }

            // scraynative://stashsearch?q=… — Search on a TinEye result
            // (native 14.9, ScrayTinEye.swift). The words go to the Stash
            // modal of whichever app opened the TinEye tab: Picker's tab when
            // Picker asked (switched to, modal opened there), otherwise
            // Native's main view (browser dismissed first, as for ⤴).
            // scraynative://back — "‹ Picker" on the TinEye results view
            // (native 14.15): back to the tab that opened this one. With no
            // opener to hand (the browser was restarted since), the tab
            // already on Picker, else Picker in a new tab. Either way the
            // TinEye tab stays open behind it.
            if (url.host ?? "").lowercased() == "back" {
                let from = tabs.first(where: { $0.webView === webView })
                if let opener = from?.opener,
                   let idx = tabs.firstIndex(where: { $0.webView === opener }) {
                    selectTab(idx)
                } else {
                    openOrFocus(homeURL)
                }
                return
            }

            if (url.host ?? "").lowercased() == "stashsearch" {
                let q = (query("q") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !q.isEmpty else { return }
                let from = tabs.first(where: { $0.webView === webView })
                if let opener = from?.opener,
                   let idx = tabs.firstIndex(where: { $0.webView === opener }) {
                    selectTab(idx)
                    opener.evaluateJavaScript(Self.stashSearchJS(q))
                    return
                }
                dismiss(animated: true) {
                    ScrayNativeView.current?.deliverStashSearch(q)
                }
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
        if let url = webView.url { ScrayBrowserSync.shared.recordVisit(url: url, title: webView.title) }
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
            // Remembered for ‹P (native 14.20): a link Picker opened in a new
            // tab can take you back to Picker's tab.
            tab.opener = webView
            return tab.webView
        }

        // Scripted window.open - a site forcing a new window (native 14.53).
        // Also a new tab now, like Safari, rather than the modal sheet that
        // was there for MSAL's sign-in popup (Picker no longer uses MSAL).
        // Still built from the configuration WebKit handed us, so it is a
        // real child window: window.opener works, and a sign-in popup that
        // calls window.close() on itself closes its tab and hands you back
        // to the page that opened it (webViewDidClose below).
        let tab = addTab(url: nil, configuration: configuration, select: true)
        tab.opener = webView
        tab.openedByScript = true
        let child = tab.webView

        // Belt and braces. window.open("about:blank") followed by assigning
        // location works on its own, but a window opened straight at a URL
        // occasionally arrives blank.
        if let url = navigationAction.request.url, url.absoluteString != "about:blank" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak child] in
                guard let child = child, child.url == nil, !child.isLoading else { return }
                child.load(URLRequest(url: url))
            }
        }
        return child
    }

    // MARK: - WKUIDelegate (hold a link)
    //
    // Holding a link (native 14.49) offers to open it in a new tab, in the
    // background, or to copy or share it. WebKit's own menu has none of
    // those - this browser's tabs are its own, so nothing it offers knows
    // about them - and the preview above the menu is WebKit's, kept.
    //
    // A background tab is the one worth having: reading a list of links and
    // queueing several without losing your place is exactly what the tab tray
    // is for.
    func webView(_ webView: WKWebView,
                 contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
                 completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
        guard let url = elementInfo.linkURL else { return completionHandler(nil) }

        let config = UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self, weak webView] _ in
            let open = UIAction(title: "Open", image: UIImage(systemName: "arrow.forward")) { _ in
                webView?.load(URLRequest(url: url))
            }
            let newTab = UIAction(title: "Open in New Tab",
                                  image: UIImage(systemName: "plus.square.on.square")) { _ in
                guard let self = self else { return }
                let tab = self.addTab(url: url, select: true)
                tab.opener = webView          // so ‹P can go back to the page it came from
            }
            let background = UIAction(title: "Open in Background",
                                      image: UIImage(systemName: "square.on.square.dashed")) { _ in
                guard let self = self else { return }
                let tab = self.addTab(url: url, select: false)
                tab.opener = webView
                self.refreshChrome()          // the tab count on the ⧉ button
                self.flash("Opened in a new tab")
            }
            let copy = UIAction(title: "Copy Link", image: UIImage(systemName: "doc.on.doc")) { _ in
                UIPasteboard.general.url = url
            }
            let share = UIAction(title: "Share…", image: UIImage(systemName: "square.and.arrow.up")) { _ in
                guard let self = self else { return }
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = self.view
                sheet.popoverPresentationController?.sourceRect =
                    CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
                self.presentSafely(sheet)
            }
            return UIMenu(title: url.absoluteString, children: [open, newTab, background, copy, share])
        }
        completionHandler(config)
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popupWebView { dismissPopup(); return }
        guard let idx = tabs.firstIndex(where: { $0.webView === webView }) else { return }
        // A window a page opened and then closed (a sign-in popup, native
        // 14.53) goes back to the tab that opened it, not its neighbour.
        let opener = tabs[idx].openedByScript ? tabs[idx].opener : nil
        closeTab(idx)
        if let opener = opener, let back = tabs.firstIndex(where: { $0.webView === opener }) { selectTab(back) }
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
            runStatus: function (status) { return callNative('runStatus', status || {}); },
            // Hold this browser's address bar and toolbar out of the way, for
            // a page surface that does not scroll (FLS / MPFS).
            chromeLock: function (on) { return callNative('chromeLock', { on: !!on }); }
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

            // A name already in the folder is asked about BEFORE anything is
            // fetched (native 14.3) - it used to be asked once the whole file
            // had come down. The bridge call answers after the prompt, so a
            // basket checkout simply waits on it.
            checkClash(filename: dlName, incomingSize: dlTotal) { [weak self] outcome in
                guard let self = self else { return }
                if case .cancel = outcome {
                    // A cancelled record, so the checkout's poll sees
                    // "cancelled" and sets the file aside (no retry).
                    ScrayDownloadCenter.shared.begin(id: dlID, filename: dlName, total: dlTotal, source: source)
                    ScrayDownloadCenter.shared.cancel(id: dlID)
                    try? FileManager.default.removeItem(at: dest.deletingLastPathComponent())
                    self.bridgeResolve(webView, id: id, result: ["started": false, "skipped": true, "id": dlID,
                                                                 "reason": "Already in the folder"])
                    return
                }
                if let overwrite = outcome.overwrite { self.presetOverwrite[dest.path] = overwrite }

                let job = ScrayDownloadJob(id: dlID, filename: dlName)
                job.totalBytes = dlTotal
                job.fileURL = dest
                ScrayDownloadCenter.shared.begin(id: dlID, filename: dlName, total: dlTotal, source: source)
                self.wholesaleJobIDs.insert(dlID)
                self.jobs.append(job)
                self.refreshDownloadBar()

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
                self.bridgeResolve(webView, id: id, result: ["started": true, "id": dlID])
            }

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

        case "chromeLock":
            let locked = ((body["payload"] as? [String: Any])?["on"] as? Bool) ?? false
            DispatchQueue.main.async { [weak self] in self?.setChromeLock(locked) }
            bridgeResolve(webView, id: id, result: ["success": true, "locked": locked])

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
            confirmOrClash(filename: name, size: size) { [weak self] proceed, overwrite in
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
                if let overwrite = overwrite { self.presetOverwrite[url.path] = overwrite }
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
        // Everything in the Downloads list, not just the finished ones
        // (native 14.9) - the same number as the list's title.
        trayButton.badgeCount = ScrayDownloadCenter.shared.records.count
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
        return Self.withExtension(cleaned.isEmpty ? "download" : cleaned)
    }

    /// native 15.22: a download whose name has no extension is saved as .mp4 -
    /// sites hand out bare names ("download", "1821278"), and the library and
    /// the Files app only recognise a video by its extension. A name that has
    /// one keeps it, whatever it is. Trailing dots and spaces go first, so
    /// "clip." becomes "clip.mp4", not "clip..mp4".
    static func withExtension(_ name: String) -> String {
        var base = name
        while let last = base.last, last == "." || last == " " { base.removeLast() }
        if base.isEmpty { base = "download" }
        return (base as NSString).pathExtension.isEmpty ? base + ".mp4" : base
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

        let copy: (Bool) -> Void = { overwrite in
            DispatchQueue.global(qos: .userInitiated).async {
                let saved = ScrayDownloadFolder.shared.save(fileURL: fileURL, overwrite: overwrite)
                self.deliverOnMain(fileURL: fileURL, jobID: jobID, saved: saved)
            }
        }

        // A name already in the folder used to become "name 2.mp4" without a
        // word (native 13.199). Ask - unless this run has already answered.
        DispatchQueue.main.async {
            let name = fileURL.lastPathComponent
            // Already answered before the download started (native 14.3).
            if let preset = self.presetOverwrite.removeValue(forKey: fileURL.path) {
                copy(preset)
                return
            }
            // Otherwise - the name wasn't there at the start - ask now, in
            // case one has turned up in the folder while this was downloading.
            guard let existing = ScrayDownloadFolder.shared.existingFile(named: name) else {
                copy(false)
                return
            }
            if let remembered = self.clashChoiceForRun {
                copy(remembered == .replace)
                return
            }
            ScrayFileClashPrompt.ask(filename: name, existing: existing, incoming: fileURL, from: self) { choice, remember in
                guard let choice = choice else {
                    // Cancelled: the bytes are already downloaded, but nothing
                    // is written into the folder and the row says so.
                    try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
                    if let id = jobID { ScrayDownloadCenter.shared.fail(id: id, message: "Not saved - a file with that name is already there") }
                    return
                }
                if remember { self.clashChoiceForRun = choice }
                copy(choice == .replace)
            }
        }
    }

    /// What "Replace" / "Keep both" was answered for THIS run, when the tick
    /// was on (native 13.199). Cleared once the queue empties in
    /// deliverOnMain, so the next batch asks again.
    private var clashChoiceForRun: ScrayClashChoice?

    /// Replace (true) / keep both (false), answered before the download
    /// started, by temp file path (native 14.3). deliver() takes it from here
    /// instead of asking again.
    private var presetOverwrite: [String: Bool] = [:]

    /// Clash prompts waiting their turn (native 14.3). A basket checkout
    /// starts three at once, so two clashes can be found together; they're
    /// shown one after another, and a "rest of this run" answer to the first
    /// settles the others without showing them.
    private var clashQueue: [(name: String, size: Int64, done: (ScrayClashOutcome) -> Void)] = []
    private var clashShowing = false

    /// Is `filename` already in the download folder - and if so, what to do?
    /// Always answers on the main queue, exactly once.
    fileprivate func checkClash(filename: String, incomingSize: Int64,
                                completion: @escaping (ScrayClashOutcome) -> Void) {
        DispatchQueue.main.async {
            guard ScrayDownloadFolder.shared.hasFolder,
                  ScrayDownloadFolder.shared.existingFileSize(named: filename) != nil else {
                completion(.noClash)
                return
            }
            if let remembered = self.clashChoiceForRun {
                completion(remembered == .replace ? .replace : .keepBoth)
                return
            }
            self.clashQueue.append((filename, incomingSize, completion))
            self.showNextClash()
        }
    }

    private func showNextClash() {
        guard !clashShowing, !clashQueue.isEmpty else { return }
        let next = clashQueue.removeFirst()
        if let remembered = clashChoiceForRun {
            next.done(remembered == .replace ? .replace : .keepBoth)
            showNextClash()
            return
        }
        // Gone from the folder while it waited its turn - nothing to ask.
        guard let existingBytes = ScrayDownloadFolder.shared.existingFileSize(named: next.name) else {
            next.done(.noClash)
            showNextClash()
            return
        }
        clashShowing = true
        let prompt = ScrayFileClashPrompt.make(filename: next.name,
                                               existingBytes: existingBytes,
                                               incomingBytes: next.size) { [weak self] choice, remember in
            guard let self = self else { return }
            if let choice = choice, remember { self.clashChoiceForRun = choice }
            switch choice {
            case .replace?:  next.done(.replace)
            case .keepBoth?: next.done(.keepBoth)
            case nil:        next.done(.cancel)
            }
            self.clashShowing = false
            self.showNextClash()
        }
        presentSafely(prompt)
    }

    /// The "Download this?" step for a download the user started by hand. A
    /// name clash is asked INSTEAD of the plain confirm - Replace / Keep both
    /// / Cancel already is the confirmation, and two prompts in a row would
    /// be one too many. `overwrite` is nil when there was no clash.
    fileprivate func confirmOrClash(filename: String, size: Int64,
                                    completion: @escaping (_ proceed: Bool, _ overwrite: Bool?) -> Void) {
        checkClash(filename: filename, incomingSize: size) { [weak self] outcome in
            guard let self = self else { return }
            switch outcome {
            case .noClash:
                self.confirmDownload(filename: filename, size: size) { completion($0, nil) }
            case .replace:  completion(true, true)
            case .keepBoth: completion(true, false)
            case .cancel:   completion(false, nil)
            }
        }
    }

    private func deliverOnMain(fileURL: URL, jobID: String?, saved: URL?) {
        DispatchQueue.main.async {
            // The run is over once nothing is still transferring.
            if ScrayDownloadCenter.shared.activeCount == 0 { self.clashChoiceForRun = nil }
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

        let name = Self.withExtension(suggestedFilename.isEmpty ? "download" : suggestedFilename)
        let expected = response.expectedContentLength > 0 ? response.expectedContentLength : 0

        // The completion handler may be called asynchronously, which is what
        // lets the prompt sit in front of it. The transfer only starts once
        // this returns a destination — so everything after the tap is real
        // work, and the bar below shows it happening.
        confirmOrClash(filename: name, size: expected) { [weak self] proceed, overwrite in
            guard let self = self, proceed,
                  let dest = self.makeTempDestination(filename: name) else {
                completionHandler(nil)   // nil cancels the download
                return
            }
            if let overwrite = overwrite { self.presetOverwrite[dest.path] = overwrite }
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
// The tab list - and, since native 14.8, Favourites.
//
// Two panels in one sheet: Tabs and Favourites. The segmented control at the
// top switches between them, and so does a swipe in from the screen edge
// (from the right edge for Favourites, from the left edge back to Tabs).
// Edge swipes rather than a swipe anywhere, because swiping left on a row is
// already how you reach its Close / Pin / Delete buttons.
//
// native 14.14: pinned FAVOURITES sit at the top of the Tabs panel in a
// section of their own, with a blue pin. They are links, not tabs: tapping
// one opens the favourite's own address. Tabs are section 1, so a tab's row
// is still its index into the browser's tab list.
// ============================================================================

final class ScrayTabListViewController: UITableViewController {

    enum Mode: Int { case tabs = 0, favourites = 1 }

    /// (title, address, pinned). Pinned tabs come first (native 14.4).
    var provider: (() -> [(String, String, Bool)])?
    var selectedIndex: (() -> Int)?
    var onSelect: ((Int) -> Void)?
    var onClose: ((Int) -> Void)?
    var onCloseMany: (([Int]) -> Void)?
    var onNew: (() -> Void)?
    var onTogglePin: ((Int) -> Void)?

    /// Favourites (native 14.8): (title, address, pinned). A favourite is
    /// "pinned" when it has a pinned tab at the top of the Tabs panel.
    var favProvider: (() -> [(String, String, Bool)])?
    var onOpenFavourite: ((Int) -> Void)?
    var onToggleFavouritePin: ((Int) -> Void)?
    var onDeleteFavourite: ((Int) -> Void)?
    var startMode: Mode = .tabs

    private var mode: Mode = .tabs
    private var items: [(String, String, Bool)] = []
    private var favs: [(String, String, Bool)] = []
    /// The pinned favourites shown on the Tabs panel, with their index in `favs`.
    private var pinnedFavs: [(index: Int, fav: (String, String, Bool))] = []
    private let favSection = 0, tabSection = 1
    private let segment = UISegmentedControl(items: ["Tabs", "Favourites"])
    private let emptyFavs = UILabel()

    private func isPinned(_ row: Int) -> Bool { items.indices.contains(row) && items[row].2 }
    /// The rows Select can take - everything but the pinned ones.
    private var selectableRows: [Int] { items.indices.filter { !items[$0].2 } }

    /// Multi-select mode (Tabs only): rows tick instead of switching tabs.
    private var picking = false

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "tab")
        tableView.allowsMultipleSelectionDuringEditing = true

        mode = startMode
        segment.selectedSegmentIndex = mode.rawValue
        segment.addTarget(self, action: #selector(segmentChanged), for: .valueChanged)
        // Smaller type, and each side only as wide as its words, so
        // "Favourites (12)" fits beside the buttons (native 14.13).
        segment.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 12, weight: .medium)], for: .normal)
        segment.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 12, weight: .semibold)], for: .selected)
        segment.apportionsSegmentWidthsByContent = true

        let fromRight = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeSwipe(_:)))
        fromRight.edges = .right
        let fromLeft = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeSwipe(_:)))
        fromLeft.edges = .left
        view.addGestureRecognizer(fromRight)
        view.addGestureRecognizer(fromLeft)

        emptyFavs.text = "No favourites yet.\nUse ⋯ → Add to Favourites on a page."
        emptyFavs.numberOfLines = 0
        emptyFavs.textAlignment = .center
        emptyFavs.textColor = .secondaryLabel
        emptyFavs.font = .systemFont(ofSize: 15)

        reload()
    }

    private func reload() {
        items = provider?() ?? []
        favs = favProvider?() ?? []
        pinnedFavs = favs.enumerated().filter { $0.element.2 }.map { (index: $0.offset, fav: $0.element) }
        tableView.reloadData()
        refreshChrome()
    }

    // MARK: switching panels

    @objc private func segmentChanged() {
        setMode(Mode(rawValue: segment.selectedSegmentIndex) ?? .tabs, animated: true)
    }

    @objc private func edgeSwipe(_ g: UIScreenEdgePanGestureRecognizer) {
        guard g.state == .ended, !picking else { return }
        let target: Mode = g.edges == .right ? .favourites : .tabs
        setMode(target, animated: true)
    }

    private func setMode(_ next: Mode, animated: Bool) {
        guard next != mode, !picking else {
            segment.selectedSegmentIndex = mode.rawValue
            return
        }
        let forward = next.rawValue > mode.rawValue
        mode = next
        segment.selectedSegmentIndex = mode.rawValue
        if animated {
            // Slides in from the side you swiped from, so it reads as a page.
            let t = CATransition()
            t.type = .push
            t.subtype = forward ? .fromRight : .fromLeft
            t.duration = 0.25
            t.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            tableView.layer.add(t, forKey: "scrayListMode")
        }
        reload()
    }

    /// Title and buttons depend on the panel, and while picking on how many
    /// rows are ticked, so this also runs on every selection change.
    private func refreshChrome() {
        segment.setTitle(items.count == 0 ? "Tabs" : "Tabs (\(items.count))", forSegmentAt: 0)
        segment.setTitle(favs.count == 0 ? "Favourites" : "Favourites (\(favs.count))", forSegmentAt: 1)
        tableView.backgroundView = (mode == .favourites && favs.isEmpty) ? emptyFavs : nil

        if picking {
            let n = tableView.indexPathsForSelectedRows?.count ?? 0
            navigationItem.titleView = nil
            title = n == 0 ? "Select Tabs" : "\(n) Selected"

            navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel,
                                                               target: self, action: #selector(cancelPickingTapped))
            let allOn = n > 0 && n == selectableRows.count
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
            return
        }

        navigationItem.titleView = segment
        title = mode == .tabs ? "Tabs" : "Favourites"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done,
                                                           target: self, action: #selector(doneTapped))
        if mode == .tabs {
            // A tick in a circle rather than the word (native 14.13), so the
            // Tabs | Favourites switch has room. .label is white on the dark
            // bar, the same as the other buttons' glyphs.
            let select = UIBarButtonItem(image: UIImage(systemName: "checkmark.circle"), style: .plain,
                                         target: self, action: #selector(startPickingTapped))
            select.tintColor = .label
            select.accessibilityLabel = "Select"
            select.isEnabled = !selectableRows.isEmpty
            navigationItem.rightBarButtonItems = [
                UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(newTapped)),
                select
            ]
        } else {
            navigationItem.rightBarButtonItems = []
        }
        navigationController?.setToolbarHidden(true, animated: true)
    }

    private func flexSpace() -> UIBarButtonItem {
        UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
    }

    @objc private func doneTapped() { dismiss(animated: true) }
    @objc private func newTapped()  { onNew?() }

    @objc private func startPickingTapped() {
        guard mode == .tabs else { return }
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
        // "All" means all the unpinned tabs (native 14.4).
        if !selected.isEmpty && selected.count == selectableRows.count {
            for ip in selected { tableView.deselectRow(at: ip, animated: false) }
        } else {
            for row in selectableRows {
                tableView.selectRow(at: IndexPath(row: row, section: tabSection),
                                    animated: false, scrollPosition: .none)
            }
        }
        refreshChrome()
    }

    @objc private func closeSelectedTapped() {
        let rows = (tableView.indexPathsForSelectedRows ?? [])
            .filter { $0.section == tabSection }.map { $0.row }.filter { !isPinned($0) }
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

    // MARK: rows

    override func numberOfSections(in tableView: UITableView) -> Int {
        mode == .tabs ? 2 : 1
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        if mode == .favourites { return favs.count }
        return section == favSection ? pinnedFavs.count : items.count
    }

    /// A pinned favourite's row on the Tabs panel.
    private func isFavRow(_ ip: IndexPath) -> Bool { mode == .tabs && ip.section == favSection }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        // .subtitle needs a fresh cell rather than a dequeued .default one.
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: "tab")
        if isFavRow(indexPath) {
            // A link to the favourite, not a tab: blue pin, no checkmark.
            let f = pinnedFavs[indexPath.row].fav
            cell.textLabel?.text = f.0
            cell.textLabel?.font = .systemFont(ofSize: 15, weight: .medium)
            cell.detailTextLabel?.text = f.1
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.imageView?.image = UIImage(systemName: "pin.fill")
            cell.imageView?.tintColor = .systemBlue
            return cell
        }
        let item = mode == .tabs ? items[indexPath.row] : favs[indexPath.row]
        cell.textLabel?.text = item.0
        cell.textLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        cell.detailTextLabel?.text = item.1
        cell.detailTextLabel?.textColor = .secondaryLabel

        if mode == .tabs {
            cell.accessoryType = indexPath.row == (selectedIndex?() ?? -1) ? .checkmark : .none
            if item.2 {
                cell.imageView?.image = UIImage(systemName: "pin.fill")
                cell.imageView?.tintColor = .systemOrange
            }
        } else {
            // The bookmark icon throughout; a pinned favourite also shows the
            // pin it has at the top of the Tabs panel.
            cell.imageView?.image = UIImage(systemName: "bookmark.fill")
            cell.imageView?.tintColor = .systemBlue
            if item.2 {
                let pin = UIImageView(image: UIImage(systemName: "pin.fill"))
                pin.tintColor = .systemBlue
                cell.accessoryView = pin
            }
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        if picking { refreshChrome(); return }
        tableView.deselectRow(at: indexPath, animated: true)
        if mode == .favourites { onOpenFavourite?(indexPath.row); return }
        if isFavRow(indexPath) { onOpenFavourite?(pinnedFavs[indexPath.row].index); return }
        onSelect?(indexPath.row)
    }

    override func tableView(_ tableView: UITableView, didDeselectRowAt indexPath: IndexPath) {
        if picking { refreshChrome() }
    }

    // MARK: pinning, closing, deleting

    /// While picking, pinned rows get no tick box and can't be ticked. Out of
    /// picking, every row is editable so it can be swiped.
    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool {
        if isFavRow(indexPath) { return !picking }
        return (mode == .tabs && picking) ? !isPinned(indexPath.row) : true
    }

    override func tableView(_ tableView: UITableView, willSelectRowAt indexPath: IndexPath) -> IndexPath? {
        if picking && isFavRow(indexPath) { return nil }
        return (mode == .tabs && picking && isPinned(indexPath.row)) ? nil : indexPath
    }

    private func favPinned(_ row: Int) -> Bool { favs.indices.contains(row) && favs[row].2 }

    /// Swipe left.
    ///   Tabs:        Close + Pin on a normal tab; only Unpin on a pinned one.
    ///   Favourites:  Delete + Pin / Unpin.
    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard !picking else { return nil }
        let row = indexPath.row

        // A pinned favourite on Tabs: only Unpin, which takes the link off
        // this panel. The favourite itself stays.
        if isFavRow(indexPath) {
            let favIndex = pinnedFavs[row].index
            let unpin = UIContextualAction(style: .normal, title: "Unpin") { [weak self] _, _, done in
                self?.onToggleFavouritePin?(favIndex)
                self?.reload()
                done(true)
            }
            unpin.backgroundColor = .systemBlue
            unpin.image = UIImage(systemName: "pin.slash")
            let config = UISwipeActionsConfiguration(actions: [unpin])
            config.performsFirstActionWithFullSwipe = false
            return config
        }

        if mode == .favourites {
            let pinned = favPinned(row)
            let pin = UIContextualAction(style: .normal, title: pinned ? "Unpin" : "Pin") { [weak self] _, _, done in
                self?.onToggleFavouritePin?(row)
                self?.reload()
                done(true)
            }
            pin.backgroundColor = .systemBlue
            pin.image = UIImage(systemName: pinned ? "pin.slash" : "pin")
            let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
                self?.onDeleteFavourite?(row)
                self?.reload()
                done(true)
            }
            delete.image = UIImage(systemName: "trash")
            let config = UISwipeActionsConfiguration(actions: [delete, pin])
            config.performsFirstActionWithFullSwipe = false
            return config
        }

        let pin = UIContextualAction(style: .normal, title: isPinned(row) ? "Unpin" : "Pin") { [weak self] _, _, done in
            self?.onTogglePin?(row)
            self?.reload()
            done(true)
        }
        pin.backgroundColor = .systemOrange
        pin.image = UIImage(systemName: isPinned(row) ? "pin.slash" : "pin")
        if isPinned(row) {
            let config = UISwipeActionsConfiguration(actions: [pin])
            config.performsFirstActionWithFullSwipe = false
            return config
        }
        let close = UIContextualAction(style: .destructive, title: "Close") { [weak self] _, _, done in
            self?.onClose?(row)
            self?.reload()
            done(true)
        }
        return UISwipeActionsConfiguration(actions: [close, pin])
    }

    /// Long press: the same, for anyone who doesn't think to swipe.
    override func tableView(_ tableView: UITableView,
                            contextMenuConfigurationForRowAt indexPath: IndexPath,
                            point: CGPoint) -> UIContextMenuConfiguration? {
        guard !picking else { return nil }
        let row = indexPath.row
        if isFavRow(indexPath) {
            let favIndex = pinnedFavs[row].index
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                UIMenu(title: "", children: [
                    UIAction(title: "Unpin from Tabs", image: UIImage(systemName: "pin.slash")) { [weak self] _ in
                        self?.onToggleFavouritePin?(favIndex)
                        self?.reload()
                    }
                ])
            }
        }
        let favMode = mode == .favourites
        return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
            guard let self = self else { return nil }
            let pinned = favMode ? self.favPinned(row) : self.isPinned(row)
            var actions: [UIMenuElement] = [
                UIAction(title: pinned ? (favMode ? "Unpin from Tabs" : "Unpin") : (favMode ? "Pin to Tabs" : "Pin"),
                         image: UIImage(systemName: pinned ? "pin.slash" : "pin")) { [weak self] _ in
                    if favMode { self?.onToggleFavouritePin?(row) } else { self?.onTogglePin?(row) }
                    self?.reload()
                }
            ]
            if favMode {
                actions.append(UIAction(title: "Delete Favourite", image: UIImage(systemName: "trash"),
                                        attributes: .destructive) { [weak self] _ in
                    self?.onDeleteFavourite?(row)
                    self?.reload()
                })
            } else if !pinned {
                actions.append(UIAction(title: "Close Tab", image: UIImage(systemName: "xmark"),
                                        attributes: .destructive) { [weak self] _ in
                    self?.onClose?(row)
                    self?.reload()
                })
            }
            return UIMenu(title: "", children: actions)
        }
    }

    override func tableView(_ tableView: UITableView,
                            commit editingStyle: UITableViewCell.EditingStyle,
                            forRowAt indexPath: IndexPath) {
        guard editingStyle == .delete, !isFavRow(indexPath) else { return }
        if mode == .favourites {
            onDeleteFavourite?(indexPath.row)
        } else {
            guard !isPinned(indexPath.row) else { return }
            onClose?(indexPath.row)
        }
        reload()
    }
}


// ============================================================================
// Address-bar suggestions (native 15.7) - the list under the address field
// while you type, and its rows.
// ============================================================================

extension ScrayBrowserViewController: UITableViewDataSource, UITableViewDelegate {

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        suggestions.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "suggest", for: indexPath)
        guard suggestions.indices.contains(indexPath.row) else { return cell }
        let s = suggestions[indexPath.row]
        let host = s.url.host ?? s.url.absoluteString
        cell.textLabel?.text = s.title.isEmpty ? host : s.title
        cell.textLabel?.font = .systemFont(ofSize: 14)
        cell.textLabel?.lineBreakMode = .byTruncatingTail
        cell.detailTextLabel?.text = s.url.absoluteString
        cell.detailTextLabel?.font = .systemFont(ofSize: 11)
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.detailTextLabel?.lineBreakMode = .byTruncatingMiddle
        cell.backgroundColor = .clear
        cell.imageView?.image = UIImage(systemName: "clock.arrow.circlepath")
        cell.imageView?.tintColor = .tertiaryLabel

        // ✕ forgets this URL. Its own target, and a 44pt box so it is not a
        // thing you hit by accident while aiming at the row.
        let x = UIButton(type: .system)
        x.setImage(UIImage(systemName: "xmark"), for: .normal)
        x.tintColor = .tertiaryLabel
        x.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        x.tag = indexPath.row
        x.accessibilityLabel = "Forget this address"
        x.addTarget(self, action: #selector(forgetSuggestionTapped(_:)), for: .touchUpInside)
        cell.accessoryView = x
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: false)
        guard suggestions.indices.contains(indexPath.row) else { return }
        let url = suggestions[indexPath.row].url
        addressField.text = url.absoluteString
        addressField.resignFirstResponder()
        hideSuggestions()
        if currentWebView == nil { addTab(url: url, select: true) }
        else { currentWebView?.load(URLRequest(url: url)) }
    }
}

/// A two-line cell: the page's title over its URL. UITableViewCell only gives
/// .subtitle through init, which a registered class has to ask for itself.
final class ScraySuggestCell: UITableViewCell {
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: .subtitle, reuseIdentifier: reuseIdentifier)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
