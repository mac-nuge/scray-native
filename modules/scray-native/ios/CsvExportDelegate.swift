import UIKit

class CsvExportDelegate: NSObject, UIDocumentPickerDelegate {
    static let shared = CsvExportDelegate()
    private var completion: ((Any) -> Void)?
    private var tempFileURL: URL?

    func presentExporter(csvText: String, filename: String, completion: @escaping (Any) -> Void) {
        self.completion = completion

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try csvText.write(to: tempURL, atomically: true, encoding: .utf8)
        } catch {
            completion(["success": false, "error": "Failed to write temp file"])
            self.completion = nil
            return
        }
        self.tempFileURL = tempURL

        DispatchQueue.main.async {
            var root = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            // Walk to the topmost presented VC or present() is a no-op
            while let presented = root?.presentedViewController { root = presented }
            guard let root else {
                completion(["success": false])
                return
            }
            let picker = UIDocumentPickerViewController(forExporting: [tempURL])
            picker.delegate = self
            root.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        cleanupTempFile()
        completion?(["success": true])
        completion = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        cleanupTempFile()
        completion?(["success": false, "cancelled": true])
        completion = nil
    }

    private func cleanupTempFile() {
        if let url = tempFileURL {
            try? FileManager.default.removeItem(at: url)
        }
        tempFileURL = nil
    }
}