package com.bigb.pos;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Renders one receipt document (HTML from the web POS) into a bitmap exactly as wide as the
 * printer head. Uses a hidden WebView laid out at the printable width in CSS pixels
 * (48 mm → 181 px), then draws it scaled up to the head's dots, so text is drawn sharp
 * rather than enlarged from a small picture.
 */
final class ReceiptRenderer {
    interface Callback {
        void onRendered(Bitmap bitmap);
        void onFailed(String message);
    }

    private static final long TIMEOUT_MS = 20_000;

    private final Activity activity;
    private final FrameLayout host;
    private final Handler main = new Handler(Looper.getMainLooper());

    ReceiptRenderer(Activity activity, FrameLayout host) {
        this.activity = activity;
        this.host = host;
    }

    /** Must be called on the main thread. */
    void render(String html, String baseUrl, int widthMm, Callback callback) {
        final int dots = EscPos.dotsForPaper(widthMm);
        final float printableMm = widthMm >= 80 ? 72f : 48f;
        final float density = activity.getResources().getDisplayMetrics().density;
        final int viewWidth = Math.max(1, Math.round(printableMm * 96f / 25.4f * density));

        final WebView web = new WebView(activity);
        web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        web.setBackgroundColor(Color.WHITE);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);          // only used to read the page height
        s.setTextZoom(100);                    // ignore the tablet's font-size setting
        s.setUseWideViewPort(false);           // layout width = view width in CSS px
        s.setLoadWithOverviewMode(false);
        s.setBlockNetworkLoads(false);         // the logo / web fonts load from the POS site

        final FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(viewWidth, 10);
        host.addView(web, 0, lp);              // index 0 = behind the POS web view, never seen

        final boolean[] finished = {false};
        final Runnable cleanup = () -> {
            host.removeView(web);
            web.destroy();
        };
        final Runnable timeout = () -> {
            if (finished[0]) return;
            finished[0] = true;
            cleanup.run();
            callback.onFailed("สร้างภาพใบเสร็จไม่ทัน");
        };
        main.postDelayed(timeout, TIMEOUT_MS);

        web.setWebViewClient(new WebViewClient() {
            private boolean measured;

            @Override
            public void onPageFinished(WebView view, String url) {
                if (measured) return;
                measured = true;
                // fonts and the logo image settle a moment after "finished"
                main.postDelayed(() -> web.evaluateJavascript(
                        "(function(){var d=document;return Math.ceil(Math.max(d.body?d.body.scrollHeight:0,d.documentElement.scrollHeight));})()",
                        value -> {
                            if (finished[0]) return;
                            int cssHeight;
                            try { cssHeight = (int) Double.parseDouble(value); } catch (Exception e) { cssHeight = 1600; }
                            final int viewHeight = Math.max(1, Math.min(Math.round(cssHeight * density), 30_000));
                            lp.height = viewHeight;
                            web.setLayoutParams(lp);
                            main.postDelayed(() -> draw(web, viewWidth, viewHeight, dots, finished, cleanup, timeout, callback), 450);
                        }), 600);
            }
        });
        web.loadDataWithBaseURL(baseUrl == null || baseUrl.isEmpty() ? null : baseUrl, html, "text/html", "utf-8", null);
    }

    private void draw(WebView web, int viewWidth, int viewHeight, int dots, boolean[] finished,
                      Runnable cleanup, Runnable timeout, Callback callback) {
        if (finished[0]) return;
        finished[0] = true;
        main.removeCallbacks(timeout);
        try {
            float scale = dots / (float) viewWidth;
            int outHeight = Math.max(1, Math.round(viewHeight * scale));
            Bitmap bitmap = Bitmap.createBitmap(dots, outHeight, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE);
            canvas.scale(scale, scale);
            web.draw(canvas);
            cleanup.run();
            callback.onRendered(bitmap);
        } catch (Throwable t) {
            cleanup.run();
            callback.onFailed("สร้างภาพใบเสร็จไม่สำเร็จ: " + t.getMessage());
        }
    }
}
