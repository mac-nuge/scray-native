import UIKit

// ============================================================================
// BROWSER CONTROLS LAYOUT (native 15.8)
// ============================================================================
//
// Where each of the in-app browser's buttons lives, and in what order - the
// browser's version of Settings > Player Controls. Every control is in one of
// four places:
//
//   top     in the address bar row, after the address (and the StashDB ↱)
//   bottom  in the bar along the bottom
//   menu    a line at the top of the ⋯ menu instead of a button
//   hidden  nowhere
//
// Edited from ⋯ > Browser Controls…, saved per phone in UserDefaults
// (scray.browser.controls.v1). Nothing saved = DEFAULT below.
//
// Two rules keep the browser usable whatever is saved:
//   ⋯  is always a button (top or bottom) - it's the way back to this screen.
//   ✕  can go in the menu but never be hidden - it's the way out.
// ============================================================================

enum ScrayBrowserControl: String, CaseIterable {
    case picker, back, forward, lastTab, reload, newTab, tabs, downloads, more, close, home

    /// The line in the editor, and the ⋯ menu's title when it's placed there.
    var title: String {
        switch self {
        case .picker:    return "‹P / ‹N  Back to Picker or Native"
        case .back:      return "Back"
        case .forward:   return "Forward"
        case .lastTab:   return "Last Tab"
        case .reload:    return "Reload"
        case .newTab:    return "New Tab"
        case .tabs:      return "Tabs"
        case .downloads: return "Downloads"
        case .more:      return "⋯ Menu"
        case .close:     return "Close Browser"
        case .home:      return "Home"
        }
    }

    /// The editor's icon. ‹P has no symbol of its own; it borrows the arrow.
    var symbol: String {
        switch self {
        case .picker:    return "arrowshape.turn.up.left"
        case .back:      return "chevron.left"
        case .forward:   return "chevron.right"
        case .lastTab:   return "rectangle.2.swap"
        case .reload:    return "arrow.clockwise"
        case .newTab:    return "plus"
        case .tabs:      return "square.on.square"
        case .downloads: return "tray.and.arrow.down"
        case .more:      return "ellipsis.circle"
        case .close:     return "xmark"
        case .home:      return "house"
        }
    }

    /// Where a control may go. See the two rules at the top.
    func allowed(in place: ScrayBrowserPlace) -> Bool {
        switch (self, place) {
        case (.more, .menu), (.more, .hidden): return false
        case (.close, .hidden):                return false
        default:                               return true
        }
    }
}

enum ScrayBrowserPlace: Int, CaseIterable {
    case top = 0, bottom, menu, hidden

    var key: String {
        switch self {
        case .top: return "top"
        case .bottom: return "bottom"
        case .menu: return "menu"
        case .hidden: return "hidden"
        }
    }

    var header: String {
        switch self {
        case .top:    return "Top — beside the address bar"
        case .bottom: return "Bottom bar"
        case .menu:   return "In the ⋯ menu"
        case .hidden: return "Hidden"
        }
    }
}

struct ScrayBrowserLayout: Equatable {
    /// One list per place, in order.
    var lists: [[ScrayBrowserControl]]

    // ⚙️ The layout with nothing saved (native 15.8): home, downloads and ⋯
    // up by the address; everything else along the bottom, ✕ last.
    static let DEFAULT = ScrayBrowserLayout(lists: [
        [.home, .downloads, .more],
        [.picker, .back, .forward, .lastTab, .reload, .newTab, .tabs, .close],
        [],
        []
    ])

    private static let storeKey = "scray.browser.controls.v1"

    func controls(in place: ScrayBrowserPlace) -> [ScrayBrowserControl] { lists[place.rawValue] }

    func place(of control: ScrayBrowserControl) -> ScrayBrowserPlace? {
        ScrayBrowserPlace.allCases.first { lists[$0.rawValue].contains(control) }
    }

    /// The saved layout, made whole: unknown names dropped, duplicates
    /// dropped, a control that isn't anywhere put back where DEFAULT has it,
    /// and the two rules applied.
    static func load() -> ScrayBrowserLayout {
        guard let saved = UserDefaults.standard.dictionary(forKey: storeKey) as? [String: [String]] else {
            return DEFAULT
        }
        var seen = Set<ScrayBrowserControl>()
        var lists: [[ScrayBrowserControl]] = ScrayBrowserPlace.allCases.map { place in
            (saved[place.key] ?? []).compactMap { raw -> ScrayBrowserControl? in
                guard let c = ScrayBrowserControl(rawValue: raw), !seen.contains(c),
                      c.allowed(in: place) else { return nil }
                seen.insert(c)
                return c
            }
        }
        for c in ScrayBrowserControl.allCases where !seen.contains(c) {
            let home = DEFAULT.place(of: c) ?? .bottom
            lists[home.rawValue].append(c)
        }
        return ScrayBrowserLayout(lists: lists)
    }

    func save() {
        var out: [String: [String]] = [:]
        for place in ScrayBrowserPlace.allCases { out[place.key] = lists[place.rawValue].map { $0.rawValue } }
        UserDefaults.standard.set(out, forKey: Self.storeKey)
    }

    static func reset() { UserDefaults.standard.removeObject(forKey: storeKey) }
}

// ============================================================================
// The editor: ⋯ > Browser Controls…
//
// A table always in edit mode, one section per place - drag a row by its
// handle to reorder it or move it to another place. Every drop is saved and
// applied to the browser behind straight away, so you can see the result as
// you go.
// ============================================================================

final class ScrayBrowserControlsViewController: UITableViewController {

    var onChange: ((ScrayBrowserLayout) -> Void)?
    private var layout = ScrayBrowserLayout.load()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Browser Controls"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "control")
        tableView.isEditing = true
        tableView.allowsSelectionDuringEditing = false
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self,
                                                            action: #selector(doneTapped))
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Reset", style: .plain, target: self,
                                                           action: #selector(resetTapped))
    }

    @objc private func doneTapped() { dismiss(animated: true) }

    @objc private func resetTapped() {
        let a = UIAlertController(title: "Reset browser controls?",
                                  message: "Back to home, downloads and ⋯ at the top and the rest along the bottom.",
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        a.addAction(UIAlertAction(title: "Reset", style: .destructive) { [weak self] _ in
            guard let self = self else { return }
            ScrayBrowserLayout.reset()
            self.layout = ScrayBrowserLayout.load()
            self.tableView.reloadData()
            self.onChange?(self.layout)
        })
        present(a, animated: true)
    }

    // MARK: data

    override func numberOfSections(in tableView: UITableView) -> Int { ScrayBrowserPlace.allCases.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        layout.lists[section].count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        ScrayBrowserPlace(rawValue: section)?.header
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch ScrayBrowserPlace(rawValue: section) {
        case .top:    return layout.lists[section].isEmpty ? "Nothing here - the address bar has the row to itself." : nil
        case .bottom: return layout.lists[section].isEmpty
                        ? "Nothing here - the bottom bar goes, and the page gets the room."
                        : "About ten fit across a phone."
        case .menu:   return "Each shows as a line at the top of the ⋯ menu. ⋯ itself always stays a button."
        case .hidden: return "Not shown anywhere. ✕ can't be hidden - it's the way out."
        case .none:   return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "control", for: indexPath)
        let c = layout.lists[indexPath.section][indexPath.row]
        var content = cell.defaultContentConfiguration()
        content.text = c.title
        content.image = UIImage(systemName: c.symbol)
        content.textProperties.color = indexPath.section == ScrayBrowserPlace.hidden.rawValue ? .secondaryLabel : .label
        cell.contentConfiguration = content
        return cell
    }

    // MARK: reordering

    override func tableView(_ tableView: UITableView, canMoveRowAt indexPath: IndexPath) -> Bool { true }
    override func tableView(_ tableView: UITableView,
                            editingStyleForRowAt indexPath: IndexPath) -> UITableViewCell.EditingStyle { .none }
    override func tableView(_ tableView: UITableView,
                            shouldIndentWhileEditingRowAt indexPath: IndexPath) -> Bool { false }

    /// ⋯ and ✕ bounce back from a place they can't go (see the rules at the top).
    override func tableView(_ tableView: UITableView,
                            targetIndexPathForMoveFromRowAt source: IndexPath,
                            toProposedIndexPath proposed: IndexPath) -> IndexPath {
        let c = layout.lists[source.section][source.row]
        guard let place = ScrayBrowserPlace(rawValue: proposed.section), c.allowed(in: place) else { return source }
        return proposed
    }

    override func tableView(_ tableView: UITableView, moveRowAt source: IndexPath, to dest: IndexPath) {
        let c = layout.lists[source.section].remove(at: source.row)
        let row = min(dest.row, layout.lists[dest.section].count)
        layout.lists[dest.section].insert(c, at: row)
        layout.save()
        onChange?(layout)
        // Footers and the hidden row's grey follow the new state.
        DispatchQueue.main.async { self.tableView.reloadData() }
    }
}
