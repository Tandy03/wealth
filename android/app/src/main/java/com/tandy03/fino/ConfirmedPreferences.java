package com.tandy03.fino;

import android.content.SharedPreferences;

/** Never expose a failed disk commit as a successful in-memory journal write. */
final class ConfirmedPreferences {
    private final SharedPreferences preferences;
    private boolean failed;

    ConfirmedPreferences(SharedPreferences preferences) { this.preferences = preferences; }

    synchronized String get(String key) {
        requireAvailable();
        return preferences.getString(key, null);
    }

    synchronized void set(String key, String value) {
        requireAvailable();
        String previous = preferences.getString(key, null);
        try {
            if (editor(key, value).commit()) return;
        } catch (RuntimeException error) {
            // commit() can change memory before the disk write fails.
        }
        failed = true;
        try { editor(key, previous).commit(); } catch (RuntimeException ignored) {}
        throw new IllegalStateException("Local disk commit failed. Restart after restoring storage availability.");
    }

    private SharedPreferences.Editor editor(String key, String value) {
        SharedPreferences.Editor editor = preferences.edit();
        return value == null ? editor.remove(key) : editor.putString(key, value);
    }

    private void requireAvailable() {
        if (failed) throw new IllegalStateException("Local disk confirmation is unavailable.");
    }
}
