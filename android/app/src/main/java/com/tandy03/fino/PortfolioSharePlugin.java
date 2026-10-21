package com.tandy03.fino;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Explicit PNG save/share only. Never receives a portfolio or initiates network requests. */
@CapacitorPlugin(name = "PortfolioShare")
public final class PortfolioSharePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicReference<Operation> active = new AtomicReference<>();
    private volatile boolean destroyed;
    private Context appContext;

    private static final class Operation {
        final PluginCall call;
        final boolean share;
        final AtomicBoolean settled = new AtomicBoolean();
        volatile boolean interrupted, exposed;
        volatile byte[] bytes;
        volatile File file;
        Operation(PluginCall call, boolean share) { this.call = call; this.share = share; }
    }

    @Override public void load() {
        appContext = getContext().getApplicationContext();
        worker.execute(() -> { try { PngShareFiles.cleanup(appContext.getCacheDir(), System.currentTimeMillis()); } catch (Exception ignored) { /* No paths/payloads in logs. */ } });
    }

    @PluginMethod public void savePng(PluginCall call) { begin(call, false); }
    @PluginMethod public void sharePng(PluginCall call) { begin(call, true); }

    private void begin(PluginCall call, boolean share) {
        String encoded = call.getString("base64"), name = call.getString("name"), mime = call.getString("mimeType");
        // Capacitor saves pending call options into an Activity Bundle. Strip
        // image data before registering any external activity or worker task.
        call.getData().remove("base64");
        Operation operation = new Operation(call, share);
        if (destroyed) { call.reject("PNG operation interrupted. Retry explicitly.", "OPERATION_INTERRUPTED"); return; }
        if (!active.compareAndSet(null, operation)) { call.reject("A PNG operation is already open.", "CONFLICT"); return; }
        try { worker.execute(() -> prepare(operation, encoded, name, mime)); }
        catch (RejectedExecutionException ignored) { fail(operation, "OPERATION_INTERRUPTED"); }
    }

    private void prepare(Operation operation, String encoded, String name, String mime) {
        byte[] bytes = null;
        try {
            if (destroyed || operation.interrupted) { fail(operation, "OPERATION_INTERRUPTED"); return; }
            if (!"image/png".equals(mime)) throw new IllegalArgumentException();
            PngShareFiles.filename(name);
            int expected = PngShareFiles.base64Length(encoded);
            bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length != expected) throw new IllegalArgumentException();
            PngShareFiles.validate(bytes);
            if (destroyed || operation.interrupted) { fail(operation, "OPERATION_INTERRUPTED"); return; }
            if (operation.share) operation.file = PngShareFiles.create(appContext.getCacheDir(), bytes, name, System.currentTimeMillis());
            else { operation.bytes = bytes; bytes = null; }
            getBridge().executeOnMainThread(() -> openSystemDialog(operation, name));
        } catch (IllegalArgumentException error) { fail(operation, "VALIDATION_FAILURE"); }
        catch (PngShareFiles.CacheFullException error) { fail(operation, "SHARE_CACHE_FULL"); }
        catch (Exception error) { fail(operation, "STORAGE_FAILURE"); }
        finally { if (bytes != null) Arrays.fill(bytes, (byte)0); }
    }

    private void openSystemDialog(Operation operation, String name) {
        Activity activity = getActivity();
        if (destroyed || operation.interrupted || activity == null || activity.isFinishing() || activity.isDestroyed()) { fail(operation, "OPERATION_INTERRUPTED"); return; }
        try {
            if (!operation.share) {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("image/png").putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(operation.call, intent, "saveSelected");
            } else {
                Uri uri = FileProvider.getUriForFile(appContext, appContext.getPackageName() + ".portfolio-share", operation.file);
                Intent send = new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newUri(appContext.getContentResolver(), "PNG", uri));
                if (send.resolveActivity(activity.getPackageManager()) == null) { fail(operation, "NO_SHARE_TARGET"); return; }
                Intent chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.setClipData(send.getClipData());
                operation.exposed = true;
                try { startActivityForResult(operation.call, chooser, "shareFinished"); }
                catch (RuntimeException error) { operation.exposed = false; throw error; }
            }
        } catch (Exception error) { fail(operation, operation.share ? "SHARE_UNAVAILABLE" : "STORAGE_FAILURE"); }
    }

    @ActivityCallback private void saveSelected(PluginCall call, ActivityResult result) {
        Operation operation = current(call);
        if (operation == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finish(operation, new JSObject().put("status", "cancelled").put("cancelled", true).put("saved", false), null); return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || !"content".equals(uri.getScheme())) { fail(operation, "STORAGE_FAILURE"); return; }
        try { worker.execute(() -> {
            byte[] bytes = operation.bytes; operation.bytes = null;
            try {
                if (bytes == null || destroyed || operation.interrupted) { fail(operation, "OPERATION_INTERRUPTED"); return; }
                PngShareFiles.write(bytes, () -> appContext.getContentResolver().openOutputStream(uri, "wt"),
                    () -> destroyed || operation.interrupted);
                if (destroyed || operation.interrupted) fail(operation, "OPERATION_INTERRUPTED");
                else finish(operation, new JSObject().put("status", "saved").put("saved", true).put("cancelled", false), null);
            } catch (Exception error) { fail(operation, destroyed || operation.interrupted ? "OPERATION_INTERRUPTED" : "STORAGE_FAILURE"); }
            finally { if (bytes != null) Arrays.fill(bytes, (byte)0); }
        }); } catch (RejectedExecutionException ignored) { fail(operation, "OPERATION_INTERRUPTED"); }
    }

    @ActivityCallback private void shareFinished(PluginCall call, ActivityResult result) {
        Operation operation = current(call);
        if (operation == null) return;
        // Chooser/recipient RESULT_CANCELED is not a reliable delivery or
        // cancellation acknowledgement. Never claim that the file was sent.
        finish(operation, new JSObject().put("status", "dialog-closed").put("opened", true).put("deliveryConfirmed", false), null);
    }

    private Operation current(PluginCall call) {
        Operation operation = active.get();
        if (operation != null && operation.call == call) return operation;
        if (call != null) call.reject("PNG operation interrupted. Retry explicitly.", "OPERATION_INTERRUPTED");
        else if (operation != null) fail(operation, "OPERATION_INTERRUPTED");
        return null;
    }

    private void fail(Operation operation, String code) { finish(operation, null, code); }
    private void finish(Operation operation, JSObject result, String code) {
        if (!operation.settled.compareAndSet(false, true)) return;
        active.compareAndSet(operation, null);
        try { worker.execute(() -> clear(operation)); } catch (RejectedExecutionException ignored) { /* Destroy already queued cleanup. */ }
        if (code == null) operation.call.resolve(result);
        else operation.call.reject("PNG operation could not complete.", code);
    }
    private void clear(Operation operation) {
        byte[] bytes = operation.bytes; operation.bytes = null;
        if (bytes != null) Arrays.fill(bytes, (byte)0);
        File file = operation.file; operation.file = null;
        if (file != null && !operation.exposed) file.delete();
    }

    @Override protected Bundle saveInstanceState() {
        // Only a neutral marker. No PNG, base64, URI, financial values or path.
        Bundle state = new Bundle(); state.putBoolean("pngInterrupted", true); return state;
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        Operation operation = active.get();
        if (operation != null) { operation.interrupted = true; fail(operation, "OPERATION_INTERRUPTED"); }
        worker.shutdown(); // Allow already-queued cleanup; never retain a destroyed Activity.
    }
}
