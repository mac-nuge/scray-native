import UIKit
import WebKit

// ============================================================================
// One in-flight download, whichever route it came in by.
// ============================================================================

final class ScrayDownloadJob {
    let id: String
    let filename: String
    var totalBytes: Int64 = 0
    var receivedBytes: Int64 = 0

    /// Where the bytes are accumulating before they're handed to Files.
    var fileURL: URL?
    var handle: FileHandle?

    /// blob:/data: route — the page streaming chunks over the bridge.
    weak var webView: WKWebView?

    /// http(s) route. Held as AnyObject so this class needn't be gated on
    /// iOS 14.5 just to store a WKDownload.
    var httpKey: ObjectIdentifier?
    var httpDownload: AnyObject?
    var progressObs: NSKeyValueObservation?

    /// Pause state. WKDownload has no pause — the only thing it offers is
    /// cancelling *with resume data*, so a paused HTTP download is a
    /// cancelled one holding the bytes needed to pick up again. The blob
    /// route just stops pumping chunks and keeps its offset.
    var resumeData: Data?
    var wasResumed = false

    var isPaused: Bool { resumeData != nil || pausedInPage }
    var pausedInPage = false

    init(id: String, filename: String) {
        self.id = id
        self.filename = filename
    }
}

// ============================================================================
// The bar that appears above the toolbar while something is downloading.
// ============================================================================

final class ScrayDownloadBar: UIView {

    var onCancel: (() -> Void)?

    private let nameLabel = UILabel()
    private let detailLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)

    private static let formatter: ByteCountFormatter = {
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f
    }()

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        backgroundColor = .secondarySystemBackground

        nameLabel.font = .systemFont(ofSize: 12, weight: .medium)
        nameLabel.lineBreakMode = .byTruncatingMiddle
        detailLabel.font = .systemFont(ofSize: 10)
        detailLabel.textColor = .secondaryLabel

        let cancelButton = UIButton(type: .system)
        cancelButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        cancelButton.tintColor = .tertiaryLabel
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancelButton.widthAnchor.constraint(equalToConstant: 30).isActive = true

        progressView.progressTintColor = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800

        let text = UIStackView(arrangedSubviews: [nameLabel, detailLabel])
        text.axis = .vertical
        text.spacing = 1

        let row = UIStackView(arrangedSubviews: [text, cancelButton])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8

        let column = UIStackView(arrangedSubviews: [row, progressView])
        column.axis = .vertical
        column.spacing = 6
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)

        let hairline = UIView()
        hairline.backgroundColor = .separator
        hairline.translatesAutoresizingMaskIntoConstraints = false
        addSubview(hairline)

        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            column.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            column.centerYAnchor.constraint(equalTo: centerYAnchor),

            hairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            hairline.topAnchor.constraint(equalTo: topAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 0.5)
        ])
    }

    @objc private func cancelTapped() { onCancel?() }

    func update(filename: String, received: Int64, total: Int64, queued: Int, speed: String?) {
        nameLabel.text = queued > 0 ? "\(filename)  (+\(queued) more)" : filename
        let f = Self.formatter
        if total > 0 {
            let fraction = min(1.0, Double(received) / Double(total))
            progressView.setProgress(Float(fraction), animated: true)
            detailLabel.text = [
                "\(f.string(fromByteCount: received)) of \(f.string(fromByteCount: total))",
                speed
            ].compactMap { $0 }.joined(separator: " · ")
        } else {
            // No Content-Length — show what's arrived rather than a fake bar.
            progressView.setProgress(0, animated: false)
            detailLabel.text = [f.string(fromByteCount: received), speed]
                .compactMap { $0 }.joined(separator: " · ")
        }
    }
}

// ============================================================================
// The tray button, with a badge for how many finished downloads are waiting
// to be looked at. Counts down to nothing when the list is cleared, the same
// way Mail's unread badge does.
// ============================================================================

private final class ScrayInsetLabel: UILabel {
    var insets = UIEdgeInsets(top: 0, left: 5, bottom: 0, right: 5)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let base = super.intrinsicContentSize
        return CGSize(width: base.width + insets.left + insets.right,
                      height: base.height + insets.top + insets.bottom)
    }
}

final class ScrayTrayButton: UIButton {

    private let badge = ScrayInsetLabel()

    var badgeCount: Int = 0 {
        didSet {
            guard badgeCount != oldValue else { return }
            badge.isHidden = badgeCount <= 0
            badge.text = badgeCount > 99 ? "99+" : "\(badgeCount)"
            badge.invalidateIntrinsicContentSize()
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        setImage(UIImage(systemName: "tray.and.arrow.down"), for: .normal)

        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textColor = .white
        badge.backgroundColor = .systemRed
        badge.textAlignment = .center
        badge.layer.cornerRadius = 8
        badge.layer.masksToBounds = true
        badge.isHidden = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        addSubview(badge)

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 44),
            heightAnchor.constraint(equalToConstant: 40),
            badge.heightAnchor.constraint(equalToConstant: 16),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: 2),
            badge.topAnchor.constraint(equalTo: topAnchor, constant: -1)
        ])
    }
}

// ============================================================================
// A small tooltip that points down at the tray button. Replaces the modal
// "Saved" alert — a finished download is worth noticing, not worth a dialog
// that has to be dismissed before anything else can happen.
// ============================================================================

final class ScrayToastView: UIView {

    var onTap: (() -> Void)?

    private let bubble = UIView()
    private let caretView = UIView()
    private let label = UILabel()

    /// How far in from the trailing edge the caret points — lines up with the
    /// tray button, which is the last item in the toolbar.
    private static let caretInsetFromTrailing: CGFloat = 22
    private static let caretHeight: CGFloat = 7

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        alpha = 0
        isHidden = true
        clipsToBounds = false

        let fill = UIColor.secondarySystemBackground

        // A rotated square rather than a drawn path, so it picks up dark mode
        // on its own instead of needing a cgColor refresh on every trait change.
        caretView.backgroundColor = fill
        caretView.transform = CGAffineTransform(rotationAngle: .pi / 4)
        addSubview(caretView)

        bubble.backgroundColor = fill
        bubble.layer.cornerRadius = 10
        bubble.layer.shadowColor = UIColor.black.cgColor
        bubble.layer.shadowOpacity = 0.18
        bubble.layer.shadowRadius = 6
        bubble.layer.shadowOffset = CGSize(width: 0, height: 2)
        bubble.translatesAutoresizingMaskIntoConstraints = false
        addSubview(bubble)

        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .label
        label.numberOfLines = 2
        label.lineBreakMode = .byTruncatingMiddle
        label.translatesAutoresizingMaskIntoConstraints = false
        bubble.addSubview(label)

        NSLayoutConstraint.activate([
            bubble.topAnchor.constraint(equalTo: topAnchor),
            bubble.leadingAnchor.constraint(equalTo: leadingAnchor),
            bubble.trailingAnchor.constraint(equalTo: trailingAnchor),
            bubble.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.caretHeight),

            label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 8),
            label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -8),
            label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -12)
        ])

        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        caretView.bounds = CGRect(x: 0, y: 0, width: 10, height: 10)
        caretView.center = CGPoint(x: bounds.width - Self.caretInsetFromTrailing,
                                   y: bubble.frame.maxY)
    }

    @objc private func tapped() { onTap?() }

    func setText(_ text: String) { label.text = text }
}
