import UIKit
import WebKit
import CryptoKit
import CommonCrypto
import Security

// ============================================================================
// ScrayBrowserSync (native 14.29) — the in-app browser's favourites, history
// and logins, kept on the server so a reinstall or another device gets them
// back. Talks to api.php directly with the device key, which the web layer
// hands over on openBrowser (scray-bridge.js) and is remembered here.
//
//   Favourites  last write wins, whole list (browser_favs_get/_set). Pulled
//               every time the browser opens; pushed on every change. A
//               change made offline stays "dirty" and is pushed next time.
//   History     every page that finishes loading, queued here and sent in
//               batches (browser_history_add). The server keeps 90 days and
//               browser.html in scray-browse shows it on the desktop.
//   Logins      the browser's cookies, encrypted HERE with a passphrase kept
//               in the Keychain (AES-GCM, key from PBKDF2-SHA256). The server
//               only ever sees the sealed blob - the device key is public,
//               so plain cookies there would be anyone's logins.
//
// Not covered: sites that keep their login in localStorage rather than a
// cookie (MSAL does). Those still need signing in again after a reinstall.
// ============================================================================

final class ScrayBrowserSync {

    static let shared = ScrayBrowserSync()

    private let d = UserDefaults.standard
    private static let apiKey      = "scray.browser.sync.api"
    private static let keyKey      = "scray.browser.sync.key"
    private static let favRevKey   = "scray.browser.sync.favRev"
    private static let favDirtyKey = "scray.browser.sync.favDirty"
    private static let historyKey  = "scray.browser.history"          // this device's, newest first
    private static let pendingKey  = "scray.browser.history.pending"  // not yet on the server
    private static let vaultAtKey  = "scray.browser.sync.vaultAt"
    private static let restoredKey = "scray.browser.sync.restored"
    private static let kcService   = "scray.browser.vault"
    private static let rounds      = 200_000

    private init() {
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.flushHistory()
            self?.backupLogins(force: false, completion: nil)
        }
    }

    var device: String { UIDevice.current.name }

    // MARK: - Server

    /// From openBrowser's payload. Kept, so a browser opened another way
    /// (a window.open from the main view) still syncs.
    func configure(api: String?, key: String?) {
        if let a = api, !a.isEmpty { d.set(a, forKey: Self.apiKey) }
        if let k = key, !k.isEmpty { d.set(k, forKey: Self.keyKey) }
    }

    var isConfigured: Bool { d.string(forKey: Self.apiKey) != nil && d.string(forKey: Self.keyKey) != nil }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// POST to api.php. The completion runs on the main queue.
    func call(_ action: String, _ body: [String: Any],
              completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let done: (Result<[String: Any], Error>) -> Void = { r in DispatchQueue.main.async { completion(r) } }
        guard let base = d.string(forKey: Self.apiKey), let key = d.string(forKey: Self.keyKey),
              var comps = URLComponents(string: base) else {
            done(.failure(Failure(message: "Open the browser from Scray once so it knows the server")))
            return
        }
        comps.queryItems = (comps.queryItems ?? []) + [URLQueryItem(name: "action", value: action)]
        guard let url = comps.url else { done(.failure(Failure(message: "bad server address"))); return }
        var req = URLRequest(url: url, timeoutInterval: 60)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "X-Scray-Key")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { done(.failure(err)); return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard let data = data,
                  let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                done(.failure(Failure(message: "the server answered HTTP \(code)"))); return
            }
            if (j["ok"] as? Bool) == true { done(.success(j)) }
            else { done(.failure(Failure(message: (j["error"] as? String) ?? "HTTP \(code)"))) }
        }.resume()
    }

    // MARK: - Favourites
    //
    // The browser's own format: [{ "title", "url", "pinned": "1"? }].

    /// After every local change.
    func pushFavourites(_ raw: [[String: String]]) {
        d.set(true, forKey: Self.favDirtyKey)
        let list: [[String: Any]] = raw.map { ["title": $0["title"] ?? "", "url": $0["url"] ?? "",
                                               "pinned": $0["pinned"] == "1"] }
        call("browser_favs_set", ["favourites": list, "device": device]) { [weak self] r in
            guard let self = self, case .success(let j) = r else { return }
            self.d.set(j["rev"] as? Int ?? 0, forKey: Self.favRevKey)
            self.d.set(false, forKey: Self.favDirtyKey)
        }
    }

    /// When the browser opens. `adopt` gets the list to save locally when the
    /// server's is newer. The first sync on a device merges the two instead,
    /// so favourites made before this existed aren't thrown away.
    func pullFavourites(local: @escaping () -> [[String: String]],
                        adopt: @escaping ([[String: String]]) -> Void) {
        guard isConfigured else { return }
        if d.bool(forKey: Self.favDirtyKey) { pushFavourites(local()); return }
        call("browser_favs_get", [:]) { [weak self] r in
            guard let self = self, case .success(let j) = r else { return }
            let rev = j["rev"] as? Int ?? 0
            let seen = self.d.integer(forKey: Self.favRevKey)
            guard rev != seen, !self.d.bool(forKey: Self.favDirtyKey) else { return }
            let server: [[String: String]] = (j["favourites"] as? [[String: Any]] ?? []).compactMap { f -> [String: String]? in
                guard let u = f["url"] as? String else { return nil }
                var o = ["title": (f["title"] as? String) ?? u, "url": u]
                if (f["pinned"] as? Bool) == true { o["pinned"] = "1" }
                return o
            }
            let mine = local()
            if seen == 0 {
                // First sync here: everything on the server, then anything
                // only this device had.
                let known = Set(server.compactMap { $0["url"] })
                let merged = server + mine.filter { !known.contains($0["url"] ?? "") }
                adopt(merged)
                if merged.count != server.count || rev == 0 { self.pushFavourites(merged) }
                else { self.d.set(rev, forKey: Self.favRevKey) }
                return
            }
            adopt(server)
            self.d.set(rev, forKey: Self.favRevKey)
        }
    }

    // MARK: - History

    struct Visit {
        let id: Int?
        let title: String
        let url: URL
        let at: Date
        let device: String?
    }

    private static let iso: ISO8601DateFormatter = ISO8601DateFormatter()
    private var pushTimer: Timer?
    private var pushing = false

    /// Every main-frame page that finishes loading.
    func recordVisit(url: URL, title: String?) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        let s = url.absoluteString
        let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Date()
        var local = d.array(forKey: Self.historyKey) as? [[String: Any]] ?? []
        // A reload, or the same page again within a minute, is one visit.
        if let first = local.first, first["url"] as? String == s,
           let at = first["at"] as? Double, now.timeIntervalSince1970 - at < 60 {
            if !t.isEmpty { local[0]["title"] = t; d.set(local, forKey: Self.historyKey) }
            return
        }
        local.insert(["url": s, "title": t, "at": now.timeIntervalSince1970], at: 0)
        if local.count > 1000 { local.removeLast(local.count - 1000) }
        d.set(local, forKey: Self.historyKey)

        var pending = d.array(forKey: Self.pendingKey) as? [[String: String]] ?? []
        pending.append(["url": s, "title": t, "at": Self.iso.string(from: now)])
        if pending.count > 5000 { pending.removeFirst(pending.count - 5000) }
        d.set(pending, forKey: Self.pendingKey)

        pushTimer?.invalidate()
        pushTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            self?.flushHistory()
        }
    }

    func flushHistory() {
        guard !pushing, isConfigured else { return }
        let pending = d.array(forKey: Self.pendingKey) as? [[String: String]] ?? []
        guard !pending.isEmpty else { return }
        let batch = Array(pending.prefix(500))
        pushing = true
        call("browser_history_add", ["visits": batch, "device": device]) { [weak self] r in
            guard let self = self else { return }
            self.pushing = false
            guard case .success = r else { return }
            var now = self.d.array(forKey: Self.pendingKey) as? [[String: String]] ?? []
            now.removeFirst(min(batch.count, now.count))
            self.d.set(now, forKey: Self.pendingKey)
            if !now.isEmpty { self.flushHistory() }
        }
    }

    /// This device's own visits, for when the server can't be reached.
    func localHistory(matching q: String) -> [Visit] {
        let words = q.lowercased().split(separator: " ").map(String.init)
        return (d.array(forKey: Self.historyKey) as? [[String: Any]] ?? []).compactMap { o -> Visit? in
            guard let s = o["url"] as? String, let u = URL(string: s) else { return nil }
            let t = o["title"] as? String ?? ""
            let hay = (s + " " + t).lowercased()
            guard words.allSatisfy({ hay.contains($0) }) else { return nil }
            return Visit(id: nil, title: t, url: u,
                         at: Date(timeIntervalSince1970: o["at"] as? Double ?? 0), device: nil)
        }
    }

    /// Every device's visits from the server, newest first. nil when offline.
    func fetchHistory(q: String, completion: @escaping ([Visit]?) -> Void) {
        flushHistory()
        call("browser_history", ["q": q, "limit": 300]) { r in
            guard case .success(let j) = r else { completion(nil); return }
            completion((j["visits"] as? [[String: Any]] ?? []).compactMap { o -> Visit? in
                guard let s = o["url"] as? String, let u = URL(string: s) else { return nil }
                return Visit(id: o["id"] as? Int, title: o["title"] as? String ?? "", url: u,
                             at: Self.iso.date(from: o["visited_at"] as? String ?? "") ?? Date(),
                             device: o["device"] as? String)
            })
        }
    }

    func deleteHistory(ids: [Int], completion: @escaping (Bool) -> Void) {
        call("browser_history_delete", ["ids": ids]) { r in
            if case .success = r { completion(true) } else { completion(false) }
        }
    }

    func clearHistory(completion: @escaping (Bool) -> Void) {
        d.removeObject(forKey: Self.historyKey)
        d.removeObject(forKey: Self.pendingKey)
        call("browser_history_delete", ["all": true]) { r in
            if case .success = r { completion(true) } else { completion(false) }
        }
    }

    // MARK: - Logins (cookies, encrypted)

    var passphrase: String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: Self.kcService,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func setPassphrase(_ p: String?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: Self.kcService]
        SecItemDelete(base as CFDictionary)
        guard let p = p, !p.isEmpty else { return }
        // Set up by hand: whatever restore it needs is done there, not by
        // restoreAfterReinstallIfNeeded on the next open.
        d.set(true, forKey: Self.restoredKey)
        var add = base
        add[kSecValueData as String] = Data(p.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    var lastBackup: Date? { d.object(forKey: Self.vaultAtKey) as? Date }

    private func deriveKey(_ pass: String, salt: Data, rounds: Int) -> SymmetricKey {
        var out = [UInt8](repeating: 0, count: 32)
        let passLen = pass.utf8.count, outLen = out.count
        salt.withUnsafeBytes { (s: UnsafeRawBufferPointer) in
            _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass, passLen,
                                     s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(rounds),
                                     &out, outLen)
        }
        return SymmetricKey(data: out)
    }

    private func cookieDict(_ c: HTTPCookie) -> [String: Any] {
        var o: [String: Any] = ["name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
                                "secure": c.isSecure, "httpOnly": c.isHTTPOnly]
        if let e = c.expiresDate { o["expires"] = e.timeIntervalSince1970 }
        if let s = c.sameSitePolicy { o["sameSite"] = s.rawValue }
        return o
    }

    private func cookie(from o: [String: Any]) -> HTTPCookie? {
        guard let n = o["name"] as? String, let v = o["value"] as? String,
              let dom = o["domain"] as? String else { return nil }
        var p: [HTTPCookiePropertyKey: Any] = [.name: n, .value: v, .domain: dom,
                                               .path: (o["path"] as? String) ?? "/"]
        if (o["secure"] as? Bool) == true { p[.secure] = "TRUE" }
        if (o["httpOnly"] as? Bool) == true { p[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let e = o["expires"] as? Double { p[.expires] = Date(timeIntervalSince1970: e) }
        if let s = o["sameSite"] as? String { p[.sameSitePolicy] = s }
        return HTTPCookie(properties: p)
    }

    /// Seal every live cookie and send it. `force` false (closing the browser,
    /// going to the background) does it at most every ten minutes.
    func backupLogins(force: Bool, completion: ((String) -> Void)?) {
        guard isConfigured, let pass = passphrase else {
            completion?("Set a logins passphrase first"); return
        }
        if !force, let last = lastBackup, Date().timeIntervalSince(last) < 600 { return }
        let bg = UIApplication.shared.beginBackgroundTask(withName: "scray.vault", expirationHandler: nil)
        let finish: (String) -> Void = { msg in
            completion?(msg)
            if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) }
        }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            let now = Date()
            let live = cookies.filter { ($0.expiresDate ?? .distantFuture) > now }.map(self.cookieDict)
            let device = self.device
            DispatchQueue.global(qos: .utility).async {
                var salt = Data(count: 16)
                let ok = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
                guard ok == errSecSuccess,
                      let plain = try? JSONSerialization.data(withJSONObject: ["cookies": live,
                                                                               "at": now.timeIntervalSince1970]),
                      let box = try? AES.GCM.seal(plain, using: self.deriveKey(pass, salt: salt, rounds: Self.rounds)).combined
                else { DispatchQueue.main.async { finish("Couldn't encrypt the logins") }; return }
                let vault: [String: Any] = ["v": 1, "salt": salt.base64EncodedString(), "iter": Self.rounds,
                                            "box": box.base64EncodedString(), "cookies": live.count]
                self.call("browser_vault_set", ["vault": vault, "device": device]) { r in
                    switch r {
                    case .success:
                        self.d.set(now, forKey: Self.vaultAtKey)
                        finish("Logins backed up (\(live.count) cookies)")
                    case .failure(let e):
                        finish("Logins backup failed: \(e.localizedDescription)")
                    }
                }
            }
        }
    }

    enum RestoreResult { case restored(Int), nothingSaved, wrongPassphrase, failed(String) }

    /// Open the server's blob and put every cookie in it into the browser.
    /// Cookies the browser already has with the same name, domain and path
    /// are replaced; the rest are left alone.
    func restoreLogins(completion: @escaping (RestoreResult) -> Void) {
        guard let pass = passphrase else { completion(.wrongPassphrase); return }
        call("browser_vault_get", [:]) { [weak self] r in
            guard let self = self else { return }
            let j: [String: Any]
            switch r {
            case .failure(let e): completion(.failed(e.localizedDescription)); return
            case .success(let x): j = x
            }
            guard let v = j["vault"] as? [String: Any],
                  let salt = Data(base64Encoded: v["salt"] as? String ?? ""),
                  let box = Data(base64Encoded: v["box"] as? String ?? "") else {
                completion(.nothingSaved); return
            }
            let rounds = (v["iter"] as? Int).flatMap { $0 > 0 ? $0 : nil } ?? Self.rounds
            DispatchQueue.global(qos: .userInitiated).async {
                guard let sealed = try? AES.GCM.SealedBox(combined: box),
                      let plain = try? AES.GCM.open(sealed, using: self.deriveKey(pass, salt: salt, rounds: rounds)),
                      let obj = (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any],
                      let list = obj["cookies"] as? [[String: Any]] else {
                    DispatchQueue.main.async { completion(.wrongPassphrase) }
                    return
                }
                DispatchQueue.main.async {
                    let store = WKWebsiteDataStore.default().httpCookieStore
                    let group = DispatchGroup()
                    var n = 0
                    let now = Date()
                    for o in list {
                        guard let c = self.cookie(from: o), (c.expiresDate ?? .distantFuture) > now else { continue }
                        n += 1
                        group.enter()
                        store.setCookie(c) { group.leave() }
                    }
                    group.notify(queue: .main) {
                        self.d.set(true, forKey: Self.restoredKey)
                        completion(.restored(n))
                    }
                }
            }
        }
    }

    /// A fresh install (UserDefaults gone) whose Keychain still has the
    /// passphrase: put the logins back without being asked, once.
    func restoreAfterReinstallIfNeeded(done: @escaping (String) -> Void) {
        guard isConfigured, passphrase != nil, !d.bool(forKey: Self.restoredKey) else { return }
        d.set(true, forKey: Self.restoredKey)
        restoreLogins { r in
            if case .restored(let n) = r, n > 0 { done("Logins restored from the server (\(n) cookies)") }
        }
    }
}

// ============================================================================
// History panel (native 14.29): every device's visits from the server, newest
// first, with a search box. Falls back to this phone's own list offline.
// ============================================================================

final class ScrayHistoryViewController: UITableViewController, UISearchResultsUpdating {

    var onOpen: ((URL) -> Void)?

    private var rows: [ScrayBrowserSync.Visit] = []
    private var offline = false
    private let search = UISearchController(searchResultsController: nil)
    private var searchTimer: Timer?
    private var seq = 0
    private static let when: DateFormatter = {
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "History"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self,
                                                           action: #selector(doneTapped))
        let clear = UIBarButtonItem(title: "Clear", style: .plain, target: self, action: #selector(clearTapped))
        clear.tintColor = .systemRed
        navigationItem.rightBarButtonItem = clear
        search.searchResultsUpdater = self
        search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = "Search history"
        navigationItem.searchController = search
        navigationItem.hidesSearchBarWhenScrolling = false
        load()
    }

    @objc private func doneTapped() { dismiss(animated: true) }

    private var query: String { search.searchBar.text?.trimmingCharacters(in: .whitespaces) ?? "" }

    func updateSearchResults(for searchController: UISearchController) {
        searchTimer?.invalidate()
        searchTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { [weak self] _ in self?.load() }
    }

    private func load() {
        seq += 1
        let mine = seq, q = query
        ScrayBrowserSync.shared.fetchHistory(q: q) { [weak self] visits in
            guard let self = self, mine == self.seq else { return }
            self.offline = visits == nil
            self.rows = visits ?? ScrayBrowserSync.shared.localHistory(matching: q)
            self.tableView.reloadData()
            self.navigationItem.prompt = self.offline ? "Offline — showing this phone's history only" : nil
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let v = rows[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: "h")
        cell.textLabel?.text = v.title.isEmpty ? (v.url.host ?? v.url.absoluteString) : v.title
        cell.textLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        var sub = "\(v.url.host ?? "") · \(Self.when.string(from: v.at))"
        if let dev = v.device, !dev.isEmpty, dev != ScrayBrowserSync.shared.device { sub += " · \(dev)" }
        cell.detailTextLabel?.text = sub
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.imageView?.image = UIImage(systemName: "clock")
        cell.imageView?.tintColor = .secondaryLabel
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let url = rows[indexPath.row].url
        search.isActive = false
        dismiss(animated: true) { [weak self] in self?.onOpen?(url) }
    }

    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let id = rows[indexPath.row].id else { return nil }
        let del = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
            ScrayBrowserSync.shared.deleteHistory(ids: [id]) { ok in
                guard let self = self, ok, let i = self.rows.firstIndex(where: { $0.id == id }) else { done(false); return }
                self.rows.remove(at: i)
                self.tableView.deleteRows(at: [IndexPath(row: i, section: 0)], with: .automatic)
                done(true)
            }
        }
        del.image = UIImage(systemName: "trash")
        return UISwipeActionsConfiguration(actions: [del])
    }

    @objc private func clearTapped() {
        let a = UIAlertController(title: "Clear all history?",
                                  message: "Removes every device's browsing history from the server, and this phone's.",
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        a.addAction(UIAlertAction(title: "Clear History", style: .destructive) { [weak self] _ in
            ScrayBrowserSync.shared.clearHistory { _ in self?.load() }
        })
        present(a, animated: true)
    }
}
