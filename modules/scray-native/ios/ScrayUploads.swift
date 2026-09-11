import Foundation
import UIKit

// ============================================================================
// ScrayUploads - phone files going up to OneDrive (native 13.47).
//
// The page asks api.php for a Graph upload session (upload_session) and hands
// the URL over with `uploadStart`. That URL is pre-authenticated for one new
// file, so nothing here ever holds a token. From there this does the part a
// web view can't do well: read the file out of the security-scoped folder in
// pieces and PUT each one with its Content-Range.
//
// Graph's rules, all of which are load-bearing:
//   - every piece except the last must be a multiple of 320 KiB;
//   - pieces go in order, and a 202 names the next byte it expects;
//   - NO Authorization header on the upload URL - it is already signed, and a
//     bearer token sent there is rejected (and would be handed to a host that
//     has no business holding one);
//   - a dropped connection loses only the piece in flight: a GET on the upload
//     URL says where to carry on from (nextExpectedRanges);
//   - the final piece answers 200/201 with the new driveItem, which the page
//     passes to upload_done to catalogue.
//
// Screen: ScrayRunMonitor owns the idle timer and holds the screen on while
// anything is uploading (see its update()), because a locked phone suspends
// the app. A short background grace period covers switching away briefly;
// anything cut off then resumes from nextExpectedRanges when the app is back.
// ============================================================================

final class ScrayUploadJob {
    enum State: String { case uploading, finished, failed, cancelled }

    let id: String
    let relativePath: String
    let uploadURL: URL
    let total: Int64

    /// Bytes OneDrive has acknowledged.
    var confirmed: Int64 = 0
    /// Bytes of the piece in flight that have left the phone.
    var inFlight: Int64 = 0
    var pieceLength: Int64 = 0

    var state: State = .uploading
    var error: String?
    var item: [String: Any]?
    var attempts = 0
    var note: String?

    var handle: FileHandle?
    var task: URLSessionTask?
    var response = Data()

    // Transfer rate, sampled the same way ScrayDownloadRecord does: "how fast
    // is it going now", smoothed so the number is readable.
    private(set) var bytesPerSecond: Double = 0
    private var sampleBytes: Int64 = 0
    private var sampleAt: CFAbsoluteTime = 0

    init(id: String, relativePath: String, uploadURL: URL, total: Int64) {
        self.id = id
        self.relativePath = relativePath
        self.uploadURL = uploadURL
        self.total = total
    }

    var progressBytes: Int64 { min(total, confirmed + inFlight) }

    func sample() {
        let now = CFAbsoluteTimeGetCurrent()
        let bytes = progressBytes
        if sampleAt == 0 { sampleAt = now; sampleBytes = bytes; return }
        let elapsed = now - sampleAt
        guard elapsed >= 0.5 else { return }
        let instant = Double(max(0, bytes - sampleBytes)) / elapsed
        bytesPerSecond = bytesPerSecond == 0 ? instant : bytesPerSecond * 0.6 + instant * 0.4
        sampleBytes = bytes
        sampleAt = now
    }

    /// A retry must not come back as one very slow half-minute.
    func resetSampling() {
        bytesPerSecond = 0
        sampleAt = 0
    }

    func closeFile() {
        try? handle?.close()
        handle = nil
    }

    var asDictionary: [String: Any] {
        var d: [String: Any] = [
            "id": id,
            "path": relativePath,
            "state": state.rawValue,
            "sent": progressBytes,
            "confirmed": confirmed,
            "total": total,
            "bytesPerSecond": bytesPerSecond,
            "attempts": attempts
        ]
        if let error = error { d["error"] = error }
        if let note = note { d["note"] = note }
        if let item = item { d["item"] = item }
        return d
    }
}

final class ScrayUploads: NSObject, URLSessionDataDelegate {

    static let shared = ScrayUploads()

    /// ⚙️ 10 MiB a piece: 32 × 320 KiB. Big enough that the per-request cost
    /// disappears, small enough that a dropped connection only repeats a few
    /// seconds of work.
    private static let pieceSize: Int64 = 320 * 1024 * 32

    /// ⚙️ Tries per stall before giving up. Each waits longer (2, 4, 8… s, capped
    /// at 30) and the count resets whenever a piece gets through.
    private static let maxAttempts = 8

    private let queue = DispatchQueue(label: "scray.uploads")
    private lazy var operationQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.underlyingQueue = queue
        return q
    }()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: self, delegateQueue: operationQueue)
    }()

    private var jobs: [String: ScrayUploadJob] = [:]
    private var order: [String] = []
    private var byTask: [Int: String] = [:]

    private let countLock = NSLock()
    private var _active = 0
    /// Read by ScrayRunMonitor on the main thread.
    var activeCount: Int { countLock.lock(); defer { countLock.unlock() }; return _active }

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private override init() { super.init() }

    enum UploadError: LocalizedError {
        case badRequest(String)
        var errorDescription: String? {
            switch self { case .badRequest(let m): return m }
        }
    }

    // MARK: - Bridge

    func start(id: String, relativePath: String, uploadURL: String, size: Int64) throws {
        guard !id.isEmpty, size > 0 else { throw UploadError.badRequest("Invalid upload payload") }
        guard let url = URL(string: uploadURL), url.scheme?.lowercased() == "https" || ScrayUploads.allowsInsecure(url) else {
            throw UploadError.badRequest("Upload URL must be https")
        }
        guard let fileURL = BookmarkStore.shared.resolveFile(forId: relativePath) else {
            throw UploadError.badRequest("No video folder is linked")
        }
        let onDisk = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value
        guard let actual = onDisk else { throw UploadError.badRequest("File not found: \(relativePath)") }
        guard actual == size else {
            throw UploadError.badRequest("The file is \(actual) bytes now, not \(size) - it changed since the list was read")
        }
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: fileURL) } catch {
            throw UploadError.badRequest("Can't read \(relativePath): \(error.localizedDescription)")
        }

        try queue.sync {
            if let existing = jobs[id], existing.state == .uploading {
                handle.closeFile()
                throw UploadError.badRequest("That upload is already running")
            }
            let job = ScrayUploadJob(id: id, relativePath: relativePath, uploadURL: url, total: size)
            job.handle = handle
            jobs[id] = job
            order.removeAll { $0 == id }
            order.append(id)
            recount()
            sendNextPiece(job)
        }
        holdBackgroundGrace()
    }

    func status(ids: [String]?) -> [[String: Any]] {
        queue.sync { () -> [[String: Any]] in
            let wanted = ids ?? order
            return wanted.compactMap { id in
                guard let job = jobs[id] else { return nil }
                if job.state == .uploading { job.sample() }
                return job.asDictionary
            }
        }
    }

    func cancel(id: String) {
        queue.sync {
            guard let job = jobs[id], job.state == .uploading else { return }
            job.state = .cancelled
            job.task?.cancel()
            job.closeFile()
            recount()
            // Tell OneDrive to throw the partial file away rather than let the
            // session sit there until it expires.
            var request = URLRequest(url: job.uploadURL)
            request.httpMethod = "DELETE"
            URLSession.shared.dataTask(with: request).resume()
        }
    }

    /// Drop a finished, failed or cancelled job from the list.
    func forget(id: String) {
        queue.sync {
            guard let job = jobs[id], job.state != .uploading else { return }
            jobs[id] = nil
            order.removeAll { $0 == id }
        }
    }

    // MARK: - Pieces (all on `queue`)

    private func sendNextPiece(_ job: ScrayUploadJob) {
        guard job.state == .uploading else { return }
        guard let handle = job.handle else { return fail(job, "The file was closed") }

        let start = job.confirmed
        let length = min(ScrayUploads.pieceSize, job.total - start)
        guard length > 0 else { return fail(job, "OneDrive expects more bytes than the file has") }

        let data: Data
        do {
            try handle.seek(toOffset: UInt64(start))
            data = try handle.read(upToCount: Int(length)) ?? Data()
        } catch {
            return fail(job, "Reading the file failed: \(error.localizedDescription)")
        }
        guard Int64(data.count) == length else { return fail(job, "The file got shorter while uploading") }

        var request = URLRequest(url: job.uploadURL)
        request.httpMethod = "PUT"
        request.setValue(String(length), forHTTPHeaderField: "Content-Length")
        request.setValue("bytes \(start)-\(start + length - 1)/\(job.total)", forHTTPHeaderField: "Content-Range")

        job.inFlight = 0
        job.pieceLength = length
        job.response = Data()
        let task = session.uploadTask(with: request, from: data)
        job.task = task
        byTask[task.taskIdentifier] = job.id
        task.resume()
    }

    /// After a stall: ask OneDrive what it has, then carry on from there.
    private func resumeFromServer(_ job: ScrayUploadJob, reason: String) {
        guard job.state == .uploading else { return }
        job.attempts += 1
        guard job.attempts <= ScrayUploads.maxAttempts else {
            return fail(job, "Gave up after \(ScrayUploads.maxAttempts) tries: \(reason)")
        }
        job.note = "retrying (\(job.attempts)/\(ScrayUploads.maxAttempts)): \(reason)"
        job.inFlight = 0
        job.resetSampling()
        let delay = min(30.0, pow(2.0, Double(job.attempts)))

        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, job.state == .uploading else { return }
            var request = URLRequest(url: job.uploadURL)
            request.httpMethod = "GET"
            request.timeoutInterval = 30
            URLSession.shared.dataTask(with: request) { data, response, error in
                self.queue.async {
                    guard job.state == .uploading else { return }
                    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if code == 404 { return self.fail(job, "The upload session expired - start this file again") }
                    guard error == nil, code == 200, let next = ScrayUploads.nextExpected(data) else {
                        return self.resumeFromServer(job, reason: error?.localizedDescription ?? "status HTTP \(code)")
                    }
                    job.confirmed = max(0, min(next, job.total))
                    job.note = nil
                    self.sendNextPiece(job)
                }
            }.resume()
        }
    }

    private func finish(_ job: ScrayUploadJob, item: [String: Any]) {
        job.state = .finished
        job.item = item
        job.confirmed = job.total
        job.inFlight = 0
        job.note = nil
        job.closeFile()
        recount()
    }

    private func fail(_ job: ScrayUploadJob, _ message: String) {
        guard job.state == .uploading else { return }
        job.state = .failed
        job.error = message
        job.inFlight = 0
        job.closeFile()
        recount()
    }

    private func recount() {
        let n = jobs.values.filter { $0.state == .uploading }.count
        countLock.lock(); _active = n; countLock.unlock()
        DispatchQueue.main.async {
            ScrayRunMonitor.shared.update()
            if n == 0 { self.releaseBackgroundGrace() }
        }
    }

    // MARK: - URLSession delegate (on `queue`)

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let id = byTask[task.taskIdentifier], let job = jobs[id], job.task === task else { return }
        job.inFlight = min(totalBytesSent, job.pieceLength)
        job.sample()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let id = byTask[dataTask.taskIdentifier], let job = jobs[id], job.task === dataTask else { return }
        job.response.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = byTask.removeValue(forKey: task.taskIdentifier), let job = jobs[id], job.task === task else { return }
        job.task = nil
        guard job.state == .uploading else { return }

        if let error = error {
            return resumeFromServer(job, reason: error.localizedDescription)
        }
        let http = task.response as? HTTPURLResponse
        let code = http?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: job.response)) as? [String: Any] ?? [:]
        let message = ((json["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(code)"

        switch code {
        case 202:
            // Accepted; OneDrive names the next byte it wants. Normally the end
            // of this piece, but trust what it says over what was sent.
            job.confirmed = ScrayUploads.nextExpected(job.response) ?? (job.confirmed + job.pieceLength)
            job.inFlight = 0
            job.attempts = 0
            job.note = nil
            sendNextPiece(job)
        case 200, 201:
            finish(job, item: json)
        case 404:
            fail(job, "The upload session expired - start this file again")
        case 409:
            fail(job, "A file with this name turned up in that folder meanwhile")
        case 507:
            fail(job, "That OneDrive is full")
        case 416:
            resumeFromServer(job, reason: "out of step with OneDrive")
        case 408, 429, 500...599:
            resumeFromServer(job, reason: message)
        default:
            fail(job, "OneDrive refused the upload: \(message)")
        }
    }

    // MARK: - Helpers

    /// "12345-" or "12345-67890" → 12345.
    private static func nextExpected(_ data: Data?) -> Int64? {
        guard let data = data,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let ranges = json["nextExpectedRanges"] as? [String],
              let first = ranges.first,
              let start = first.split(separator: "-", omittingEmptySubsequences: false).first else { return nil }
        return Int64(start)
    }

    /// Dev builds may point the page at a local stub; release builds never do.
    private static func allowsInsecure(_ url: URL) -> Bool {
        #if DEBUG
        let host = url.host?.lowercased() ?? ""
        return url.scheme?.lowercased() == "http" && (host == "localhost" || host.hasSuffix(".local"))
        #else
        return false
        #endif
    }

    private func holdBackgroundGrace() {
        DispatchQueue.main.async {
            guard self.backgroundTask == .invalid else { return }
            self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "scray.uploads") { [weak self] in
                self?.releaseBackgroundGrace()
            }
        }
    }

    /// Main thread only.
    private func releaseBackgroundGrace() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
