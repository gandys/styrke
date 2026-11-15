package com.gabriel.styrke;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/**
 * Styrke is a web app packaged for Android. This activity hosts it in a WebView, serves the
 * bundled page from a fixed https origin (so storage is stable and secure-context APIs work),
 * and gives the page a small bridge for backup files, sharing and keeping the screen on.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final String FOLDER = "Styrke";
    private static final int PICK_FILE = 41;
    private static final int KEEP_BACKUPS = 14;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        final int ink = Color.rgb(19, 28, 38);
        getWindow().setStatusBarColor(ink);
        getWindow().setNavigationBarColor(ink);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(ink);
        web = new WebView(this);
        web.setBackgroundColor(ink);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Keep the page clear of the status bar, navigation bar and the on-screen keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets in = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                left = in.left; top = in.top; right = in.right; bottom = in.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.length() < 2) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    String ext = MimeTypeMap.getFileExtensionFromUrl(path);
                    String mime = "html".equals(ext) ? "text/html" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                    if (mime == null) mime = "application/octet-stream";
                    return new WebResourceResponse(mime, "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, "Choose a file"), PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl(START);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    /** Back closes sheets and sub-pages inside the app first; only then leaves. */
    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript(
                "(function(){try{return window.styrkeBack&&window.styrkeBack()?1:0}catch(e){return 0}})()",
                value -> { if (!"1".equals(value)) finish(); });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Writes a text file to Download/Styrke through MediaStore (no storage permission needed). */
    private Uri writeDownload(String name, String text, String mime, boolean replace) {
        try {
            ContentResolver cr = getContentResolver();
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            if (replace) {
                try {
                    cr.delete(collection,
                            MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                            new String[]{name, "%" + FOLDER + "%"});
                } catch (Exception ignored) { }
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
            Uri uri = cr.insert(collection, values);
            if (uri == null) return null;
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) return null;
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            return uri;
        } catch (Exception e) {
            return null;
        }
    }

    /** Keeps the newest backups this install wrote and removes older ones. */
    private void pruneBackups() {
        try {
            ContentResolver cr = getContentResolver();
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            try (Cursor c = cr.query(collection, new String[]{MediaStore.MediaColumns._ID},
                    MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                    new String[]{"styrke-backup-%", "%" + FOLDER + "%"},
                    MediaStore.MediaColumns.DATE_ADDED + " DESC")) {
                if (c == null) return;
                int i = 0;
                while (c.moveToNext()) {
                    if (i++ >= KEEP_BACKUPS) cr.delete(ContentUris.withAppendedId(collection, c.getLong(0)), null, null);
                }
            }
        } catch (Exception ignored) { }
    }

    /** Methods the page can call as window.Android.* */
    public class Bridge {
        @JavascriptInterface
        public String saveFile(String name, String text, String mime) {
            return writeDownload(name, text, mime, false) == null ? "" : "Download/" + FOLDER + "/" + name;
        }

        @JavascriptInterface
        public String saveBackup(String name, String text) {
            Uri uri = writeDownload(name, text, "application/json", true);
            if (uri == null) return "";
            pruneBackups();
            return "Download/" + FOLDER + "/" + name;
        }

        @JavascriptInterface
        public void shareFile(String name, String text, final String mime) {
            final Uri uri = writeDownload(name, text, mime, true);
            if (uri == null) return;
            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "Share"));
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
