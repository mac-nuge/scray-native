import UIKit

// ============================================================================
// The download list behind the tray button and the ⋯ menu.
//
// ScrayDownloadJob (in ScrayDownloads.swift) is the *transfer* — file handles,
// KVO on WKDownload, the things that only exist while bytes are moving. This
// is the *history*: it outlives the transfer so a finished download is still
// there to look at, share or clear away, which is the half Safari's list is
// actually for. The browser drives it; the panel reads it.
// ============================================================================

final class ScrayDownloadRecord {

    enum State: Equatable { case active, paused, finished, failed, cancelled }

    let id: String
    let filename: String
    let started = Date()
    var total: Int64
    var received: Int64 = 0
    var state: State = .active
    var savedURL: URL?
    var message: String?

    /// Transferring or stopped-but-resumable, as opposed to done with.
    var isLive: Bool { state == .active || state == .paused }

    init(id: String, filename: String, total: Int64) {
        self.id = id
        self.filename = filename
        self.total = total
    }
}

final class ScrayDownloadCenter {

    static let shared = ScrayDownloadCenter()

    /// Newest first, the way Safari's list reads.
    private(set) var records: [ScrayDownloadRecord] = []

    /// Claimed by whoever is currently showing the list, released on the way
    /// out. One slot is enough — only one panel can be up at a time.
    var onChange: (() -> Void)?

    /// The browser's own hook, held for the life of the browser. Separate from
    /// onChange so the panel appearing and disappearing can't unhook the badge.
    var onCountChange: (() -> Void)?

    var activeCount: Int { records.filter { $0.state == .active }.count }

    /// What the tray badge counts: finished and not yet cleared away.
    var completedCount: Int { records.filter { $0.state == .finished }.count }

    /// Paused still counts as live — "Clear" must not sweep away something
    /// you're part-way through and meant to come back to.
    var hasFinished: Bool { records.contains { !$0.isLive } }

    @discardableResult
    func begin(id: String, filename: String, total: Int64) -> ScrayDownloadRecord {
        let record = ScrayDownloadRecord(id: id, filename: filename, total: total)
        records.insert(record, at: 0)
        changed()
        return record
    }

    func progress(id: String, received: Int64, total: Int64) {
        guard let r = records.first(where: { $0.id == id }), r.state == .active else { return }
        r.received = received
        if total > 0 { r.total = total }
        changed()
    }

    func pause(id: String) {
        guard let r = records.first(where: { $0.id == id }), r.state == .active else { return }
        r.state = .paused
        changed()
    }

    func resume(id: String) {
        guard let r = records.first(where: { $0.id == id }), r.state == .paused else { return }
        r.state = .active
        changed()
    }

    func finish(id: String, savedURL: URL?) {
        guard let r = records.first(where: { $0.id == id }) else { return }
        r.state = .finished
        r.savedURL = savedURL
        if r.total <= 0 { r.total = r.received }
        changed()
    }

    func fail(id: String, message: String) {
        guard let r = records.first(where: { $0.id == id }), r.isLive else { return }
        r.state = .failed
        r.message = message
        changed()
    }

    func cancel(id: String) {
        guard let r = records.first(where: { $0.id == id }), r.isLive else { return }
        r.state = .cancelled
        changed()
    }

    func remove(id: String) {
        records.removeAll { $0.id == id }
        changed()
    }

    func clearFinished() {
        records.removeAll { !$0.isLive }
        changed()
    }

    private func changed() {
        DispatchQueue.main.async {
            self.onChange?()
            self.onCountChange?()
        }
    }
}

// ============================================================================

final class ScrayDownloadCell: UITableViewCell {

    /// Tapped straight on the row. Swiping to reach a control you need
    /// mid-transfer was fiddly enough to be a bug in its own right.
    var onPauseResume: (() -> Void)?
    var onCancel: (() -> Void)?

    private let icon = UIImageView()
    private let nameLabel = UILabel()
    private let detailLabel = UILabel()
    private let bar = UIProgressView(progressViewStyle: .default)
    private let pauseButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)

    private static let formatter: ByteCountFormatter = {
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f
    }()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        icon.contentMode = .scaleAspectFit
        icon.setContentHuggingPriority(.required, for: .horizontal)
        icon.widthAnchor.constraint(equalToConstant: 26).isActive = true

        nameLabel.font = .systemFont(ofSize: 15, weight: .medium)
        nameLabel.lineBreakMode = .byTruncatingMiddle

        detailLabel.font = .systemFont(ofSize: 11)
        detailLabel.textColor = .secondaryLabel
        detailLabel.lineBreakMode = .byTruncatingTail

        bar.progressTintColor = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800

        let text = UIStackView(arrangedSubviews: [nameLabel, detailLabel, bar])
        text.axis = .vertical
        text.spacing = 3

        for (button, symbol, action) in [
            (pauseButton, "pause.circle", #selector(pauseTapped)),
            (cancelButton, "xmark.circle", #selector(cancelTapped))
        ] {
            button.setImage(UIImage(systemName: symbol), for: .normal)
            button.addTarget(self, action: action, for: .touchUpInside)
            button.setContentHuggingPriority(.required, for: .horizontal)
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            button.widthAnchor.constraint(equalToConstant: 40).isActive = true
            button.heightAnchor.constraint(equalToConstant: 40).isActive = true
        }
        pauseButton.tintColor = .systemBlue
        cancelButton.tintColor = .systemRed

        let row = UIStackView(arrangedSubviews: [icon, text, pauseButton, cancelButton])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            row.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
            row.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10)
        ])
    }

    @objc private func pauseTapped() { onPauseResume?() }
    @objc private func cancelTapped() { onCancel?() }

    func configure(with r: ScrayDownloadRecord) {
        nameLabel.text = r.filename
        let f = Self.formatter

        // Controls only make sense while there's something to control.
        pauseButton.isHidden = !r.isLive
        cancelButton.isHidden = !r.isLive
        pauseButton.setImage(UIImage(systemName: r.state == .paused ? "play.circle" : "pause.circle"),
                             for: .normal)

        switch r.state {
        case .active:
            icon.image = UIImage(systemName: "arrow.down.circle")
            icon.tintColor = .systemBlue
            bar.isHidden = false
            if r.total > 0 {
                bar.setProgress(Float(min(1.0, Double(r.received) / Double(r.total))), animated: false)
                detailLabel.text = "\(f.string(fromByteCount: r.received)) of \(f.string(fromByteCount: r.total))"
            } else {
                bar.setProgress(0, animated: false)
                detailLabel.text = f.string(fromByteCount: r.received)
            }

        case .paused:
            icon.image = UIImage(systemName: "pause.circle.fill")
            icon.tintColor = .systemOrange
            bar.isHidden = false
            if r.total > 0 {
                bar.setProgress(Float(min(1.0, Double(r.received) / Double(r.total))), animated: false)
                detailLabel.text = "Paused · \(f.string(fromByteCount: r.received)) of \(f.string(fromByteCount: r.total))"
            } else {
                bar.setProgress(0, animated: false)
                detailLabel.text = "Paused · \(f.string(fromByteCount: r.received))"
            }

        case .finished:
            icon.image = UIImage(systemName: "checkmark.circle.fill")
            icon.tintColor = .systemGreen
            bar.isHidden = true
            if let saved = r.savedURL {
                let folder = saved.deletingLastPathComponent().lastPathComponent
                detailLabel.text = "\(f.string(fromByteCount: r.total)) · \(folder)"
            } else {
                detailLabel.text = f.string(fromByteCount: r.total)
            }

        case .failed:
            icon.image = UIImage(systemName: "exclamationmark.circle.fill")
            icon.tintColor = .systemRed
            bar.isHidden = true
            detailLabel.text = r.message ?? "Failed"

        case .cancelled:
            icon.image = UIImage(systemName: "xmark.circle")
            icon.tintColor = .tertiaryLabel
            bar.isHidden = true
            detailLabel.text = "Cancelled"
        }

        // Only a finished file still sitting on disk can be opened.
        let openable = r.state == .finished
            && r.savedURL.map { FileManager.default.fileExists(atPath: $0.path) } == true
        accessoryType = openable ? .disclosureIndicator : .none
        selectionStyle = openable ? .default : .none
    }
}

// ============================================================================

final class ScrayDownloadsViewController: UITableViewController {

    /// Handed back to the browser, which owns the actual transfer.
    var onCancel: ((String) -> Void)?
    var onPause: ((String) -> Void)?
    var onResume: ((String) -> Void)?

    private var reloadScheduled = false
    private let emptyLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Downloads"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done,
                                                           target: self, action: #selector(doneTapped))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Clear", style: .plain,
                                                            target: self, action: #selector(clearTapped))
        tableView.register(ScrayDownloadCell.self, forCellReuseIdentifier: "dl")
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 64

        emptyLabel.text = "No downloads"
        emptyLabel.textColor = .secondaryLabel
        emptyLabel.textAlignment = .center
        emptyLabel.font = .systemFont(ofSize: 15)
        tableView.backgroundView = emptyLabel
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        ScrayDownloadCenter.shared.onChange = { [weak self] in self?.scheduleReload() }
        refresh()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        ScrayDownloadCenter.shared.onChange = nil
    }

    /// Progress fires per chunk; reloading the table that often would fight
    /// the scroll. Coalesce into a quarter-second tick.
    private func scheduleReload() {
        guard !reloadScheduled else { return }
        reloadScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.reloadScheduled = false
            self?.refresh()
        }
    }

    private func refresh() {
        let center = ScrayDownloadCenter.shared
        emptyLabel.isHidden = !center.records.isEmpty
        navigationItem.rightBarButtonItem?.isEnabled = center.hasFinished
        tableView.reloadData()
    }

    @objc private func doneTapped() { dismiss(animated: true) }

    @objc private func clearTapped() {
        ScrayDownloadCenter.shared.clearFinished()
        refresh()
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        ScrayDownloadCenter.shared.records.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "dl", for: indexPath)
        if let cell = cell as? ScrayDownloadCell,
           let record = record(at: indexPath) {
            cell.configure(with: record)
            cell.onPauseResume = { [weak self] in
                guard let self = self else { return }
                if record.state == .paused { self.onResume?(record.id) }
                else { self.onPause?(record.id) }
                self.refresh()
            }
            cell.onCancel = { [weak self] in
                self?.onCancel?(record.id)
                self?.refresh()
            }
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard let record = record(at: indexPath),
              record.state == .finished,
              let url = record.savedURL,
              FileManager.default.fileExists(atPath: url.path) else { return }

        // A file inside a user-picked folder is only readable while its
        // security scope is held, and the share sheet reads it asynchronously
        // — so the scope stays open until the sheet goes away.
        let scoped = url.startAccessingSecurityScopedResource()
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.completionWithItemsHandler = { _, _, _, _ in
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        share.popoverPresentationController?.sourceView = tableView.cellForRow(at: indexPath)
        present(share, animated: true)
    }

    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath)
                            -> UISwipeActionsConfiguration? {
        guard let record = record(at: indexPath) else { return nil }

        // Live rows carry their own pause and cancel buttons — no swipe, so
        // a stray horizontal drag while scrolling can't do anything.
        guard !record.isLive else { return nil }

        let remove = UIContextualAction(style: .destructive, title: "Remove") { [weak self] _, _, done in
            ScrayDownloadCenter.shared.remove(id: record.id)
            self?.refresh()
            done(true)
        }
        return UISwipeActionsConfiguration(actions: [remove])
    }

    private func record(at indexPath: IndexPath) -> ScrayDownloadRecord? {
        let records = ScrayDownloadCenter.shared.records
        return records.indices.contains(indexPath.row) ? records[indexPath.row] : nil
    }
}
