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
        if let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale) {
            _ = url.startAccessingSecurityScopedResource() // kept alive for app lifetime
            resolvedRoot = url
        }
    }

    func saveBookmark(for folderURL: URL) {
        guard folderURL.startAccessingSecurityScopedResource() else { return }
        defer { folderURL.stopAccessingSecurityScopedResource() }
        if let bookmark = try? folderURL.bookmarkData() {
            UserDefaults.standard.set(bookmark, forKey: "scray_folder_bookmark")
        }
        didAttemptResolve = false
        ensureResolved()
    }

    func resolveFile(forId relativePath: String) -> URL? {
        ensureResolved()
        return resolvedRoot?.appendingPathComponent(relativePath)
    }

    // MARK: - File operations

    enum FileOpError: LocalizedError {
        case noFolder
        case notFound(String)
        case alreadyExists(String)

        var errorDescription: String? {
            switch self {
            case .noFolder:
                return "No folder selected"
            case .notFound(let path):
                return "File not found: \(path)"
            case .alreadyExists(let name):
                return "A file named \"\(name)\" already exists in that folder"
            }
        }
    }

    /// Renames a file in place. Returns the new relative path.
    func renameFile(relativePath: String, newName: String) throws -> String {
        ensureResolved()
        guard let root = resolvedRoot else { throw FileOpError.noFolder }

        let src = root.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: src.path) else {
            throw FileOpError.notFound(relativePath)
        }

        let dst = src.deletingLastPathComponent().appendingPathComponent(newName)

        // APFS on iOS is case-insensitive, so a case-only rename ("clip.mp4"
        // -> "Clip.mp4") trips the collision check and moveItem refuses it.
        // Detect that and bounce through a temp name instead.
        let caseOnlyChange = dst.path.caseInsensitiveCompare(src.path) == .orderedSame
                             && dst.path != src.path

        if caseOnlyChange {
            let temp = src.deletingLastPathComponent()
                          .appendingPathComponent("\(UUID().uuidString)-\(newName)")
            try FileManager.default.moveItem(at: src, to: temp)
            try FileManager.default.moveItem(at: temp, to: dst)
        } else {
            if FileManager.default.fileExists(atPath: dst.path) {
                throw FileOpError.alreadyExists(newName)
            }
            try FileManager.default.moveItem(at: src, to: dst)
        }

        var parts = relativePath.split(separator: "/").map(String.init)
        guard !parts.isEmpty else { return newName }
        parts[parts.count - 1] = newName
        return parts.joined(separator: "/")
    }

    /// Permanently deletes a file. There is no recycle bin.
    func deleteFile(relativePath: String) throws {
        ensureResolved()
        guard let root = resolvedRoot else { throw FileOpError.noFolder }

        let target = root.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: target.path) else {
            throw FileOpError.notFound(relativePath)
        }
        try FileManager.default.removeItem(at: target)
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