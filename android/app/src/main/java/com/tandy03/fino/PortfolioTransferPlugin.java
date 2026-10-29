package com.tandy03.fino;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Explicit system document picker only; never creates or uploads a background export. */
@CapacitorPlugin(name = "PortfolioTransfer")
public class PortfolioTransferPlugin extends Plugin {
    private static final int MAX_BYTES = 1024 * 1024;
    private final AtomicBoolean selecting = new AtomicBoolean();
    private volatile byte[] exportBytes;

    @PluginMethod
    public void exportFile(PluginCall call) {
        String text = call.getString("text");
        byte[] bytes = text == null ? null : text.getBytes(StandardCharsets.UTF_8);
        if (bytes == null || bytes.length > MAX_BYTES) {
            call.reject("Portfolio files must be JSON of at most 1 MiB.", "VALIDATION_FAILURE"); return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json").putExtra(Intent.EXTRA_TITLE, "fino-portfolio.json");
        select(call, intent, "exportSelected", bytes);
    }

    @PluginMethod
    public void importFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json");
        select(call, intent, "importSelected", null);
    }

    private void select(PluginCall call, Intent intent, String callback, byte[] bytes) {
        if (!selecting.compareAndSet(false, true)) { call.reject("A file selection is already open.", "CONFLICT"); return; }
        exportBytes = bytes;
        // Capacitor persists pending call options in Activity saved state.
        // Keep financial JSON out of that Bundle and its Binder size limit.
        call.getData().remove("text");
        try { startActivityForResult(call, intent, callback); }
        catch (RuntimeException error) { clearExport(); selecting.set(false); call.reject("The document picker is unavailable.", "STORAGE_FAILURE"); }
    }

    private void clearExport() {
        byte[] bytes = exportBytes; exportBytes = null;
        if (bytes != null) Arrays.fill(bytes, (byte) 0);
    }

    private boolean cancelled(PluginCall call, ActivityResult result) {
        if (call == null) { clearExport(); selecting.set(false); return true; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            clearExport(); selecting.set(false); call.resolve(new JSObject().put("cancelled", true)); return true;
        }
        return false;
    }

    @ActivityCallback
    private void exportSelected(PluginCall call, ActivityResult result) {
        if (cancelled(call, result)) return;
        getBridge().execute(() -> {
            try {
                byte[] bytes = exportBytes;
                if (bytes == null) throw new IllegalStateException(); // Picker/activity was recreated; retry explicitly.
                try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                    if (stream == null) throw new IllegalStateException();
                    stream.write(bytes);
                    stream.flush();
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { call.reject("Could not save the portfolio file.", "STORAGE_FAILURE"); }
            finally { clearExport(); selecting.set(false); }
        });
    }

    @ActivityCallback
    private void importSelected(PluginCall call, ActivityResult result) {
        if (cancelled(call, result)) return;
        getBridge().execute(() -> {
            try {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (InputStream stream = getContext().getContentResolver().openInputStream(result.getData().getData())) {
                    if (stream == null) throw new IllegalStateException();
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (bytes.size() + count > MAX_BYTES) {
                            call.reject("Portfolio files must be JSON of at most 1 MiB.", "VALIDATION_FAILURE"); return;
                        }
                        bytes.write(buffer, 0, count);
                    }
                }
                call.resolve(new JSObject().put("text", bytes.toString(StandardCharsets.UTF_8.name())));
            } catch (Exception error) { call.reject("Could not read the portfolio file.", "STORAGE_FAILURE"); }
            finally { selecting.set(false); }
        });
    }
}
