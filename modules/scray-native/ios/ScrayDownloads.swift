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

    func update(filename: String, received: Int64, total: Int64, queued: Int) {
        nameLabel.text = queued > 0 ? "\(filename)  (+\(queued) more)" : filename
        let f = Self.formatter
        if total > 0 {
            let fraction = min(1.0, Double(received) / Double(total))
            progressView.setProgress(Float(fraction), animated: true)
            detailLabel.text = "\(f.string(fromByteCount: received)) of \(f.string(fromByteCount: total))"
        } else {
            // No Content-Length — show what's arrived rather than a fake bar.
            progressView.setProgress(0, animated: false)
            detailLabel.text = f.string(fromByteCount: received)
        }
    }
}