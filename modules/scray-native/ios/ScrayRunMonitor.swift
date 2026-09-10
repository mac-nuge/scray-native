import UIKit
import WebKit

// ============================================================================
// ScrayRunMonitor - keeps Picker's basket checkout going, and visible, while
// you aren't looking at it.
//
// basket-checkout.js paces its downloads from the page (Graph download URLs
// expire, so each one is refreshed right before its transfer starts) and
// reports in over the bridge with `runStatus` about once a second. From those
// heartbeats and the download list this does three things:
//
//   1. Keeps the screen on while a run is live or anything is downloading. A
//      locked phone suspends the app, and every transfer with it.
//
//   2. Floats a progress ring over Native while the browser is closed. Tapping
//      it opens the browser again, where it was left.
//
//   3. Parks the page that is running in the window when the browser closes.
//      A WKWebView that isn't in any window is a hidden page to WebKit, which
//      throttles its timers and lets its process be suspended - the run would
//      stall once the files already in flight had landed, with nothing to
//      start the next one. Parked behind the app's own view it is still a
//      visible page, just one nobody can see.
// ============================================================================

final class ScrayRunMonitor: NSObject {

    static let shared = ScrayRunMonitor()

    struct Progress {
        var done: Int
        var total: Int
        var bytesDone: Int64
        var bytesTotal: Int64
    }

    /// ⚙️ How long a run counts as live after its last heartbeat. The page
    /// beats about once a second; the slack covers a slow URL refresh between
    /// files without letting a page that has died keep the screen on for long.
    private static let heartbeatTimeout: CFTimeInterval = 30

    /// ⚙️ Where the ring sits over Native: this far below the top safe area,
    /// in from the right edge.
    private static let ringTopOffset: CGFloat = 56
    private static let ringTrailingInset: CGFloat = 12

    private var progress: Progress?
    private var lastBeat: CFTimeInterval = 0
    private weak var runWebView: WKWebView?

    private var ticker: Timer?
    private var holdingScreenAwake = false
    private var ring: ScrayRunRing?
    private var parkingSpot: UIView?

    private override init() { super.init() }

    var runIsLive: Bool {
        progress != nil && CACurrentMediaTime() - lastBeat < Self.heartbeatTimeout
    }

    // MARK: - Page -> monitor

    /// `runStatus` from the bridge. `active: false` is the page's last word on
    /// a run: done, stopped, or navigated away from.
    func heartbeat(active: Bool, progress newProgress: Progress, from webView: WKWebView?) {
        if active {
            progress = newProgress
            lastBeat = CACurrentMediaTime()
            if let webView = webView { runWebView = webView }
        } else {
            progress = nil
            lastBeat = 0
            runWebView = nil
            unpark()
        }
        update()
    }

    // MARK: - Browser -> monitor

    /// The browser has been dismissed.
    func browserDidHide() {
        if runIsLive, let webView = runWebView { park(webView) }
        update()
    }

    /// The browser is about to be shown; it takes its tabs back.
    func browserWillShow() {
        unpark()
        update()
    }

    // MARK: - State

    /// Cheap enough to call on every tick.
    func update() {
        let downloading = ScrayDownloadCenter.shared.activeCount > 0
        let busy = runIsLive || downloading

        setScreenAwake(busy)
        if busy { startTicker() } else { stopTicker() }
        refreshRing(visible: busy && !ScrayBrowser.shared.isShowing)
    }

    /// Only ever releases its own hold. Nothing else in the module sets the
    /// idle timer; if that changes, this needs to become a count.
    private func setScreenAwake(_ on: Bool) {
        guard on != holdingScreenAwake else { return }
        holdingScreenAwake = on
        UIApplication.shared.isIdleTimerDisabled = on
    }

    private func startTicker() {
        guard ticker == nil else { return }
        // Target/selector rather than a block: the block form is @Sendable in
        // newer SDKs, and this class is main-thread only, not Sendable. The
        // timer holds the singleton strongly, which is fine - it lives forever.
        let timer = Timer(timeInterval: 1.0, target: self, selector: #selector(tick),
                          userInfo: nil, repeats: true)
        // .common, so the ring keeps moving while a list is being scrolled.
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    @objc private func tick() { update() }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    /// The run's own figures while its heartbeat is fresh; otherwise whatever
    /// the download list says is moving.
    private func currentProgress() -> (fraction: Double?, caption: String?) {
        if runIsLive, let p = progress {
            let fraction: Double?
            if p.bytesTotal > 0 {
                fraction = Double(p.bytesDone) / Double(p.bytesTotal)
            } else if p.total > 0 {
                fraction = Double(p.done) / Double(p.total)
            } else {
                fraction = nil
            }
            return (fraction, p.total > 0 ? "\(p.done)/\(p.total)" : nil)
        }
        let live = ScrayDownloadCenter.shared.records.filter { $0.state == .active }
        let total = live.reduce(Int64(0)) { $0 + max(0, $1.total) }
        let received = live.reduce(Int64(0)) { $0 + $1.received }
        let fraction: Double? = total > 0 ? Double(received) / Double(total) : nil
        return (fraction, live.count > 1 ? "\(live.count) files" : nil)
    }

    // MARK: - Ring

    private func refreshRing(visible: Bool) {
        guard visible, let window = Self.keyWindow() else {
            ring?.isHidden = true
            return
        }

        let view: ScrayRunRing
        if let existing = ring {
            view = existing
        } else {
            view = ScrayRunRing(frame: .zero)
            view.onTap = { ScrayBrowser.shared.resume() }
            ring = view
        }

        if view.superview !== window {
            view.removeFromSuperview()
            view.translatesAutoresizingMaskIntoConstraints = false
            window.addSubview(view)
            NSLayoutConstraint.activate([
                view.topAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor,
                                          constant: Self.ringTopOffset),
                view.trailingAnchor.constraint(equalTo: window.safeAreaLayoutGuide.trailingAnchor,
                                               constant: -Self.ringTrailingInset)
            ])
        }
        window.bringSubviewToFront(view)
        view.isHidden = false

        let now = currentProgress()
        view.update(fraction: now.fraction, caption: now.caption)
    }

    // MARK: - Parking

    private func park(_ webView: WKWebView) {
        guard webView.window == nil, let window = Self.keyWindow() else { return }

        let spot = parkingSpot ?? UIView()
        spot.frame = window.bounds
        spot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        spot.isUserInteractionEnabled = false
        spot.accessibilityElementsHidden = true
        // Behind the app's own view: on screen as far as WebKit is concerned,
        // covered as far as you are.
        if spot.superview !== window { window.insertSubview(spot, at: 0) }
        parkingSpot = spot

        // Its constraints belong to the browser's container and leave with it;
        // selectTab puts fresh ones on when the browser takes it back.
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = true
        webView.frame = spot.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        spot.addSubview(webView)
    }

    private func unpark() {
        guard let spot = parkingSpot else { return }
        spot.subviews.forEach { $0.removeFromSuperview() }
        spot.removeFromSuperview()
        parkingSpot = nil
    }

    static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first(where: { $0.activationState == .foregroundActive })?
                   .windows.first(where: { $0.isKeyWindow })
               ?? scenes.first?.windows.first(where: { $0.isKeyWindow })
    }
}

// ============================================================================
// The ring itself: how far the run is, as a percentage, with done/total under
// it. Same #ff9800 and twelve-o'clock start as the browser's download pill,
// on a dark disc so it reads over any page Native is showing.
// ============================================================================

final class ScrayRunRing: UIView {

    var onTap: (() -> Void)?

    private let track = CAShapeLayer()
    private let arc = CAShapeLayer()
    private let percentLabel = UILabel()
    private let captionLabel = UILabel()

    /// ⚙️ Size of the ring.
    private static let diameter: CGFloat = 56
    private static let ringInset: CGFloat = 5
    private static let tint = UIColor(red: 1.0, green: 0.596, blue: 0.0, alpha: 1.0) // #ff9800

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        backgroundColor = UIColor.black.withAlphaComponent(0.75)
        layer.cornerRadius = Self.diameter / 2
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.25
        layer.shadowRadius = 5
        layer.shadowOffset = CGSize(width: 0, height: 1)

        track.fillColor = UIColor.clear.cgColor
        track.strokeColor = UIColor.white.withAlphaComponent(0.22).cgColor
        track.lineWidth = 4
        layer.addSublayer(track)

        arc.fillColor = UIColor.clear.cgColor
        arc.strokeColor = Self.tint.cgColor
        arc.lineWidth = 4
        arc.lineCap = .round
        arc.strokeEnd = 0
        layer.addSublayer(arc)

        percentLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .bold)
        percentLabel.textColor = .white
        percentLabel.textAlignment = .center

        captionLabel.font = .monospacedDigitSystemFont(ofSize: 8, weight: .semibold)
        captionLabel.textColor = UIColor.white.withAlphaComponent(0.8)
        captionLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [percentLabel, captionLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 0
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: Self.diameter),
            heightAnchor.constraint(equalToConstant: Self.diameter),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])

        isAccessibilityElement = true
        accessibilityLabel = "Downloads running"
        accessibilityHint = "Opens the browser"
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let centre = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = (bounds.width - Self.ringInset * 2 - arc.lineWidth) / 2
        guard radius > 0 else { return }

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

    func update(fraction: Double?, caption: String?) {
        if let fraction = fraction {
            stopSpin()
            let clamped = min(1.0, max(0.0, fraction))
            arc.strokeEnd = CGFloat(clamped)
            percentLabel.text = "\(Int((clamped * 100).rounded(.down)))%"
        } else {
            // Nothing to measure yet - a quarter arc going round is honest.
            arc.strokeEnd = 0.25
            startSpin()
            percentLabel.text = "…"
        }
        captionLabel.text = caption
        captionLabel.isHidden = caption == nil
    }

    /// Re-added on every update rather than tracked with a flag: Core Animation
    /// drops the animation when the app backgrounds.
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
