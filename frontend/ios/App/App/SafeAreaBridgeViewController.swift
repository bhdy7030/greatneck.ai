import UIKit
import Capacitor
import WebKit

class SafeAreaBridgeViewController: CAPBridgeViewController {

    private var statusBarHeight: CGFloat = 0

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let scene = view.window?.windowScene {
            statusBarHeight = scene.statusBarManager?.statusBarFrame.height ?? 0
        }
        restoreFrame()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        restoreFrame()
    }

    /// Only adjust the TOP of the WebView frame (below status bar / Dynamic Island).
    /// Bottom safe area is handled by CSS env(safe-area-inset-bottom) which works
    /// reliably since the WebView extends to the bottom edge.
    private func restoreFrame() {
        guard let webView = self.webView, statusBarHeight > 0 else { return }

        if webView.frame.origin.y < 1.0 {
            let bounds = view.bounds
            var newFrame = bounds
            newFrame.origin.y = statusBarHeight
            newFrame.size.height = bounds.height - statusBarHeight
            webView.frame = newFrame
        }
    }
}
