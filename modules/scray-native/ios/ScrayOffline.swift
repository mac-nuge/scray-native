import Foundation
import UIKit

// ============================================================================
// ScrayOffline - a Hetzner file saved to the phone to play offline (native 15.11).
//
// D on a row that streams from the Storage Box. The page asks api.php's
// hetzner_url for a signed link - time-limited, no header, Range honoured - and
// hands it to `offlineStart` with the file's name. This downloads it with a
// URLSession download task and moves the finished file into
//     <linked video folder>/Offline/<filename>
// Inside the linked folder on purpose: from then on it is an ordinary phone
// file to the library scan, the player and every local-file path. The page
// polls `offlineStatus` for progress; on "finished" it reads the new file's
// metadata and adds it to the library under `path`.
//
// Nothing here holds a key: the signed link is the only credential, and it
// only opens that one file. The screen is held on while anything is saving
// (ScrayRunMonitor.update), as for uploads, and a short background grace
// covers switching away briefly. A download cut off by iOS fails, and D again
// starts it over.
// ============================================================================

final class ScrayOfflineJob {
    enum State: String { case downloading, finished, failed, cancelled }

    let id: String
    let url: URL
    let filename: String
    let folder: String

    var state: State = .downloading
    var received: Int64 = 0
    var total: Int64 = 0
    var error: String?
    /// Where it landed, relative to the video folder - a local row's id.
    var relativePath: String?
    var task: URLSessionDownloadTask?

    private(set) var bytesPerSecond: Double = 0
    private var sampleBytes: Int64 = 0
    private var sampleAt: CFAbsoluteTime = 0

    init(id: String, url: URL, filename: String, folder: String) {
        self.id = id
        self.url = url
        self.filename = filename
        self.folder = folder
    }

    func sample() {
        let now = CFAbsoluteTimeGetCurrent()
        if sampleAt == 0 { sampleAt = now; sampleBytes = received; return }
        let elapsed = now - sampleAt
        guard elapsed >= 0.5 else { return }
        let instant = Double(max(0, received - sampleBytes)) / elapsed
        bytesPerSecond = bytesPerSecond == 0 ? instant : bytesPerSecond * 0.6 + instant * 0.4
        sampleBytes = received
        sampleAt = now
    }

    var asDictionary: [String: Any] {
        var d: [String: Any] = [
            "id": id,
            "filename": filename,
            "state": state.rawValue,
            "received": received,
            "total": total,
            "bytesPerSecond": bytesPerSecond
        ]
        if let error = error { d["error"] = error }
        if let relativePath = relativePath { d["path"] = relativePath }
        return d
    }
}

final class ScrayOffline: NSObject, URLSessionDownloadDelegate {

    static let shared = ScrayOffline()

    /// ⚙️ The subfolder of the video folder that D saves into.
    static let defaultFolder = "Offline"

    private let queue = DispatchQueue(label: "scray.offline")
    private lazy var operationQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.underlyingQueue = queue
        return q
    }()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 60 * 60 * 12
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: self, delegateQueue: operationQueue)
    }()

    private var jobs: [String: ScrayOfflineJob] = [:]
    private var order: [String] = []
    private var byTask: [Int: String] = [:]

    private let countLock = NSLock()
    private var _active = 0
    /// Read by ScrayRunMonitor on the main thread.
    var activeCount: Int { countLock.lock(); defer { countLock.unlock() }; return _active }

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private override init() { super.init() }

    enum OfflineError: LocalizedError {
        case badRequest(String)
        var errorDescription: String? {
            switch self { case .badRequest(let m): return m }
        }
    }

    // MARK: - Bridge

    func start(id: String, urlString: String, filename: String, folder: String?) throws {
        guard !id.isEmpty else { throw OfflineError.badRequest("Invalid download payload") }
        guard let url = URL(string: urlString), url.scheme?.lowercased() == "https" else {
            throw OfflineError.badRequest("Download URL must be https")
        }
        let name = filename.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else {
            throw OfflineError.badRequest("Invalid file name: \(filename)")
        }
        let sub = (folder ?? Self.defaultFolder).trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard !sub.isEmpty, !sub.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            throw OfflineError.badRequest("Invalid folder: \(folder ?? "")")
        }
        guard let root = BookmarkStore.shared.rootURL else {
            throw OfflineError.badRequest("No video folder is linked - pick one with Folder first")
        }
        let dest = root.appendingPathComponent(sub).appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: dest.path) {
            throw OfflineError.badRequest("\"\(name)\" is already in \(sub) on this phone")
        }

        try queue.sync {
            if jobs.values.contains(where: { $0.state == .downloading && $0.filename == name && $0.folder == sub }) {
                throw OfflineError.badRequest("\"\(name)\" is already downloading")
            }
            let job = ScrayOfflineJob(id: id, url: url, filename: name, folder: sub)
            let task = session.downloadTask(with: url)
            job.task = task
            jobs[id] = job
            order.removeAll { $0 == id }
            order.append(id)
            byTask[task.taskIdentifier] = id
            recount()
            task.resume()
        }
        holdBackgroundGrace()
    }

    func status(ids: [String]?) -> [[String: Any]] {
        queue.sync { () -> [[String: Any]] in
            let wanted = ids ?? order
            return wanted.compactMap { id in
                guard let job = jobs[id] else { return nil }
                if job.state == .downloading { job.sample() }
                return job.asDictionary
            }
        }
    }

    func cancel(id: String) {
        queue.sync {
            guard let job = jobs[id], job.state == .downloading else { return }
            job.state = .cancelled
            job.task?.cancel()
            recount()
        }
    }

    /// Drop a finished, failed or cancelled job from the list.
    func forget(id: String) {
        queue.sync {
            guard let job = jobs[id], job.state != .downloading else { return }
            jobs[id] = nil
            order.removeAll { $0 == id }
        }
    }

    private func recount() {
        let n = jobs.values.filter { $0.state == .downloading }.count
        countLock.lock(); _active = n; countLock.unlock()
        DispatchQueue.main.async {
            ScrayRunMonitor.shared.update()
            if n == 0 { self.releaseBackgroundGrace() }
        }
    }

    // MARK: - URLSession delegate (on `queue`)

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = byTask[downloadTask.taskIdentifier], let job = jobs[id] else { return }
        job.received = totalBytesWritten
        if totalBytesExpectedToWrite > 0 { job.total = totalBytesExpectedToWrite }
        job.sample()
    }

    /// The temp file is deleted as soon as this returns, so it is moved here.
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = byTask[downloadTask.taskIdentifier], let job = jobs[id], job.state == .downloading else { return }
        let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            job.state = .failed
            job.error = code == 403 ? "The link was refused (HTTP 403) - try D again"
                      : code == 410 ? "The link expired (HTTP 410) - try D again"
                      : "The Storage Box answered HTTP \(code)"
            return
        }
        guard let root = BookmarkStore.shared.rootURL else {
            job.state = .failed
            job.error = "No video folder is linked"
            return
        }
        let fm = FileManager.default
        let dir = root.appendingPathComponent(job.folder)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            // Taken meanwhile (another D, a copy made in Files): keep both,
            // the way Files does, rather than replace what is there.
            var name = job.filename
            var dest = dir.appendingPathComponent(name)
            if fm.fileExists(atPath: dest.path) {
                let base = (job.filename as NSString).deletingPathExtension
                let ext = (job.filename as NSString).pathExtension
                var n = 2
                repeat {
                    name = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
                    dest = dir.appendingPathComponent(name)
                    n += 1
                } while fm.fileExists(atPath: dest.path)
            }
            try fm.moveItem(at: location, to: dest)
            job.relativePath = "\(job.folder)/\(name)"
            if let size = (try? fm.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.int64Value {
                job.received = size
                job.total = size
            }
            job.state = .finished
        } catch {
            job.state = .failed
            job.error = "Couldn't save it to \(job.folder): \(error.localizedDescription)"
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = byTask.removeValue(forKey: task.taskIdentifier), let job = jobs[id] else { return }
        job.task = nil
        if job.state == .downloading {
            job.state = .failed
            job.error = error?.localizedDescription ?? "The download stopped"
        }
        recount()
    }

    // MARK: - Background grace (main thread)

    private func holdBackgroundGrace() {
        DispatchQueue.main.async {
            guard self.backgroundTask == .invalid else { return }
            self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "scray.offline") { [weak self] in
                self?.releaseBackgroundGrace()
            }
        }
    }

    private func releaseBackgroundGrace() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
