import Foundation

class BookmarkStore {
    static let shared = BookmarkStore()
    private var resolvedRoot: URL?
    private var didAttemptResolve = false

    private func ensureResolved() {
        guard !didAttemptResolve else { return }
        didAttemptResolve = true
        guard let data = UserDefaults.standard.data(forKey: "scray_folder_bookmark") else { return }
        var stale = false
        if let url = try? URL(resolvingBookmarkData: data, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale) {
            _ = url.startAccessingSecurityScopedResource() // kept alive for app lifetime
            resolvedRoot = url
        }
    }

    func saveBookmark(for folderURL: URL) {
        guard folderURL.startAccessingSecurityScopedResource() else { return }
        defer { folderURL.stopAccessingSecurityScopedResource() }
        if let bookmark = try? folderURL.bookmarkData(options: .withSecurityScope) {
            UserDefaults.standard.set(bookmark, forKey: "scray_folder_bookmark")
        }
        didAttemptResolve = false
        ensureResolved()
    }

    func resolveFile(forId relativePath: String) -> URL? {
        ensureResolved()
        return resolvedRoot?.appendingPathComponent(relativePath)
    }

    func listVideoFiles() -> [String] {
        ensureResolved()
        guard let root = resolvedRoot else { return [] }
        let exts = ["mp4", "mkv", "mov", "m4v", "avi"]
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return [] }
        var results: [String] = []
        for case let fileURL as URL in enumerator {
            if exts.contains(fileURL.pathExtension.lowercased()) {
                results.append(fileURL.path.replacingOccurrences(of: root.path + "/", with: ""))
            }
        }
        return results
    }
}