import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        let vc = storyboard.instantiateInitialViewController()!
        vc.edgesForExtendedLayout = []

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = vc
        window?.makeKeyAndVisible()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Re-enforce safe area when app becomes active (after browser dismiss)
        if let vc = window?.rootViewController {
            vc.edgesForExtendedLayout = []
            vc.setNeedsStatusBarAppearanceUpdate()
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
    }
}
