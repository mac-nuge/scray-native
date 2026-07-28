import UIKit

class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
    static let shared = FolderPickerDelegate()

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let folderURL = urls.first else { return }
        BookmarkStore.shared.saveBookmark(for: folderURL)
    }
}