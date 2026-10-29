package com.tandy03.fino;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.biometric.BiometricManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(MainActivity.LOCK_PREFERENCES, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void getSettings(PluginCall call) {
        int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK;
        boolean available = BiometricManager.from(getContext()).canAuthenticate(authenticators)
            == BiometricManager.BIOMETRIC_SUCCESS;
        JSObject result = new JSObject();
        result.put("biometricEnabled", preferences().getBoolean(MainActivity.BIOMETRIC_ENABLED, true));
        result.put("biometricAvailable", available);
        call.resolve(result);
    }

    @PluginMethod
    public void setBiometricEnabled(PluginCall call) {
        preferences().edit()
            .putBoolean(MainActivity.BIOMETRIC_ENABLED, call.getBoolean("enabled", true))
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = call.getString("theme", "dark");
        preferences().edit().putString(MainActivity.LOCK_THEME, theme).apply();
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).updateLockTheme(theme);
        }
        call.resolve();
    }
}
