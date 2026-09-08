package com.tandy03.fino;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.Executor;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public class MainActivity extends BridgeActivity {
    static final String LOCK_PREFERENCES = "fino_app_lock";
    static final String BIOMETRIC_ENABLED = "biometric_enabled";
    static final String LOCK_THEME = "lock_theme";
    private static final String PIN_SALT = "pin_salt";
    private static final String PIN_HASH = "pin_hash";
    private static final int PIN_ITERATIONS = 120_000;
    private static final int PIN_KEY_LENGTH = 256;

    private SharedPreferences lockPreferences;
    private AlertDialog lockDialog;
    private EditText[] lockInputs = new EditText[0];
    private boolean unlockedForThisLaunch = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleDriveAuthPlugin.class);
        registerPlugin(AppLockPlugin.class);
        super.onCreate(savedInstanceState);
        lockPreferences = getSharedPreferences(LOCK_PREFERENCES, MODE_PRIVATE);
        showLaunchLock();
    }

    private void showLaunchLock() {
        if (unlockedForThisLaunch || isFinishing()) return;
        if (hasPin()) showUnlockDialog();
        else showCreatePinDialog();
    }

    private boolean hasPin() {
        return lockPreferences.contains(PIN_SALT) && lockPreferences.contains(PIN_HASH);
    }

    private EditText createPinInput(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        input.setMaxEms(8);
        input.setPadding(0, 16, 0, 16);
        return input;
    }

    private LinearLayout createDialogContent(TextView error, EditText... fields) {
        int horizontalPadding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(horizontalPadding, 4, horizontalPadding, 0);
        for (EditText field : fields) content.addView(field);
        error.setTextColor(0xffd64255);
        error.setVisibility(View.GONE);
        content.addView(error);
        return content;
    }

    private void showCreatePinDialog() {
        EditText pin = createPinInput("Create PIN");
        EditText confirmation = createPinInput("Repeat PIN");
        TextView error = new TextView(this);

        lockDialog = new AlertDialog.Builder(this)
            .setTitle("Protect fino")
            .setMessage("Create a 4–8 digit PIN. You will also be able to unlock with your fingerprint.")
            .setView(createDialogContent(error, pin, confirmation))
            .setPositiveButton("Save PIN", null)
            .create();
        lockDialog.setCancelable(false);
        lockDialog.setCanceledOnTouchOutside(false);
        lockDialog.setOnShowListener(ignored -> {
            lockInputs = new EditText[] { pin, confirmation };
            styleLockDialog();
            lockDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                String first = pin.getText().toString();
                String second = confirmation.getText().toString();
                if (!first.matches("\\d{4,8}")) {
                    showPinError(error, "PIN must contain 4–8 digits.");
                    return;
                }
                if (!first.equals(second)) {
                    showPinError(error, "PINs do not match.");
                    confirmation.setText("");
                    confirmation.requestFocus();
                    return;
                }
                savePin(first);
                unlock();
            });
            focusAndShowKeyboard(pin);
        });
        lockDialog.show();
    }

    private void showUnlockDialog() {
        EditText pin = createPinInput("PIN");
        TextView error = new TextView(this);
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle("Unlock fino")
            .setMessage("Enter your PIN or use your fingerprint.")
            .setView(createDialogContent(error, pin))
            .setPositiveButton("Unlock", null);

        if (canUseBiometrics()) builder.setNeutralButton("Fingerprint", null);
        lockDialog = builder.create();
        lockDialog.setCancelable(false);
        lockDialog.setCanceledOnTouchOutside(false);
        lockDialog.setOnShowListener(ignored -> {
            lockInputs = new EditText[] { pin };
            styleLockDialog();
            lockDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if (verifyPin(pin.getText().toString())) {
                    unlock();
                } else {
                    pin.setText("");
                    showPinError(error, "Incorrect PIN.");
                    focusAndShowKeyboard(pin);
                }
            });
            if (canUseBiometrics()) {
                lockDialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> authenticateBiometrically());
                authenticateBiometrically();
            } else {
                focusAndShowKeyboard(pin);
            }
        });
        lockDialog.show();
    }

    private boolean canUseBiometrics() {
        if (!lockPreferences.getBoolean(BIOMETRIC_ENABLED, true)) return false;
        int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK;
        return BiometricManager.from(this).canAuthenticate(authenticators)
            == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void authenticateBiometrically() {
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                unlock();
            }
        });
        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock fino")
            .setSubtitle("Confirm your fingerprint")
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.BIOMETRIC_WEAK
            )
            .setNegativeButtonText("Use PIN")
            .build();
        prompt.authenticate(promptInfo);
    }

    private void showPinError(TextView error, String message) {
        error.setText(message);
        error.setVisibility(View.VISIBLE);
    }

    private void focusAndShowKeyboard(EditText input) {
        input.requestFocus();
        input.postDelayed(() -> {
            InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 180);
    }

    private void unlock() {
        unlockedForThisLaunch = true;
        if (lockDialog != null) {
            lockDialog.dismiss();
            lockDialog = null;
        }
        lockInputs = new EditText[0];
    }

    public void updateLockTheme(String theme) {
        lockPreferences.edit().putString(LOCK_THEME, theme).apply();
        runOnUiThread(this::styleLockDialog);
    }

    private void styleLockDialog() {
        if (lockDialog == null || !lockDialog.isShowing()) return;
        LockPalette palette = LockPalette.forName(lockPreferences.getString(LOCK_THEME, "dark"));
        Window window = lockDialog.getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.dimAmount = 1f;
            window.setAttributes(attributes);
            window.setBackgroundDrawable(new ColorDrawable(palette.background));
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.getDecorView().setBackgroundColor(palette.background);
        }

        int panelId = getResources().getIdentifier("parentPanel", "id", "android");
        View panel = lockDialog.findViewById(panelId);
        if (panel != null) panel.setBackground(roundedBackground(palette.surface, 22));
        int titleId = getResources().getIdentifier("alertTitle", "id", "android");
        TextView title = lockDialog.findViewById(titleId);
        TextView message = lockDialog.findViewById(android.R.id.message);
        if (title != null) title.setTextColor(palette.text);
        if (message != null) message.setTextColor(palette.muted);

        for (EditText input : lockInputs) {
            input.setTextColor(palette.text);
            input.setHintTextColor(palette.muted);
            input.setBackground(roundedBackground(palette.secondary, 12));
            int padding = dp(14);
            input.setPadding(padding, dp(12), padding, dp(12));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            params.setMargins(0, dp(6), 0, dp(6));
            input.setLayoutParams(params);
        }
        for (int which : new int[] { AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEUTRAL, AlertDialog.BUTTON_NEGATIVE }) {
            Button button = lockDialog.getButton(which);
            if (button != null) {
                button.setTextColor(palette.accent);
                button.setAllCaps(false);
            }
        }
    }

    private GradientDrawable roundedBackground(int color, int radiusDp) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radiusDp));
        return background;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class LockPalette {
        final int background;
        final int surface;
        final int secondary;
        final int text;
        final int muted;
        final int accent;

        LockPalette(String background, String surface, String secondary, String text, String muted, String accent) {
            this.background = Color.parseColor(background);
            this.surface = Color.parseColor(surface);
            this.secondary = Color.parseColor(secondary);
            this.text = Color.parseColor(text);
            this.muted = Color.parseColor(muted);
            this.accent = Color.parseColor(accent);
        }

        static LockPalette forName(String name) {
            if ("light".equals(name)) return new LockPalette("#f5f7fb", "#ffffff", "#f0f3f8", "#1e2735", "#657084", "#596bdf");
            if ("monochromatic".equals(name)) return new LockPalette("#0c0c18", "#141426", "#1c1c34", "#f4f4ff", "#aaaacd", "#5656fb");
            if ("analog".equals(name)) return new LockPalette("#16406B", "#3B6DA3", "#2B5B8F", "#f5f5ff", "#a7acce", "#8888E3");
            return new LockPalette("#0b0d11", "#11141a", "#171b22", "#f2f4f7", "#8b93a1", "#7c8cff");
        }
    }

    private void savePin(String pin) {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        byte[] hash = derivePinHash(pin, salt);
        lockPreferences.edit()
            .putString(PIN_SALT, android.util.Base64.encodeToString(salt, android.util.Base64.NO_WRAP))
            .putString(PIN_HASH, android.util.Base64.encodeToString(hash, android.util.Base64.NO_WRAP))
            .apply();
        Arrays.fill(hash, (byte) 0);
    }

    private boolean verifyPin(String pin) {
        try {
            byte[] salt = android.util.Base64.decode(lockPreferences.getString(PIN_SALT, ""), android.util.Base64.NO_WRAP);
            byte[] expected = android.util.Base64.decode(lockPreferences.getString(PIN_HASH, ""), android.util.Base64.NO_WRAP);
            byte[] actual = derivePinHash(pin, salt);
            boolean matches = MessageDigest.isEqual(expected, actual);
            Arrays.fill(actual, (byte) 0);
            return matches;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private byte[] derivePinHash(String pin, byte[] salt) {
        PBEKeySpec specification = new PBEKeySpec(pin.toCharArray(), salt, PIN_ITERATIONS, PIN_KEY_LENGTH);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(specification).getEncoded();
        } catch (Exception error) {
            throw new IllegalStateException("Unable to secure PIN", error);
        } finally {
            specification.clearPassword();
        }
    }
}
