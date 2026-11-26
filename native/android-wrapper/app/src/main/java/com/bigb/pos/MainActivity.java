package com.bigb.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

/**
 * BigB POS for Android: the web POS full-screen in a WebView, plus direct Bluetooth printing
 * to the paired receipt printer (see PrintBridge). Built for the oil-change bay's
 * HUAWEI MatePad T8, which has no Google Play (so no RawBT) and whose browser cannot reach
 * Bluetooth printers.
 */
public class MainActivity extends Activity {
    static final String POS_URL = "https://bigbcoffeepos-web.vercel.app/pos";
    static final String POS_HOST = Uri.parse(POS_URL).getHost();

    private static final String TAG = "BBPOS";
    private static final String PREFS = "printer";
    private static final String KEY_ADDRESS = "address";
    private static final String KEY_NAME = "name";
    private static final int REQ_BLUETOOTH = 11;
    private static final int REQ_FILE = 12;

    private FrameLayout root;
    private WebView pos;
    private SharedPreferences prefs;
    private volatile String currentUrl = "";
    private Runnable afterBluetoothPermission;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Lets the hidden receipt WebView draw its whole page into a bitmap, not just the visible part.
        WebView.enableSlowWholeDocumentDraw();
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        pos = new WebView(this);
        root.addView(pos, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Fullscreen Android activities (especially Android 10 / EMUI on MatePad T8) do not
        // apply windowSoftInputMode="adjustResize" to WebViews. Reserve the IME height via
        // bottomMargin whenever the soft keyboard is up so product cards remain scrollable.
        root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect visible = new Rect();
            root.getWindowVisibleDisplayFrame(visible);
            int totalHeight = root.getRootView().getHeight();
            if (totalHeight <= 0) return;
            int keypadHeight = Math.max(0, totalHeight - visible.bottom);
            int targetBottom = keypadHeight > totalHeight * 0.15 ? keypadHeight : 0;
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) pos.getLayoutParams();
            if (lp.bottomMargin != targetBottom) {
                lp.bottomMargin = targetBottom;
                pos.setLayoutParams(lp);
                if (targetBottom == 0) hideSystemBars();
            }
        });

        WebSettings s = pos.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100); // the POS layout is tuned in CSS; the tablet's font-size setting would break it
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " BBPOSAndroid/" + BuildConfig.VERSION_NAME);

        pos.setWebViewClient(new PosClient());
        pos.setWebChromeClient(new PosChrome());
        pos.addJavascriptInterface(new PrintBridge(this, new ReceiptRenderer(this, root)), "BBPOSNative");

        if (savedInstanceState != null) pos.restoreState(savedInstanceState);
        else pos.loadUrl(POS_URL);
        hideSystemBars();
    }

    // ── page / navigation ────────────────────────────────────────────────────

    boolean isPosPage() {
        String url = currentUrl;
        return url != null && POS_HOST != null && POS_HOST.equalsIgnoreCase(Uri.parse(url).getHost());
    }

    void reloadPos() {
        pos.loadUrl(POS_URL);
    }

    void hideKeyboard() {
        pos.clearFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) {
            imm.hideSoftInputFromWindow(pos.getWindowToken(), 0);
        }
        hideSystemBars();
    }

    private final class PosClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if ((scheme.equals("https") || scheme.equals("http")) && POS_HOST != null && POS_HOST.equalsIgnoreCase(uri.getHost())) {
                return false; // stay in the app
            }
            // Other sites and app links (LINE, phone numbers…) open outside the POS.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, "เปิดลิงก์นี้ไม่ได้", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            currentUrl = url;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            currentUrl = url; // the POS is a single-page app: routes change without a page load
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            currentUrl = "";
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null);
        }
    }

    private static final String OFFLINE_PAGE = "<!doctype html><html lang=th><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f5f5ef;color:#243c33;text-align:center'>"
            + "<div><h2>เชื่อมต่ออินเทอร์เน็ตไม่ได้</h2><p>ตรวจ Wi-Fi หรือสัญญาณมือถือ แล้วกดลองใหม่</p>"
            + "<button onclick='BBPOSNative.reload()' style='font-size:20px;padding:14px 32px;border:0;border-radius:12px;background:#c2551c;color:#fff'>ลองใหม่</button></div></body></html>";

    private final class PosChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, "web: " + m.message());
            return true;
        }
    }

    // ── printer selection ────────────────────────────────────────────────────

    String savedPrinterName() {
        return prefs.getString(KEY_NAME, "");
    }

    /**
     * Hands the printer's Bluetooth address to {@code callback} (null when there is none).
     * Asks for the "nearby devices" permission on Android 12+, and shows the list of paired
     * devices when nothing is saved yet or {@code alwaysAsk} is set.
     */
    void ensurePrinter(boolean alwaysAsk, Consumer<String> callback) {
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            afterBluetoothPermission = () -> {
                if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) ensurePrinter(alwaysAsk, callback);
                else {
                    Toast.makeText(this, "ต้องอนุญาต \"อุปกรณ์ใกล้เคียง\" ก่อนจึงจะพิมพ์ได้", Toast.LENGTH_LONG).show();
                    callback.accept(null);
                }
            };
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQ_BLUETOOTH);
            return;
        }
        String saved = prefs.getString(KEY_ADDRESS, null);
        if (saved != null && !alwaysAsk) {
            callback.accept(saved);
            return;
        }
        choosePrinter(saved, callback);
    }

    @SuppressLint("MissingPermission") // checked in ensurePrinter
    private void choosePrinter(String saved, Consumer<String> callback) {
        final boolean[] answered = {false};
        final Consumer<String> once = address -> {
            if (answered[0]) return;
            answered[0] = true;
            callback.accept(address);
        };
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            Toast.makeText(this, "แท็บเล็ตนี้ไม่มีบลูทูธ", Toast.LENGTH_LONG).show();
            once.accept(null);
            return;
        }
        if (!adapter.isEnabled()) {
            showBluetoothSettingsDialog("บลูทูธปิดอยู่", "เปิดบลูทูธ แล้วกดพิมพ์อีกครั้ง", once);
            return;
        }
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded == null || bonded.isEmpty()) {
            showBluetoothSettingsDialog("ยังไม่ได้จับคู่เครื่องพิมพ์", "ไปที่ตั้งค่าบลูทูธ จับคู่เครื่องพิมพ์ (เช่น Printer001) แล้วกดพิมพ์อีกครั้ง", once);
            return;
        }
        // Printers first (Bluetooth "imaging" class), then the rest.
        List<BluetoothDevice> devices = new ArrayList<>(bonded);
        devices.sort((a, b) -> {
            int pa = isPrinter(a) ? 0 : 1, pb = isPrinter(b) ? 0 : 1;
            if (pa != pb) return pa - pb;
            return nameOf(a).compareToIgnoreCase(nameOf(b));
        });
        String[] labels = new String[devices.size()];
        int checked = -1;
        for (int i = 0; i < devices.size(); i++) {
            labels[i] = nameOf(devices.get(i));
            if (devices.get(i).getAddress().equals(saved)) checked = i;
        }
        new AlertDialog.Builder(this)
                .setTitle("เลือกเครื่องพิมพ์ใบเสร็จ")
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    BluetoothDevice d = devices.get(which);
                    prefs.edit().putString(KEY_ADDRESS, d.getAddress()).putString(KEY_NAME, nameOf(d)).apply();
                    Toast.makeText(this, "ใช้เครื่องพิมพ์ " + nameOf(d), Toast.LENGTH_SHORT).show();
                    dialog.dismiss();
                    once.accept(d.getAddress());
                })
                .setNegativeButton("ยกเลิก", (dialog, which) -> once.accept(saved))
                .setOnCancelListener(dialog -> once.accept(saved))
                .show();
    }

    private void showBluetoothSettingsDialog(String title, String message, Consumer<String> once) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("เปิดตั้งค่าบลูทูธ", (d, w) -> {
                    try { startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); } catch (ActivityNotFoundException ignored) { }
                    once.accept(null);
                })
                .setNegativeButton("ปิด", (d, w) -> once.accept(null))
                .setOnCancelListener(d -> once.accept(null))
                .show();
    }

    @SuppressLint("MissingPermission")
    private static String nameOf(BluetoothDevice d) {
        String n = d.getName();
        return n == null || n.isEmpty() ? d.getAddress() : n;
    }

    @SuppressLint("MissingPermission")
    private static boolean isPrinter(BluetoothDevice d) {
        BluetoothClass c = d.getBluetoothClass();
        String n = nameOf(d).toLowerCase();
        return (c != null && c.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING)
                || n.contains("print") || n.contains("xp-") || n.contains("pos");
    }

    // ── results back to the web page ─────────────────────────────────────────

    void dispatchPrintResult(String requestId, boolean success, int completedCopies, String error) {
        try {
            JSONObject detail = new JSONObject()
                    .put("requestId", requestId)
                    .put("success", success)
                    .put("completedCopies", completedCopies);
            if (error != null) detail.put("error", error);
            pos.evaluateJavascript("window.dispatchEvent(new CustomEvent('bbpos-native-print-result',{detail:" + detail + "}));", null);
        } catch (Exception e) {
            Log.w(TAG, "print result", e);
        }
    }

    void showPrintError(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    // ── activity plumbing ────────────────────────────────────────────────────

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_BLUETOOTH && afterBluetoothPermission != null) {
            Runnable next = afterBluetoothPermission;
            afterBluetoothPermission = null;
            next.run();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (pos.canGoBack()) pos.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        pos.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        pos.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        pos.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /** Full screen: status and navigation bars come back with a swipe from the edge. */
    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        }
    }
}
