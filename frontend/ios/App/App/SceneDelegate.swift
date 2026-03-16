import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: windowScene)

        let bridge = CAPBridgeViewController()
        window?.rootViewController = bridge
        window?.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Universal Links — forward to Capacitor
        NotificationCenter.default.post(name: NSNotification.Name.capacitorContinueActivity, object: userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Custom URL schemes — forward to Capacitor
        for context in URLContexts {
            NotificationCenter.default.post(name: NSNotification.Name.capacitorOpenURL, object: [
                "url": context.url,
                "options": context.options.sourceApplication ?? ""
            ])
        }
    }
}
