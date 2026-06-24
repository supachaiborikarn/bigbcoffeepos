import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        POSWebView(url: AppConfig.posURL)
            .ignoresSafeArea()
    }
}

/// Full-screen WKWebView that loads the POS and bridges receipt printing to native.
struct POSWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        // The web app posts receipts to `window.webkit.messageHandlers.starPrint`.
        config.userContentController.add(context.coordinator, name: "starPrint")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        context.coordinator.webView = webView
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let printService = StarPrintService()

        func userContentController(_ controller: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == "starPrint" else { return }
            guard let payload = ReceiptPayload(message: message.body) else {
                print("[BBPOS] starPrint: could not parse payload")
                return
            }
            Task { await printService.printReceipt(payload) }
        }
    }
}

/// Mirrors the JSON object sent by apps/web/src/utils/nativePrinter.ts.
struct ReceiptPayload {
    let html: String
    let widthMm: Int
    let copies: Int
    let baseUrl: String
    let billId: String

    init?(message body: Any) {
        guard let dict = body as? [String: Any],
              let html = dict["html"] as? String else { return nil }
        self.html = html
        self.widthMm = (dict["widthMm"] as? Int) ?? 58
        self.copies = (dict["copies"] as? Int) ?? 1
        self.baseUrl = (dict["baseUrl"] as? String) ?? ""
        if let id = dict["billId"] as? String { self.billId = id }
        else if let id = dict["billId"] as? Int { self.billId = String(id) }
        else { self.billId = "" }
    }
}
