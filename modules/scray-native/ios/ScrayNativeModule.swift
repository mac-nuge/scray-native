import ExpoModulesCore
import WebKit

public class ScrayNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScrayNative")

    // The screen stays on while the app is in front (native 14.48). Wired
    // here because it must be running whether or not anything is transferring
    // - ScrayRunMonitor used to be woken only by a run, a download or an
    // upload.
    OnCreate {
        DispatchQueue.main.async { ScrayRunMonitor.shared.keepAwakeWhileActive() }
    }

    View(ScrayNativeView.self) {
        // native 15.122: the view decides where the page comes from (the
        // Remote app loads it from the web-staging folder) - see loadSource.
        Prop("source") { (view: ScrayNativeView, path: String) in
            view.loadSource(path)
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