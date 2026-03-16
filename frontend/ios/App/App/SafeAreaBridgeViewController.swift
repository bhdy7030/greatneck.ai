import UIKit
import Capacitor
import WebKit

class SafeAreaBridgeViewController: CAPBridgeViewController {

    private var expectedStatusBarHeight: CGFloat = 0

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Capture the correct status bar height on first appear
        if let scene = view.window?.windowScene {
            expectedStatusBarHeight = scene.statusBarManager?.statusBarFrame.height ?? 0
        }
        restoreFrameIfNeeded()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        restoreFrameIfNeeded()
    }

    private func restoreFrameIfNeeded() {
        guard let webView = self.webView, expectedStatusBarHeight > 0 else { return }

        // The StatusBar plugin (overlaysWebView: false) should set webView.frame.origin.y
        // to the status bar height. If it's at 0, the plugin didn't run — fix it.
        if webView.frame.origin.y < 1.0 {
            let bounds = view.bounds
            var newFrame = bounds
            newFrame.origin.y = expectedStatusBarHeight
            newFrame.size.height = bounds.height - expectedStatusBarHeight
            webView.frame = newFrame
        }
    }
}
