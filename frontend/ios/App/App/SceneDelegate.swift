import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        let vc = storyboard.instantiateInitialViewController()!

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = vc
        window?.makeKeyAndVisible()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Force StatusBar plugin to re-apply frame after any interruption (browser dismiss, etc.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NotificationCenter.default.post(Notification(name: .capacitorViewDidAppear))
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        NotificationCenter.default.post(name: NSNotification.Name.capacitorContinueActivity, object: userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            NotificationCenter.default.post(name: NSNotification.Name.capacitorOpenURL, object: [
                "url": context.url,
                "options": context.options.sourceApplication ?? ""
            ])
        }

        // After URL callback (OAuth), force StatusBar plugin to re-layout the WebView frame
        // The resizeWebView() in StatusBar plugin doesn't re-run after browser dismiss + page reload
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NotificationCenter.default.post(Notification(name: .capacitorViewDidAppear))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            NotificationCenter.default.post(Notification(name: .capacitorViewDidAppear))
        }
    }
}
