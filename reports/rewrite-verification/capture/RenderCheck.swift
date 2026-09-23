import UIKit
import WebKit

final class RenderController: UIViewController {
    let web = WKWebView(frame: .zero)
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isInspectable = true
        let rules = """
        [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"^http://127.0.0.1:8765/"},"action":{"type":"ignore-previous-rules"}}]
        """
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "local-only", encodedContentRuleList: rules) { list, error in
            guard let list = list else { fatalError("Content rules: \(String(describing: error))") }
            self.web.configuration.userContentController.add(list)
            self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:8765/index.html")!))
        }
    }
    override var prefersStatusBarHidden: Bool { true }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = RenderController()
        window?.makeKeyAndVisible()
        return true
    }
}
