package com.tandy03.fino;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Same private storage as Preferences, with disk confirmation before reporting a financial commit. */
@CapacitorPlugin(name = "FinoStorage")
public class FinoStoragePlugin extends Plugin {
    private ConfirmedPreferences preferences;
    private ConfirmedPreferences storage() {
        if (preferences == null) preferences = new ConfirmedPreferences(getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE));
        return preferences;
    }
    private String key(PluginCall call) {
        String value = call.getString("key");
        if (value == null || !value.startsWith("fino-")) {
            call.reject("Invalid storage key.", "VALIDATION_FAILURE");
            return null;
        }
        return value;
    }
    @PluginMethod
    public void get(PluginCall call) {
        String key = key(call); if (key == null) return;
        getBridge().execute(() -> {
            try {
                JSObject result = new JSObject(); result.put("value", storage().get(key)); call.resolve(result);
            } catch (RuntimeException error) { call.reject("Local storage read failed.", "STORAGE_FAILURE"); }
        });
    }
    @PluginMethod
    public void set(PluginCall call) {
        String key = key(call), value = call.getString("value"); if (key == null) return;
        if (value == null) { call.reject("A storage value is required.", "VALIDATION_FAILURE"); return; }
        getBridge().execute(() -> {
            try {
                storage().set(key, value); call.resolve();
            } catch (RuntimeException error) { call.reject("Local storage write failed.", "STORAGE_FAILURE"); }
        });
    }
    @PluginMethod
    public void remove(PluginCall call) {
        String key = key(call); if (key == null) return;
        getBridge().execute(() -> {
            try {
                storage().set(key, null); call.resolve();
            } catch (RuntimeException error) { call.reject("Local storage write failed.", "STORAGE_FAILURE"); }
        });
    }
}
