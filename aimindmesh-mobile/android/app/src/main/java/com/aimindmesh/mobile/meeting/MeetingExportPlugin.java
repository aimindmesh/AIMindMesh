package com.aimindmesh.mobile.meeting;

import android.content.Context;
import android.content.Intent;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

/**
 * Native plugin for meeting export features:
 * - exportToPDF: renders HTML via WebView → PrintDocumentAdapter → PDF
 * - shareFile: wraps Intent.ACTION_SEND with FileProvider
 * - saveTextFile: writes text content to app files directory
 */
@CapacitorPlugin(name = "MeetingExport")
public class MeetingExportPlugin extends Plugin {

    private static final String TAG = "MeetingExportPlugin";

    @PluginMethod
    public void exportToPDF(PluginCall call) {
        String html = call.getString("html");
        String title = call.getString("title", "Meeting Transcript");

        if (html == null || html.isEmpty()) {
            call.reject("HTML content required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = new WebView(getContext());
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);

                        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(title);

                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();

                        printManager.print(title, adapter, attrs);
                        call.resolve();
                    }
                });

                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                Log.e(TAG, "PDF export failed", e);
                call.reject("PDF export failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String filePath = call.getString("filePath");
        String mimeType = call.getString("mimeType", "text/plain");
        String title = call.getString("title", "Share Meeting");

        if (filePath == null) {
            call.reject("filePath required");
            return;
        }

        try {
            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File not found: " + filePath);
                return;
            }

            android.net.Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getActivity().startActivity(Intent.createChooser(shareIntent, title));
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Share failed", e);
            call.reject("Share failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveTextFile(PluginCall call) {
        String content = call.getString("content");
        String filename = call.getString("filename");

        if (content == null || filename == null) {
            call.reject("content and filename required");
            return;
        }

        try {
            File dir = new File(getContext().getFilesDir(), "meeting-exports");
            if (!dir.exists())
                dir.mkdirs();

            File file = new File(dir, filename);
            FileWriter writer = new FileWriter(file);
            writer.write(content);
            writer.close();

            JSObject result = new JSObject();
            result.put("filePath", file.getAbsolutePath());
            call.resolve(result);
        } catch (IOException e) {
            Log.e(TAG, "Save failed", e);
            call.reject("Save failed: " + e.getMessage());
        }
    }
}
