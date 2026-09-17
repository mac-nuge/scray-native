import UIKit

// ============================================================================
// "That file is already in your folder" (native 13.199).
//
// Downloads used to land beside an existing file of the same name as
// "name 2.mp4" — ScrayDownloadFolder.uniquified — which is quiet, and leaves
// the library scan showing both. This asks instead.
//
// Not a UIAlertController: the answer carries a tick ("do this for the rest of
// this run"), and an alert's actions can only be pressed, not toggled. So it's
// a small card of its own, with the same shape as the app's other modals.
// ============================================================================

enum ScrayClashChoice { case replace, keepBoth }

final class ScrayFileClashPrompt: UIViewController {

    /// nil choice = cancelled. `remember` is the tick; false means ask again
    /// for the next clash in this run.
    typealias Answer = (_ choice: ScrayClashChoice?, _ remember: Bool) -> Void

    private let filename: String
    private let existingBytes: Int64
    private let incomingBytes: Int64
    private let answer: Answer

    private var remember = false
    private let tickButton = UIButton(type: .system)

    private init(filename: String, existingBytes: Int64, incomingBytes: Int64, answer: @escaping Answer) {
        self.filename = filename
        self.existingBytes = existingBytes
        self.incomingBytes = incomingBytes
        self.answer = answer
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// Ask, on the main queue, presenting from `presenter`. The completion is
    /// always called exactly once.
    static func ask(filename: String,
                    existing: URL,
                    incoming: URL,
                    from presenter: UIViewController,
                    answer: @escaping Answer) {
        let size = { (url: URL) -> Int64 in
            let v = try? url.resourceValues(forKeys: [.fileSizeKey])
            return Int64(v?.fileSize ?? 0)
        }
        let vc = ScrayFileClashPrompt(filename: filename,
                                      existingBytes: size(existing),
                                      incomingBytes: size(incoming),
                                      answer: answer)
        presenter.present(vc, animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.45)

        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let title = UILabel()
        title.text = "Already in your folder"
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.textAlignment = .center

        let name = UILabel()
        name.text = filename
        name.font = .systemFont(ofSize: 14, weight: .medium)
        name.textAlignment = .center
        name.numberOfLines = 3
        name.lineBreakMode = .byTruncatingMiddle

        let f = ByteCountFormatter()
        f.countStyle = .file
        let detail = UILabel()
        detail.text = "There: \(f.string(fromByteCount: existingBytes))  ·  New: \(f.string(fromByteCount: incomingBytes))"
        detail.font = .systemFont(ofSize: 13)
        detail.textColor = .secondaryLabel
        detail.textAlignment = .center

        // The tick. A button rather than a UISwitch so the label is part of
        // the target — the whole row is one tap.
        tickButton.contentHorizontalAlignment = .center
        tickButton.titleLabel?.font = .systemFont(ofSize: 13)
        tickButton.addTarget(self, action: #selector(toggleRemember), for: .touchUpInside)
        paintTick()

        let replace = filled("Replace", color: .systemRed, action: #selector(replaceTapped))
        let keep    = filled("Keep both", color: .systemBlue, action: #selector(keepTapped))
        let cancel  = filled("Cancel", color: .systemGray, action: #selector(cancelTapped))

        let stack = UIStackView(arrangedSubviews: [title, name, detail, tickButton, replace, keep, cancel])
        stack.axis = .vertical
        stack.spacing = 10
        stack.setCustomSpacing(4, after: title)
        stack.setCustomSpacing(14, after: detail)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
        ])
    }

    private func filled(_ title: String, color: UIColor, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = color
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        b.layer.cornerRadius = 10
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func paintTick() {
        tickButton.setTitle((remember ? "☑︎" : "☐") + "  Do this for the rest of this run", for: .normal)
    }

    @objc private func toggleRemember() {
        remember.toggle()
        paintTick()
    }

    @objc private func replaceTapped() { finish(.replace) }
    @objc private func keepTapped()    { finish(.keepBoth) }
    @objc private func cancelTapped()  { finish(nil) }

    private func finish(_ choice: ScrayClashChoice?) {
        // Cancelling answers nothing for the rest of the run, whatever the
        // tick says - it would mean silently dropping the files that follow.
        let remember = (choice == nil) ? false : self.remember
        dismiss(animated: true) { self.answer(choice, remember) }
    }
}
