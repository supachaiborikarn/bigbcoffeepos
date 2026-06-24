import UIKit
import WebKit

/// Renders the receipt HTML (sent by the web app) into a bitmap sized for the
/// thermal printer. Rendering with WebKit means Thai text always comes out
/// exactly as designed, regardless of the printer's built-in fonts.
@MainActor
final class ReceiptRenderer: NSObject, WKNavigationDelegate {
    private var webView: WKWebView?
    private var continuation: CheckedContinuation<UIImage, Error>?
    private var targetWidthPx: CGFloat = 384

    enum RenderError: Error { case snapshotFailed }

    /// 58mm roll ≈ 384 dots printable width; 80mm ≈ 576 dots (Star = 203 dpi).
    func render(html: String, baseUrl: String, widthMm: Int) async throws -> UIImage {
        targetWidthPx = widthMm >= 80 ? 576 : 384

        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: targetWidthPx, height: 100))
        web.navigationDelegate = self
        web.isOpaque = true
        web.backgroundColor = .white
        web.scrollView.isScrollEnabled = false
        self.webView = web

        return try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            web.loadHTMLString(html, baseURL: URL(string: baseUrl))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Give fonts / the logo image a moment to settle, then size to content and snapshot.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, let web = self.webView else { return }
            web.evaluateJavaScript("document.body.scrollHeight") { result, _ in
                let height = (result as? CGFloat)
                    ?? (result as? Double).map(CGFloat.init)
                    ?? (result as? Int).map(CGFloat.init)
                    ?? 1200
                web.frame = CGRect(x: 0, y: 0, width: self.targetWidthPx, height: max(1, height))

                let snapConfig = WKSnapshotConfiguration()
                snapConfig.snapshotWidth = NSNumber(value: Double(self.targetWidthPx))
                web.takeSnapshot(with: snapConfig) { image, error in
                    if let image {
                        self.continuation?.resume(returning: image)
                    } else {
                        self.continuation?.resume(throwing: error ?? RenderError.snapshotFailed)
                    }
                    self.continuation = nil
                    self.webView = nil
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
        self.webView = nil
    }
}
