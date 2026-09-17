import Foundation
import UIKit
import os

// ============================================================================
// ScrayMemoryStats (native 13.180) - what the performance monitor under the
// player reads over the bridge (`memoryStats`), about every two seconds.
//
// One thing it can't see: WebKit runs the page itself - the list, the player,
// the decoded video - in a separate WebContent process, and iOS gives an app
// no way to read another process's memory. So these figures are the APP'S
// process (Swift, the video file server, the in-app browser's own objects),
// plus the two system-wide signals that do cover everything: how hot the
// phone is, and whether iOS has sent a memory warning.
// ============================================================================

final class ScrayMemoryStats {

    static let shared = ScrayMemoryStats()

    private(set) var warningCount = 0
    private var lastWarningAt: Date?
    private var observer: NSObjectProtocol?

    private init() {
        observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            self.warningCount += 1
            self.lastWarningAt = Date()
            ScrayNativeView.current?.notifyMemoryWarning()
        }
    }

    /// Touch `shared` early so warnings are counted from launch.
    func start() {}

    func snapshot() -> [String: Any] {
        var result: [String: Any] = [:]

        // phys_footprint is the figure iOS itself judges the app by (it's what
        // Xcode's memory gauge shows and what jetsam limits are measured in).
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        if kr == KERN_SUCCESS {
            result["footprintBytes"] = Int64(info.phys_footprint)
        }

        // How much more this process may use before iOS kills it.
        result["availableBytes"] = Int64(os_proc_available_memory())
        result["physicalBytes"] = Int64(ProcessInfo.processInfo.physicalMemory)

        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "unknown"
        }
        result["thermal"] = thermal
        result["lowPower"] = ProcessInfo.processInfo.isLowPowerModeEnabled
        result["memoryWarnings"] = warningCount
        if let at = lastWarningAt {
            result["secondsSinceWarning"] = Date().timeIntervalSince(at)
        }
        return result
    }
}
