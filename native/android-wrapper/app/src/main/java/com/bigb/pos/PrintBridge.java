package com.bigb.pos;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * `window.BBPOSNative` inside the web POS.
 *
 * The web app (apps/web/src/utils/nativePrinter.ts) calls printReceipt(JSON) with the same
 * payload the iPad app gets; the result goes back as the `bbpos-native-print-result` event
 * that PrintCenter.tsx already listens for. Jobs run one at a time.
 */
public final class PrintBridge {
    private final MainActivity activity;
    private final ReceiptRenderer renderer;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService bluetooth = Executors.newSingleThreadExecutor();
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private boolean busy;

    private static final class Job {
        String requestId = "";
        List<String> documents = new ArrayList<>();
        int widthMm = 58;
        String baseUrl = "";
        boolean test;
    }

    PrintBridge(MainActivity activity, ReceiptRenderer renderer) {
        this.activity = activity;
        this.renderer = renderer;
    }

    // ── called from page JavaScript (JavaBridge thread) ──────────────────────

    @JavascriptInterface
    public void printReceipt(String json) {
        if (!activity.isPosPage()) return; // only the POS site may print
        final Job job;
        try {
            job = parse(json);
        } catch (Exception e) {
            return;
        }
        main.post(() -> {
            queue.add(job);
            next();
        });
    }

    /** Lets the web settings screen offer "change printer" later; also used from the offline page. */
    @JavascriptInterface
    public void choosePrinter() {
        if (!activity.isPosPage()) return;
        main.post(() -> activity.ensurePrinter(true, address -> { }));
    }

    @JavascriptInterface
    public void reload() {
        main.post(activity::reloadPos);
    }

    @JavascriptInterface
    public String appInfo() {
        try {
            return new JSONObject()
                    .put("platform", "android")
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("printer", activity.savedPrinterName())
                    .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // ── job handling (main thread) ───────────────────────────────────────────

    private void next() {
        if (busy || queue.isEmpty()) return;
        busy = true;
        final Job job = queue.poll();
        // The web "พิมพ์ทดสอบ" receipt (bill 0) always asks which printer to use, so it doubles
        // as the place to change printers.
        activity.ensurePrinter(job.test, address -> {
            if (address == null) {
                finish(job, 0, "ยังไม่ได้เลือกเครื่องพิมพ์");
                return;
            }
            renderNext(job, address, new ArrayList<>());
        });
    }

    private void renderNext(Job job, String address, List<byte[]> slips) {
        if (slips.size() == job.documents.size()) {
            send(job, address, slips);
            return;
        }
        renderer.render(job.documents.get(slips.size()), job.baseUrl, job.widthMm, new ReceiptRenderer.Callback() {
            @Override
            public void onRendered(Bitmap bitmap) {
                int w = bitmap.getWidth(), h = bitmap.getHeight();
                int[] pixels = new int[w * h];
                bitmap.getPixels(pixels, 0, w, 0, 0, w, h);
                bitmap.recycle();
                slips.add(EscPos.receipt(pixels, w, h));
                renderNext(job, address, slips);
            }

            @Override
            public void onFailed(String message) {
                finish(job, 0, message);
            }
        });
    }

    private void send(Job job, String address, List<byte[]> slips) {
        bluetooth.execute(() -> {
            int written = 0;
            String error = null;
            try (BluetoothPrinter printer = BluetoothPrinter.connect(address)) {
                int bytes = 0;
                for (byte[] slip : slips) {
                    printer.write(slip);
                    bytes += slip.length;
                    written++;
                }
                printer.drain(bytes);
            } catch (IOException e) {
                error = e.getMessage();
            } catch (RuntimeException e) {
                error = "พิมพ์ไม่สำเร็จ: " + e.getMessage();
            }
            final int done = written;
            final String failure = error;
            main.post(() -> finish(job, done, failure));
        });
    }

    private void finish(Job job, int completed, String error) {
        boolean success = error == null && completed == job.documents.size();
        activity.dispatchPrintResult(job.requestId, success, completed, error);
        if (error != null) activity.showPrintError(error);
        busy = false;
        next();
    }

    private static Job parse(String json) throws Exception {
        JSONObject o = new JSONObject(json);
        Job job = new Job();
        job.requestId = o.optString("requestId", "");
        job.widthMm = o.optInt("widthMm", 58);
        job.baseUrl = o.optString("baseUrl", "");
        Object bill = o.opt("billId");
        job.test = bill != null && "0".equals(String.valueOf(bill));
        JSONArray docs = o.optJSONArray("documents");
        if (docs != null) for (int i = 0; i < docs.length(); i++) {
            String d = docs.optString(i, "");
            if (!d.isEmpty()) job.documents.add(d);
        }
        if (job.documents.isEmpty()) job.documents.add(o.getString("html"));
        return job;
    }
}
