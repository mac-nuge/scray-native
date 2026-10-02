#if os(iOS) && canImport(MobileVLCKit)
import UIKit
import AVFoundation
import MobileVLCKit

// ============================================================================
// ScrayVLCPlayer - plays what the web player can't (native 15.77).
//
// The <video> element in the web view only has AVFoundation behind it, which
// means MP4 / M4V / MOV and nothing else. .wmv, .avi, .flv, .mkv, .mpg,
// .mpeg, .rm, .asf never got past player.js's "can't play on iOS" message.
//
// player.js now hands those to this full-screen VLCKit player instead (bridge
// action vlcPlay). It deliberately stays small - it is NOT the web player:
// no FLS pause menu, bookmarks, markers or dock. What it does have:
//
//   * tap                show / hide the controls (native 15.91: VLC's own
//                        tap recogniser used to swallow it)
//   * double tap         left third -10s, right third +10s, middle play/pause
//   * drag sideways      scrub (the full width = 3 min, or the whole video
//                        if shorter) - the picture, slider and time follow
//                        the finger live (native 15.88), exact seek on release
//   * drag down          close
//   * pinch              zoom (1-5x), move it with the pinch, back to 1x
//                        snaps it straight
//   * ⟳ button           turn the picture sideways (the app is portrait-
//                        locked, so this is the FLS-style 90° clockwise turn).
//                        Always opens portrait (native 15.88) - it used to
//                        turn itself for a wide video.
//   * ⏭ button           close and play the next video in the list
//   * slider             seek
//
// The bridge call resolves when the player closes, with
// { position, duration, watched, ended, next } - player.js turns `watched`
// into a view and time watched, the same thresholds the web player uses.
// ============================================================================

final class ScrayVLCPlayer {
    static let shared = ScrayVLCPlayer()

    private weak var current: ScrayVLCPlayerController?

    func present(url: URL, title: String, startSeconds: Double,
                 onClose: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            let show = {
                guard let top = ScrayBrowser.topViewController() else {
                    onClose(["error": "Nothing on screen to show the player from"])
                    return
                }
                let vc = ScrayVLCPlayerController(url: url, title: title,
                                                  startSeconds: startSeconds, onClose: onClose)
                vc.modalPresentationStyle = .fullScreen
                self.current = vc
                top.present(vc, animated: true)
            }
            // One at a time: a second play closes the first, then opens.
            if let open = self.current, open.presentingViewController != nil {
                open.finish(next: false, completion: show)
            } else {
                show()
            }
        }
    }
}

/// A label with room around the text, for the centre hint.
private final class ScrayPaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: insets)) }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + insets.left + insets.right,
                      height: s.height + insets.top + insets.bottom)
    }
}

final class ScrayVLCPlayerController: UIViewController, VLCMediaPlayerDelegate, UIGestureRecognizerDelegate {

    // ⚙️ Tuning
    private static let scrubSpanSeconds: Double = 180   // full-width drag
    private static let skipSeconds: Double = 10         // double tap
    private static let hideAfter: TimeInterval = 3      // controls auto-hide
    private static let maxZoom: CGFloat = 5
    // Same meaning as player.js's SCRAY_WATCH_MAX_STEP_S: a bigger jump
    // between two time ticks is a seek, not watching.
    private static let watchMaxStep: Double = 2
    // ⚙️ Live scrub (native 15.88): at most one seek this often while a finger
    // drags. The slider and time follow the finger every frame regardless;
    // this only paces how often VLC is asked for a new picture. Lower = more
    // pictures on a fast source, but on a slow stream each seek piles onto
    // the one before.
    private static let liveSeekInterval: TimeInterval = 0.2

    private let url: URL
    private let titleText: String
    private let startSeconds: Double
    private var onClose: (([String: Any]) -> Void)?

    private let player = VLCMediaPlayer()

    // stage holds everything and is what turns sideways; videoView is VLC's
    // drawable and is what zooms.
    private let stage = UIView()
    private let videoView = UIView()
    private let overlay = UIView()
    private let topBar = UIView()
    private let bottomBar = UIView()
    private let closeButton = UIButton(type: .system)
    private let nextButton = UIButton(type: .system)
    private let rotateButton = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let slider = UISlider()
    private let timeLabel = UILabel()
    private let durationLabel = UILabel()
    private let hintLabel = ScrayPaddedLabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()

    private var guideTop: NSLayoutConstraint!
    private var guideBottom: NSLayoutConstraint!
    private var guideLeading: NSLayoutConstraint!
    private var guideTrailing: NSLayoutConstraint!

    // The hint sits in the centre for double-tap feedback (±10s, ▶︎ / ❚❚) and
    // in the top right corner, under the top bar, for the scrub / slider
    // timestamp (native 15.91) so it doesn't cover the picture.
    private var hintCentre: [NSLayoutConstraint] = []
    private var hintCorner: [NSLayoutConstraint] = []

    private var landscape = false               // only ever turned by ⟳
    private var controlsVisible = true
    private var hideTimer: Timer?
    private var hintTimer: Timer?
    private var sliderDragging = false
    private var didStart = false

    private enum PanMode { case idle, scrub, dismiss }
    private var panMode: PanMode = .idle
    private var scrubFrom: Double = 0
    private var scrubTarget: Double?

    // Live scrub pacing - see liveSeekInterval.
    private var pendingLiveSeek: Double?
    private var lastLiveSeekAt: CFTimeInterval = 0
    private var liveSeekTimer: Timer?

    private var zoom: CGFloat = 1
    private var zoomOffset: CGPoint = .zero
    private var pinchStartZoom: CGFloat = 1
    private var pinchStartOffset: CGPoint = .zero
    private var pinchStartPoint: CGPoint = .zero

    private var durationSec: Double = 0
    private var lastTimeSec: Double?
    private var watchedSec: Double = 0
    private var ended = false
    private var wasIdleTimerDisabled = false

    init(url: URL, title: String, startSeconds: Double,
         onClose: @escaping ([String: Any]) -> Void) {
        self.url = url
        self.titleText = title
        self.startSeconds = startSeconds
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    // MARK: - Setup

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        stage.backgroundColor = .black
        stage.clipsToBounds = true
        view.addSubview(stage)

        videoView.backgroundColor = .black
        videoView.isUserInteractionEnabled = false
        stage.addSubview(videoView)

        overlay.backgroundColor = .clear
        stage.addSubview(overlay)
        buildControls()
        buildGestures()

        let media = VLCMedia(url: url)
        media.addOption(":network-caching=1500")
        if startSeconds > 1 {
            media.addOption(":start-time=\(startSeconds)")
        }
        player.media = media
        player.delegate = self
        player.drawable = videoView

        NotificationCenter.default.addObserver(self, selector: #selector(appWillResignActive),
                                               name: UIApplication.willResignActiveNotification,
                                               object: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didStart else { return }
        didStart = true
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        wasIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        spinner.startAnimating()
        player.play()
    }

    private func symbolButton(_ b: UIButton, _ name: String, size: CGFloat = 20) {
        let cfg = UIImage.SymbolConfiguration(pointSize: size, weight: .semibold)
        b.setImage(UIImage(systemName: name, withConfiguration: cfg), for: .normal)
        b.tintColor = .white
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 44).isActive = true
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func buildControls() {
        // A guide inset from the stage's edges by the safe area - which edge
        // is which depends on whether the stage is turned (layoutStage).
        let guide = UILayoutGuide()
        overlay.addLayoutGuide(guide)
        guideTop = guide.topAnchor.constraint(equalTo: overlay.topAnchor)
        guideBottom = overlay.bottomAnchor.constraint(equalTo: guide.bottomAnchor)
        guideLeading = guide.leadingAnchor.constraint(equalTo: overlay.leadingAnchor)
        guideTrailing = overlay.trailingAnchor.constraint(equalTo: guide.trailingAnchor)
        NSLayoutConstraint.activate([guideTop, guideBottom, guideLeading, guideTrailing])

        let barColour = UIColor.black.withAlphaComponent(0.45)

        // ---- Top bar: close · title · next · turn
        topBar.backgroundColor = barColour
        topBar.layer.cornerRadius = 12
        topBar.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(topBar)

        symbolButton(closeButton, "xmark")
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        symbolButton(nextButton, "forward.end.fill")
        nextButton.addTarget(self, action: #selector(nextTapped), for: .touchUpInside)
        symbolButton(rotateButton, "rotate.right")
        rotateButton.addTarget(self, action: #selector(rotateTapped), for: .touchUpInside)

        titleLabel.text = titleText
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        titleLabel.lineBreakMode = .byTruncatingMiddle
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let topStack = UIStackView(arrangedSubviews: [closeButton, titleLabel, nextButton, rotateButton])
        topStack.axis = .horizontal
        topStack.alignment = .center
        topStack.spacing = 4
        topStack.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(topStack)

        // ---- Bottom bar: play · time · slider · duration
        bottomBar.backgroundColor = barColour
        bottomBar.layer.cornerRadius = 12
        bottomBar.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(bottomBar)

        symbolButton(playButton, "pause.fill", size: 22)
        playButton.addTarget(self, action: #selector(playTapped), for: .touchUpInside)

        for l in [timeLabel, durationLabel] {
            l.textColor = .white
            l.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            l.text = "0:00"
            l.setContentHuggingPriority(.required, for: .horizontal)
            l.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        slider.minimumTrackTintColor = UIColor(red: 0.2, green: 0.8, blue: 0.8, alpha: 1)
        slider.addTarget(self, action: #selector(sliderDown), for: .touchDown)
        slider.addTarget(self, action: #selector(sliderMoved), for: .valueChanged)
        slider.addTarget(self, action: #selector(sliderUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])

        let bottomStack = UIStackView(arrangedSubviews: [playButton, timeLabel, slider, durationLabel])
        bottomStack.axis = .horizontal
        bottomStack.alignment = .center
        bottomStack.spacing = 8
        bottomStack.translatesAutoresizingMaskIntoConstraints = false
        bottomBar.addSubview(bottomStack)

        // ---- Centre: spinner, hint, error
        spinner.color = .white
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        stage.addSubview(spinner)

        hintLabel.textColor = .white
        hintLabel.font = .monospacedDigitSystemFont(ofSize: 17, weight: .semibold)
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 2
        hintLabel.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        hintLabel.layer.cornerRadius = 10
        hintLabel.clipsToBounds = true
        hintLabel.alpha = 0
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        stage.addSubview(hintLabel)

        errorLabel.textColor = .white
        errorLabel.font = .systemFont(ofSize: 15, weight: .medium)
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0
        errorLabel.isHidden = true
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        stage.addSubview(errorLabel)

        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
            topBar.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 8),
            topBar.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -8),
            topStack.topAnchor.constraint(equalTo: topBar.topAnchor, constant: 2),
            topStack.bottomAnchor.constraint(equalTo: topBar.bottomAnchor, constant: -2),
            topStack.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: 4),
            topStack.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -4),

            bottomBar.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
            bottomBar.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 8),
            bottomBar.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -8),
            bottomStack.topAnchor.constraint(equalTo: bottomBar.topAnchor, constant: 2),
            bottomStack.bottomAnchor.constraint(equalTo: bottomBar.bottomAnchor, constant: -2),
            bottomStack.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor, constant: 4),
            bottomStack.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor, constant: -12),

            spinner.centerXAnchor.constraint(equalTo: stage.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: stage.centerYAnchor),
            errorLabel.centerXAnchor.constraint(equalTo: stage.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: stage.centerYAnchor),
            errorLabel.widthAnchor.constraint(lessThanOrEqualTo: stage.widthAnchor, constant: -48),
        ])

        hintCentre = [
            hintLabel.centerXAnchor.constraint(equalTo: stage.centerXAnchor),
            hintLabel.centerYAnchor.constraint(equalTo: stage.centerYAnchor),
        ]
        hintCorner = [
            hintLabel.topAnchor.constraint(equalTo: topBar.bottomAnchor, constant: 8),
            hintLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -8),
        ]
        NSLayoutConstraint.activate(hintCentre)
    }

    private func buildGestures() {
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.delegate = self
        stage.addGestureRecognizer(doubleTap)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.require(toFail: doubleTap)
        tap.delegate = self
        stage.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        stage.addGestureRecognizer(pan)

        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        stage.addGestureRecognizer(pinch)
    }

    // VLCKit's iOS video output adds its own single-tap recogniser to the
    // drawable's superview - the stage. It wins every single tap before ours
    // (ours waits for the double tap to fail), so a tap never showed the
    // controls; only a drag did (native 15.91). Ours now run alongside any
    // recogniser that isn't ours; ours still exclude each other as before.
    func gestureRecognizer(_ g: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        return other.delegate !== self
    }

    // Buttons and the slider keep their own touches.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var v = touch.view
        while let cur = v, cur !== stage {
            if cur is UIControl || cur === topBar || cur === bottomBar { return false }
            v = cur.superview
        }
        return true
    }

    // MARK: - Layout (portrait or turned sideways)

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutStage()
    }

    private func layoutStage() {
        let b = view.bounds
        let size = landscape ? CGSize(width: b.height, height: b.width) : b.size
        stage.transform = .identity
        stage.bounds = CGRect(origin: .zero, size: size)
        stage.center = CGPoint(x: b.midX, y: b.midY)
        // 90° clockwise, the same way round as the web player's FLS.
        stage.transform = landscape ? CGAffineTransform(rotationAngle: .pi / 2) : .identity

        videoView.bounds = CGRect(origin: .zero, size: size)
        videoView.center = CGPoint(x: size.width / 2, y: size.height / 2)
        overlay.frame = CGRect(origin: .zero, size: size)

        // Turned clockwise, the stage's leading edge sits at the top of the
        // phone (the Dynamic Island) and its trailing edge at the bottom (the
        // home indicator).
        let s = view.safeAreaInsets
        if landscape {
            guideTop.constant = 4
            guideBottom.constant = 4
            guideLeading.constant = s.top
            guideTrailing.constant = s.bottom
        } else {
            guideTop.constant = s.top
            guideBottom.constant = s.bottom
            guideLeading.constant = s.left
            guideTrailing.constant = s.right
        }
        applyZoom()
    }

    private func setLandscape(_ on: Bool, animated: Bool) {
        guard on != landscape else { return }
        landscape = on
        zoom = 1
        zoomOffset = .zero
        if animated {
            UIView.animate(withDuration: 0.3) {
                self.layoutStage()
                self.overlay.layoutIfNeeded()
            }
        } else {
            view.setNeedsLayout()
        }
    }

    // MARK: - Controls

    private func showControls(autoHide: Bool = true) {
        hideTimer?.invalidate()
        if !controlsVisible {
            controlsVisible = true
            UIView.animate(withDuration: 0.2) { self.overlay.alpha = 1 }
        }
        if autoHide && player.isPlaying && !sliderDragging {
            hideTimer = Timer.scheduledTimer(withTimeInterval: Self.hideAfter, repeats: false) { [weak self] _ in
                self?.hideControls()
            }
        }
    }

    private func hideControls() {
        hideTimer?.invalidate()
        guard controlsVisible, player.isPlaying, errorLabel.isHidden else { return }
        controlsVisible = false
        UIView.animate(withDuration: 0.25) { self.overlay.alpha = 0 }
    }

    private func flashHint(_ text: String, stay: Bool = false, corner: Bool = false) {
        hintTimer?.invalidate()
        NSLayoutConstraint.deactivate(corner ? hintCentre : hintCorner)
        NSLayoutConstraint.activate(corner ? hintCorner : hintCentre)
        hintLabel.textAlignment = corner ? .right : .center
        hintLabel.text = text
        hintLabel.alpha = 1
        guard !stay else { return }
        hintTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: false) { [weak self] _ in
            UIView.animate(withDuration: 0.25) { self?.hintLabel.alpha = 0 }
        }
    }

    private func setPlayIcon() {
        let name = ended ? "arrow.counterclockwise" : (player.isPlaying ? "pause.fill" : "play.fill")
        let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        playButton.setImage(UIImage(systemName: name, withConfiguration: cfg), for: .normal)
    }

    private var currentSec: Double {
        // Optional on purpose: VLCKit's headers have changed their
        // nullability between releases, and this compiles either way.
        let t: VLCTime? = player.time
        guard let t else { return 0 }
        return Double(t.intValue) / 1000
    }

    private func seek(to seconds: Double) {
        var target = max(0, seconds)
        if durationSec > 0 { target = min(target, max(0, durationSec - 0.5)) }
        if ended {
            // After the end VLC needs a fresh start before it will seek.
            ended = false
            player.stop()
            player.play()
        }
        player.time = VLCTime(int: Int32(target * 1000))
        lastTimeSec = nil
        updateTimeUI(at: target)
    }

    // MARK: - Live scrub (native 15.88)
    // A drag used to move only the slider and time and seek once on release,
    // so the picture sat still until you let go. Now the picture follows too:
    // the latest finger position is sent to VLC at most every
    // liveSeekInterval, and release still does one exact seek.

    private func liveSeek(_ seconds: Double) {
        pendingLiveSeek = seconds
        let wait = Self.liveSeekInterval - (CACurrentMediaTime() - lastLiveSeekAt)
        if wait <= 0 {
            fireLiveSeek()
        } else if liveSeekTimer == nil {
            liveSeekTimer = Timer.scheduledTimer(withTimeInterval: wait, repeats: false) { [weak self] _ in
                self?.liveSeekTimer = nil
                self?.fireLiveSeek()
            }
        }
    }

    private func fireLiveSeek() {
        guard let t = pendingLiveSeek else { return }
        pendingLiveSeek = nil
        lastLiveSeekAt = CACurrentMediaTime()
        if ended {
            // seek(to:) knows how to restart a finished video.
            seek(to: t)
            return
        }
        var target = max(0, t)
        if durationSec > 0 { target = min(target, max(0, durationSec - 0.5)) }
        player.time = VLCTime(int: Int32(target * 1000))
        lastTimeSec = nil
    }

    private func cancelLiveSeek() {
        liveSeekTimer?.invalidate()
        liveSeekTimer = nil
        pendingLiveSeek = nil
    }

    private func togglePlay() {
        if ended {
            ended = false
            player.stop()
            player.play()
        } else if player.isPlaying {
            player.pause()
        } else {
            player.play()
        }
        setPlayIcon()
    }

    private func updateTimeUI(at seconds: Double) {
        timeLabel.text = Self.fmt(seconds)
        if durationSec > 0 {
            durationLabel.text = Self.fmt(durationSec)
            if !sliderDragging { slider.value = Float(seconds / durationSec) }
        }
    }

    static func fmt(_ s: Double) -> String {
        guard s.isFinite, s >= 0 else { return "0:00" }
        let t = Int(s)
        let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    @objc private func closeTapped() { finish(next: false) }
    @objc private func nextTapped() { finish(next: true) }

    @objc private func rotateTapped() {
        setLandscape(!landscape, animated: true)
        showControls()
    }

    @objc private func playTapped() {
        togglePlay()
        showControls()
    }

    @objc private func sliderDown() {
        sliderDragging = true
        showControls(autoHide: false)
    }

    @objc private func sliderMoved() {
        guard durationSec > 0 else { return }
        let target = Double(slider.value) * durationSec
        timeLabel.text = Self.fmt(target)
        flashHint("\(Self.fmt(target)) / \(Self.fmt(durationSec))", stay: true, corner: true)
        liveSeek(target)
    }

    @objc private func sliderUp() {
        sliderDragging = false
        cancelLiveSeek()
        if durationSec > 0 { seek(to: Double(slider.value) * durationSec) }
        // Fade the drag's hint out - a plain tap on the slider never showed one.
        if hintLabel.alpha > 0 { flashHint(hintLabel.text ?? "", corner: true) }
        showControls()
    }

    @objc private func appWillResignActive() {
        if player.isPlaying { player.pause() }
        setPlayIcon()
        showControls(autoHide: false)
    }

    // MARK: - Gestures

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        if controlsVisible { hideControls() } else { showControls() }
    }

    @objc private func handleDoubleTap(_ g: UITapGestureRecognizer) {
        let x = g.location(in: stage).x
        let w = stage.bounds.width
        if x < w / 3 {
            seek(to: currentSec - Self.skipSeconds)
            flashHint("−\(Int(Self.skipSeconds))s")
        } else if x > w * 2 / 3 {
            seek(to: currentSec + Self.skipSeconds)
            flashHint("+\(Int(Self.skipSeconds))s")
        } else {
            // isPlaying only changes once VLC gets there, so go by the ask.
            let willPlay = ended || !player.isPlaying
            togglePlay()
            flashHint(willPlay ? "▶︎" : "❚❚")
        }
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        let t = g.translation(in: stage)
        switch g.state {
        case .began:
            let v = g.velocity(in: stage)
            if abs(v.x) > abs(v.y) {
                panMode = .scrub
                scrubFrom = currentSec
                scrubTarget = scrubFrom
                showControls(autoHide: false)
            } else if v.y > 0 {
                panMode = .dismiss
            } else {
                panMode = .idle
            }
        case .changed:
            switch panMode {
            case .scrub:
                let span = durationSec > 0 ? min(durationSec, Self.scrubSpanSeconds) : Self.scrubSpanSeconds
                var target = scrubFrom + Double(t.x / max(stage.bounds.width, 1)) * span
                target = max(0, durationSec > 0 ? min(target, durationSec) : target)
                scrubTarget = target
                let delta = target - scrubFrom
                let sign = delta < 0 ? "−" : "+"
                flashHint("\(Self.fmt(target)) / \(Self.fmt(durationSec))\n\(sign)\(Self.fmt(abs(delta)))", stay: true, corner: true)
                timeLabel.text = Self.fmt(target)
                if durationSec > 0 { slider.value = Float(target / durationSec) }
                liveSeek(target)
            case .dismiss:
                let pull = max(0, t.y)
                stage.alpha = 1 - min(pull / 500, 0.5)
            case .idle:
                break
            }
        case .ended, .cancelled, .failed:
            switch panMode {
            case .scrub:
                cancelLiveSeek()
                // Released: one exact seek where the finger left off.
                // Cancelled: back to where the drag started, since the live
                // seeks have already moved the picture away from it.
                if g.state == .ended, let target = scrubTarget { seek(to: target) }
                else { seek(to: scrubFrom) }
                scrubTarget = nil
                flashHint(hintLabel.text ?? "", corner: true)
                showControls()
            case .dismiss:
                let v = g.velocity(in: stage)
                if g.state == .ended && (t.y > 120 || v.y > 900) {
                    finish(next: false)
                } else {
                    UIView.animate(withDuration: 0.2) { self.stage.alpha = 1 }
                }
            case .idle:
                break
            }
            panMode = .idle
        default:
            break
        }
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began:
            pinchStartZoom = zoom
            pinchStartOffset = zoomOffset
            pinchStartPoint = g.location(in: stage)
        case .changed:
            zoom = min(Self.maxZoom, max(1, pinchStartZoom * g.scale))
            let p = g.location(in: stage)
            zoomOffset = CGPoint(x: pinchStartOffset.x + (p.x - pinchStartPoint.x),
                                 y: pinchStartOffset.y + (p.y - pinchStartPoint.y))
            applyZoom()
        case .ended, .cancelled:
            if zoom < 1.05 {
                zoom = 1
                zoomOffset = .zero
                UIView.animate(withDuration: 0.2) { self.applyZoom() }
            }
        default:
            break
        }
    }

    /// Keep the zoomed picture covering the stage - it can't be dragged off.
    private func applyZoom() {
        let size = stage.bounds.size
        let maxX = (zoom - 1) * size.width / 2
        let maxY = (zoom - 1) * size.height / 2
        zoomOffset.x = min(maxX, max(-maxX, zoomOffset.x))
        zoomOffset.y = min(maxY, max(-maxY, zoomOffset.y))
        videoView.transform = CGAffineTransform(translationX: zoomOffset.x, y: zoomOffset.y)
            .scaledBy(x: zoom, y: zoom)
    }

    // MARK: - VLCMediaPlayerDelegate
    // Explicit selectors: VLCKit 3 calls these by name, so they fire whatever
    // Swift makes of the header's nullability.

    @objc(mediaPlayerStateChanged:)
    func mediaPlayerStateChanged(_ aNotification: Notification) {
        if Thread.isMainThread { stateChanged() } else { DispatchQueue.main.async { self.stateChanged() } }
    }

    @objc(mediaPlayerTimeChanged:)
    func mediaPlayerTimeChanged(_ aNotification: Notification) {
        if Thread.isMainThread { timeChanged() } else { DispatchQueue.main.async { self.timeChanged() } }
    }

    private func stateChanged() {
        switch player.state {
        case .opening:
            spinner.startAnimating()
        case .buffering:
            if player.isPlaying { spinner.stopAnimating() } else { spinner.startAnimating() }
        case .playing:
            spinner.stopAnimating()
            showControls()
        case .paused:
            spinner.stopAnimating()
            showControls(autoHide: false)
        case .ended:
            spinner.stopAnimating()
            ended = true
            showControls(autoHide: false)
        case .error:
            spinner.stopAnimating()
            errorLabel.text = "VLC couldn't play this file.\n\n\(url.lastPathComponent)"
            errorLabel.isHidden = false
            showControls(autoHide: false)
        default:
            break
        }
        setPlayIcon()
    }

    private func timeChanged() {
        spinner.stopAnimating()
        let media: VLCMedia? = player.media
        if let len = media?.length, len.intValue > 0 {
            durationSec = Double(len.intValue) / 1000
        }
        let now = currentSec

        // Seconds actually watched, the way player.js's WATCH TRACKING counts
        // them: seeks and rewinds add nothing.
        if let last = lastTimeSec {
            let step = now - last
            if step > 0 && step <= Self.watchMaxStep { watchedSec += step }
        }
        lastTimeSec = now

        // Mid-drag the slider and time belong to the finger - VLC's ticks
        // from the live seeks would otherwise pull them back and forth.
        if scrubTarget == nil && !sliderDragging { updateTimeUI(at: now) }

        // No auto-turn for a wide picture any more (native 15.88): it always
        // opens portrait, and ⟳ turns it.
    }

    // MARK: - Closing

    func finish(next: Bool, completion: (() -> Void)? = nil) {
        guard let cb = onClose else { completion?(); return }
        onClose = nil
        hideTimer?.invalidate()
        hintTimer?.invalidate()
        cancelLiveSeek()
        NotificationCenter.default.removeObserver(self)
        let result: [String: Any] = [
            "position": currentSec,
            "duration": durationSec,
            "watched": watchedSec,
            "ended": ended,
            "next": next
        ]
        player.delegate = nil
        player.stop()
        UIApplication.shared.isIdleTimerDisabled = wasIdleTimerDisabled
        dismiss(animated: true) {
            cb(result)
            completion?()
        }
    }
}
#endif
