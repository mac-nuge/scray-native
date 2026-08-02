import ExpoModulesCore
import WebKit

public class ScrayNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScrayNative")

    View(ScrayNativeView.self) {
        Prop("source") { (view: ScrayNativeView, path: String) in
            if path.hasPrefix("http") {
                if let url = URL(string: path) {
                    view.webView.load(URLRequest(url: url))
                }
            } else if let url = Bundle.main.url(forResource: "web/" + path, withExtension: nil) {
                view.webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            }
        }
    }

    Function("pickFolder") { () -> Void in
        DispatchQueue.main.async {
            guard let root = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = FolderPickerDelegate.shared
            root.present(picker, animated: true)
        }
    }

    Function("listVideoFiles") { () -> [String] in
        BookmarkStore.shared.listVideoFiles()
    }

    Function("debugBundle") { () -> [String: Any] in
        let resourcePath = Bundle.main.resourcePath ?? "nil"
        let rootContents = (try? FileManager.default.contentsOfDirectory(atPath: resourcePath)) ?? []
        let webContents = (try? FileManager.default.contentsOfDirectory(atPath: resourcePath + "/web")) ?? []
        return [
            "resourcePath": resourcePath,
            "rootContents": rootContents,
            "webFolderContents": webContents
        ]
    }
  }
}