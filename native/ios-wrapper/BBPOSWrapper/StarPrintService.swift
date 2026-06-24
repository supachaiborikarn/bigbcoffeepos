import UIKit
import StarIO10

// ─────────────────────────────────────────────────────────────────────────────
// Prints a receipt bitmap to a USB-connected Star TSP143IIIU via StarXpand SDK.
//
// NOTE: A few StarXpand symbol names occasionally change between SDK versions.
// If something doesn't resolve after `Add Packages`, use Xcode autocomplete on
// the `StarXpandCommand.Printer` / `StarConnectionSettings` namespaces — the
// shapes below match the StarXpand SDK for iOS as documented at
// https://www.star-m.jp/starxpandsdk-oml.html
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
final class StarPrintService: NSObject {
    private var cachedSettings: StarConnectionSettings?
    private var discoveryManager: StarDeviceDiscoveryManager?
    private var discoveryDelegate: USBDiscoveryDelegate?

    func printReceipt(_ payload: ReceiptPayload) async {
        do {
            let image = try await ReceiptRenderer().render(
                html: payload.html,
                baseUrl: payload.baseUrl,
                widthMm: payload.widthMm
            )
            let settings = try await resolvePrinter()
            for _ in 0..<max(1, payload.copies) {
                try await printImage(image, settings: settings, widthMm: payload.widthMm)
            }
        } catch {
            print("[BBPOS] receipt print failed: \(error)")
            // TODO: surface to the cashier (e.g. evaluateJavaScript a toast, or a UIAlert).
        }
    }

    // MARK: - USB discovery (cached after first success)

    private func resolvePrinter() async throws -> StarConnectionSettings {
        if let cachedSettings { return cachedSettings }
        let found = try await discoverFirstUSBPrinter()
        cachedSettings = found
        return found
    }

    private func discoverFirstUSBPrinter() async throws -> StarConnectionSettings {
        try await withCheckedThrowingContinuation { continuation in
            do {
                let manager = try StarDeviceDiscoveryManagerFactory.create(interfaceTypes: [.usb])
                manager.discoveryTime = 3000
                let delegate = USBDiscoveryDelegate(continuation: continuation)
                manager.delegate = delegate
                self.discoveryDelegate = delegate          // keep alive during discovery
                self.discoveryManager = manager
                try manager.startDiscovery()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Print one bitmap, then partial-cut

    private func printImage(_ image: UIImage, settings: StarConnectionSettings, widthMm: Int) async throws {
        let printer = StarPrinter(settings)
        try await printer.open()
        defer { Task { await printer.close() } }

        let dots = widthMm >= 80 ? 576 : 384
        let builder = StarXpandCommand.StarXpandCommandBuilder()
        _ = builder.addDocument(
            StarXpandCommand.DocumentBuilder().addPrinter(
                StarXpandCommand.PrinterBuilder()
                    .actionPrintImage(StarXpandCommand.Printer.ImageParameter(image: image, width: dots))
                    .actionFeed(StarXpandCommand.Printer.FeedParameter(height: 3))
                    .actionCut(StarXpandCommand.Printer.CutType.partial)
            )
        )
        try await printer.print(command: builder.getCommands())
    }
}

/// Resolves on the first USB printer found (TSP143IIIU is the only USB device).
private final class USBDiscoveryDelegate: NSObject, StarDeviceDiscoveryManagerDelegate {
    private var continuation: CheckedContinuation<StarConnectionSettings, Error>?
    private var resolved = false

    enum DiscoveryError: Error { case noPrinterFound }

    init(continuation: CheckedContinuation<StarConnectionSettings, Error>) {
        self.continuation = continuation
    }

    func manager(_ manager: StarDeviceDiscoveryManager, didFind printer: StarPrinter) {
        guard !resolved else { return }
        resolved = true
        continuation?.resume(returning: printer.connectionSettings)
        continuation = nil
        manager.stopDiscovery()
    }

    func managerDidFinishDiscovery(_ manager: StarDeviceDiscoveryManager) {
        guard !resolved else { return }
        resolved = true
        continuation?.resume(throwing: DiscoveryError.noPrinterFound)
        continuation = nil
    }
}
