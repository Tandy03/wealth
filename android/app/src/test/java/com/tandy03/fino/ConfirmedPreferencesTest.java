package com.tandy03.fino;

import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class ConfirmedPreferencesTest {
    private static final class FakeDisk {
        final Map<String, String> memory = new HashMap<>(), disk = new HashMap<>();
        boolean failNext, throwNext, failEveryCommit;
        int commits;
        final SharedPreferences preferences = (SharedPreferences) Proxy.newProxyInstance(
            SharedPreferences.class.getClassLoader(), new Class<?>[] { SharedPreferences.class }, (proxy, method, args) -> {
                if (method.getName().equals("getString")) return memory.getOrDefault(args[0], (String) args[1]);
                if (method.getName().equals("edit")) return editor();
                throw new UnsupportedOperationException(method.getName());
            });
        SharedPreferences.Editor editor() {
            Map<String, String> changes = new HashMap<>();
            return (SharedPreferences.Editor) Proxy.newProxyInstance(
                SharedPreferences.Editor.class.getClassLoader(), new Class<?>[] { SharedPreferences.Editor.class }, (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "putString": changes.put((String) args[0], (String) args[1]); return proxy;
                        case "remove": changes.put((String) args[0], null); return proxy;
                        case "commit":
                            commits++;
                            // Android updates the memory cache before the disk result is known.
                            apply(memory, changes);
                            if (throwNext) { throwNext = false; throw new IllegalStateException("mock I/O failure"); }
                            if (failNext || failEveryCommit) { failNext = false; return false; }
                            apply(disk, changes); return true;
                        default: throw new UnsupportedOperationException(method.getName());
                    }
                });
        }
        void initial(String value) { memory.put("fino-journal", value); disk.put("fino-journal", value); }
        private static void apply(Map<String, String> target, Map<String, String> changes) {
            changes.forEach((key, value) -> { if (value == null) target.remove(key); else target.put(key, value); });
        }
    }

    @Test public void existingPreferencesMigrateAndWritesConfirmDisk() {
        FakeDisk fake = new FakeDisk(); fake.initial("old");
        ConfirmedPreferences storage = new ConfirmedPreferences(fake.preferences);
        assertEquals("old", storage.get("fino-journal"));
        storage.set("fino-journal", "new"); assertEquals("new", fake.disk.get("fino-journal"));
        storage.set("fino-journal", null); assertNull(storage.get("fino-journal")); assertFalse(fake.disk.containsKey("fino-journal"));
    }

    @Test public void failedDiskWriteRollsBackMemoryAndBlocksUnconfirmedReads() {
        FakeDisk fake = new FakeDisk(); fake.initial("old"); fake.failNext = true;
        ConfirmedPreferences storage = new ConfirmedPreferences(fake.preferences);
        assertThrows(IllegalStateException.class, () -> storage.set("fino-journal", "unconfirmed"));
        assertEquals("old", fake.memory.get("fino-journal")); assertEquals("old", fake.disk.get("fino-journal"));
        assertThrows(IllegalStateException.class, () -> storage.get("fino-journal"));
        assertThrows(IllegalStateException.class, () -> storage.set("fino-journal", "another"));
        assertEquals(2, fake.commits);
    }

    @Test public void thrownWriteFailureAndFailedRollbackRemainClosed() {
        FakeDisk fake = new FakeDisk(); fake.initial("old"); fake.throwNext = true; fake.failEveryCommit = true;
        ConfirmedPreferences storage = new ConfirmedPreferences(fake.preferences);
        assertThrows(IllegalStateException.class, () -> storage.set("fino-journal", "unconfirmed"));
        assertEquals("old", fake.memory.get("fino-journal")); assertEquals("old", fake.disk.get("fino-journal"));
        assertThrows(IllegalStateException.class, () -> storage.get("fino-journal"));
    }

    @Test public void failedFirstWriteAndFailedRemovalPreservePreviousData() {
        FakeDisk fresh = new FakeDisk(); fresh.failNext = true;
        assertThrows(IllegalStateException.class, () -> new ConfirmedPreferences(fresh.preferences).set("fino-journal", "new"));
        assertFalse(fresh.disk.containsKey("fino-journal")); assertFalse(fresh.memory.containsKey("fino-journal"));
        FakeDisk existing = new FakeDisk(); existing.initial("old"); existing.failNext = true;
        assertThrows(IllegalStateException.class, () -> new ConfirmedPreferences(existing.preferences).set("fino-journal", null));
        assertEquals("old", existing.disk.get("fino-journal")); assertEquals("old", existing.memory.get("fino-journal"));
    }
}
