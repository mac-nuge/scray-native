import UIKit
import UniformTypeIdentifiers

// ============================================================================
// The browser's default download destination.
//
// iOS won't let an app write into an arbitrary Files location on its own, so
// the deal is the same one BookmarkStore makes for the video folder: the user
// picks a folder once, we keep a security-scoped bookmark, and from then on
// downloads are copied straight in with no sheet. No folder chosen means we
// fall back to the export picker every time, which is the old behaviour.
// ============================================================================

final class ScrayDownloadFolder: NSObject, UIDocumentPickerDelegate {

    static let shared = ScrayDownloadFolder()

    private static let bookmarkKey = "scray.browser.downloadFolder"
    private static let nameKey     = "scray.browser.downloadFolderName"

    private var pickCompletion: ((String?) -> Void)?

    var hasFolder: Bool { UserDefaults.standard.data(forKey: Self.bookmarkKey) != nil }
    var displayName: String? { UserDefaults.standard.string(forKey: Self.nameKey) }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: Self.nameKey)
    }

    func choose(from presenter: UIViewController, completion: @escaping (String?) -> Void) {
        pickCompletion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        defer { pickCompletion = nil }
        guard let folder = urls.first else { pickCompletion?(nil); return }

        guard folder.startAccessingSecurityScopedResource() else { pickCompletion?(nil); return }
        defer { folder.stopAccessingSecurityScopedResource() }

        guard let bookmark = try? folder.bookmarkData() else { pickCompletion?(nil); return }
        UserDefaults.standard.set(bookmark, forKey: Self.bookmarkKey)
        UserDefaults.standard.set(folder.lastPathComponent, forKey: Self.nameKey)
        pickCompletion?(folder.lastPathComponent)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCompletion?(nil)
        pickCompletion = nil
    }

    /// Copies into the remembered folder. Returns the saved URL, or nil if
    /// there is no folder or it's no longer reachable — the caller falls back
    /// to the export sheet rather than losing the file.
    func save(fileURL: URL) -> URL? {
        guard let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return nil }

        var stale = false
        guard let folder = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale) else { return nil }
        guard folder.startAccessingSecurityScopedResource() else { return nil }
        defer { folder.stopAccessingSecurityScopedResource() }

        if stale, let refreshed = try? folder.bookmarkData() {
            UserDefaults.standard.set(refreshed, forKey: Self.bookmarkKey)
        }

        let dest = Self.uniquified(folder.appendingPathComponent(fileURL.lastPathComponent))
        do {
            try FileManager.default.copyItem(at: fileURL, to: dest)
            return dest
        } catch {
            return nil
        }
    }

    /// "report.csv" already there becomes "report 2.csv" — overwriting a file
    /// you downloaded five minutes ago is never what you meant.
    private static func uniquified(_ url: URL) -> URL {
        guard FileManager.default.fileExists(atPath: url.path) else { return url }
        let ext = url.pathExtension
        let base = url.deletingPathExtension().lastPathComponent
        let dir = url.deletingLastPathComponent()
        var n = 2
        while n < 1000 {
            let name = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
            let candidate = dir.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            n += 1
        }
        return url
    }
}