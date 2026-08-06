import UIKit

class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
    static let shared = FolderPickerDelegate()
    private var completion: ((Any) -> Void)?

    func presentPicker(completion: @escaping (Any) -> Void) {
        self.completion = completion
        DispatchQueue.main.async {
            guard let root = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                completion(["success": false])
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            root.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let folderURL = urls.first else {
            completion?(["success": false])
            completion = nil
            return
        }
        BookmarkStore.shared.saveBookmark(for: folderURL)
        // name/path feed the folder pill in the web layer
        completion?([
            "success": true,
            "name": folderURL.lastPathComponent,
            "path": folderURL.path
        ])
        completion = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        completion?(["success": false, "cancelled": true])
        completion = nil
    }
}