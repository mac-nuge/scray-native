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

    /// Kept for callers that want a hard stop; the bar itself no longer
    /// calls it.
    var onCancel: (() -> Void)?
    /// The corner button folds the bar down to a pill instead of killing the
    /// transfer. Cancelling lives in the downloads list, where it can't be
    /// hit while reaching for whatever the bar is covering.
    var onMinimise: (() -> Void)?

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

        let minimiseButton = UIButton(type: .system)
        minimiseButton.setImage(UIImage(systemName: "chevron.down.circle.fill"), for: .normal)
        minimiseButton.tintColor = .tertiaryLabel
        minimiseButton.accessibilityLabel = "Minimise download"
        minimiseButton.addTarget(self, action: #selector(minimiseTapped), for: .touchUpInside)
        minimiseButton.widthAnchor.constraint(equalToConstant: 30).isActive = true

        progressView.progressTintColor = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800

        let text = UIStackView(arrangedSubviews: [nameLabel, detailLabel])
        text.axis = .vertical
        text.spacing = 1

        let row = UIStackView(arrangedSubviews: [text, minimiseButton])
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

    @objc private func minimiseTapped() { onMinimise?() }

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
// The minimised form of the bar: a small clock-face ring that keeps ticking
// while the transfer runs, so whatever the bar was covering is reachable
// without stopping anything. Tapping it puts the bar back.
// ============================================================================

final class ScrayDownloadPill: UIView {

    var onTap: (() -> Void)?

    private let track = CAShapeLayer()
    private let arc = CAShapeLayer()
    private let arrowView = UIImageView()
    private let countLabel = UILabel()

    private static let diameter: CGFloat = 34
    private static let ringInset: CGFloat = 4
    private static let tint = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        isHidden = true
        translatesAutoresizingMaskIntoConstraints = false
        backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.95)
        layer.cornerRadius = Self.diameter / 2
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 4
        layer.shadowOffset = CGSize(width: 0, height: 1)

        track.fillColor = UIColor.clear.cgColor
        track.strokeColor = UIColor.tertiaryLabel.cgColor
        track.lineWidth = 3
        layer.addSublayer(track)

        arc.fillColor = UIColor.clear.cgColor
        arc.strokeColor = Self.tint.cgColor
        arc.lineWidth = 3
        arc.lineCap = .round
        arc.strokeEnd = 0
        layer.addSublayer(arc)

        arrowView.image = UIImage(systemName: "arrow.down",
                                  withConfiguration: UIImage.SymbolConfiguration(pointSize: 11,
                                                                                 weight: .bold))
        arrowView.tintColor = Self.tint
        arrowView.contentMode = .center
        arrowView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(arrowView)

        countLabel.font = .systemFont(ofSize: 11, weight: .bold)
        countLabel.textColor = Self.tint
        countLabel.textAlignment = .center
        countLabel.isHidden = true
        countLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(countLabel)

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: Self.diameter),
            heightAnchor.constraint(equalToConstant: Self.diameter),

            arrowView.centerXAnchor.constraint(equalTo: centerXAnchor),
            arrowView.centerYAnchor.constraint(equalTo: centerYAnchor),
            countLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            countLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])

        isAccessibilityElement = true
        accessibilityLabel = "Download in progress"
        accessibilityHint = "Shows the download bar again"
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let centre = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = (bounds.width - Self.ringInset * 2 - arc.lineWidth) / 2
        guard radius > 0 else { return }

        // Twelve o'clock, filling clockwise - reads as a clock hand rather
        // than an arbitrary arc.
        let path = UIBezierPath(arcCenter: centre,
                                radius: radius,
                                startAngle: -.pi / 2,
                                endAngle: .pi * 1.5,
                                clockwise: true).cgPath

        // bounds/position rather than frame: the arc carries a rotation
        // transform while spinning, and setting frame through a transform is
        // undefined.
        track.bounds = bounds
        track.position = centre
        track.path = path
        arc.bounds = bounds
        arc.position = centre
        arc.path = path
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        track.strokeColor = UIColor.tertiaryLabel.resolvedColor(with: traitCollection).cgColor
    }

    func update(received: Int64, total: Int64, queued: Int, paused: Bool) {
        arc.strokeColor = paused ? UIColor.systemGray.cgColor : Self.tint.cgColor

        if total > 0 {
            stopSpin()
            let fraction = min(1.0, max(0.0, Double(received) / Double(total)))
            arc.strokeEnd = CGFloat(fraction)
        } else {
            // No Content-Length. A quarter arc going round is honest about not
            // knowing; a filling ring would be a guess.
            arc.strokeEnd = 0.25
            if paused { stopSpin() } else { startSpin() }
        }

        let showCount = queued > 0
        countLabel.text = showCount ? "\(queued + 1)" : nil
        countLabel.isHidden = !showCount
        arrowView.isHidden = showCount
    }

    /// Re-added on every update rather than tracked with a flag: Core Animation
    /// drops the animation when the app backgrounds, and the next progress tick
    /// is what puts it back.
    private func startSpin() {
        guard arc.animation(forKey: "spin") == nil else { return }
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = 0
        spin.toValue = CGFloat.pi * 2
        spin.duration = 1.1
        spin.repeatCount = .infinity
        spin.isRemovedOnCompletion = false
        arc.add(spin, forKey: "spin")
    }

    private func stopSpin() {
        arc.removeAnimation(forKey: "spin")
    }

    @objc private func tapped() { onTap?() }
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
