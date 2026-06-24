import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Big B Coffee POS — native iOS wrapper
//
// A thin WKWebView shell around the existing web POS. Its only extra job is to
// print receipts to a USB‑connected Star TSP143IIIU using the StarXpand SDK,
// because Safari/AirPrint cannot drive that printer. The web app calls
//   window.webkit.messageHandlers.starPrint.postMessage({ html, widthMm, ... })
// (see apps/web/src/utils/nativePrinter.ts) and this app does the printing.
// ─────────────────────────────────────────────────────────────────────────────

@main
struct BBPOSWrapperApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .statusBarHidden(true)
        }
    }
}

enum AppConfig {
    /// URL of the deployed Big B Coffee POS web app.
    ///
    /// ⚠️ CHANGE THIS to your real production URL. While testing on the LAN you
    /// can point it at an http://192.168.x.x:5173 dev server — if you do, add an
    /// App Transport Security exception in Info.plist (see README).
    static let posURL = URL(string: "https://bigbcoffeepos-web.vercel.app")!
}
