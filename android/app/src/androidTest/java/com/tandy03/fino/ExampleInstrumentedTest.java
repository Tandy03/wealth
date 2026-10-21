package com.tandy03.fino;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.Uri;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethodHandle;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Run on a dedicated test emulator. Never opens OAuth, changes the PIN, or uses
 * portfolio/account keys. Storage probes use a unique key and clean it up.
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.tandy03.fino", appContext.getPackageName());
    }

    @Test
    public void bridgeRegistersNativeContractsAndUsesLocalWebView() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertEquals("https", Uri.parse(activity.getBridge().getLocalUrl()).getScheme());
                assertEquals("localhost", Uri.parse(activity.getBridge().getLocalUrl()).getHost());
                assertPlugin(activity, "FinoStorage", FinoStoragePlugin.class, "get", "set", "remove");
                assertPlugin(activity, "PortfolioTransfer", PortfolioTransferPlugin.class, "exportFile", "importFile");
                assertPlugin(activity, "PortfolioShare", PortfolioSharePlugin.class, "savePng", "sharePng");
                assertPlugin(activity, "AppLock", AppLockPlugin.class, "getSettings", "setBiometricEnabled", "setTheme");
                assertPlugin(activity, "GoogleDriveAuth", GoogleDriveAuthPlugin.class, "getAccessToken", "signOut");
                assertNotNull(activity.getBridge().getPlugin("Preferences"));
                assertNotNull(activity.getBridge().getPlugin("Network"));
                assertNotNull(activity.getBridge().getPlugin("App"));
            });
        }
    }

    @Test
    public void pngPluginRejectsInvalidInputWithoutOpeningAFileActivity() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            for (String method : new String[] { "savePng", "sharePng" }) {
                JSObject options = new JSObject().put("name", "fino-portfolio-2026-10-21.png").put("mimeType", "image/png").put("base64", "not-a-png");
                CapturedCall result = invoke(scenario, "PortfolioShare", method, options);
                assertEquals("VALIDATION_FAILURE", result.errorCode);
                assertFalse("PNG bytes must not survive in persisted Activity options", result.getData().has("base64"));
            }
        }
    }

    @Test
    public void confirmedStorageRoundTripSurvivesActivityRecreation() throws Exception {
        String key = "fino-instrumentation-" + UUID.randomUUID();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                invoke(scenario, "FinoStorage", "set", new JSObject().put("key", key).put("value", "synthetic-probe")).assertSuccess();
                scenario.recreate();
                CapturedCall read = invoke(scenario, "FinoStorage", "get", new JSObject().put("key", key));
                read.assertSuccess();
                assertEquals("synthetic-probe", read.result.getString("value"));
                invoke(scenario, "FinoStorage", "remove", new JSObject().put("key", key)).assertSuccess();
                CapturedCall removed = invoke(scenario, "FinoStorage", "get", new JSObject().put("key", key));
                removed.assertSuccess();
                assertTrue(removed.result.isNull("value"));
            } finally {
                invoke(scenario, "FinoStorage", "remove", new JSObject().put("key", key)).assertSuccess();
            }
        }
    }

    @Test
    public void storageRejectsInvalidCallsAndLockSettingsHaveStableTypes() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CapturedCall invalidKey = invoke(scenario, "FinoStorage", "set", new JSObject().put("key", "instrumentation-invalid").put("value", "probe"));
            assertEquals("VALIDATION_FAILURE", invalidKey.errorCode);
            CapturedCall missingValue = invoke(scenario, "FinoStorage", "set", new JSObject().put("key", "fino-instrumentation-" + UUID.randomUUID()));
            assertEquals("VALIDATION_FAILURE", missingValue.errorCode);
            CapturedCall settings = invoke(scenario, "AppLock", "getSettings", new JSObject());
            settings.assertSuccess();
            assertTrue(settings.result.get("biometricEnabled") instanceof Boolean);
            assertTrue(settings.result.get("biometricAvailable") instanceof Boolean);
        }
    }

    @Test
    public void offlineDomainAndFrontendResourcesArePackaged() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String resource : new String[] { "index.html", "shared/state-contract.js", "shared/state-model.js", "shared/portfolio-rules.js", "js/state-store.js", "js/mobile-api.js" }) {
            try (InputStream stream = context.getAssets().open("public/" + resource)) {
                assertTrue("Missing packaged resource: " + resource, stream.read() != -1);
            }
        }
    }

    private static void assertPlugin(MainActivity activity, String id, Class<?> expected, String... methods) {
        PluginHandle handle = activity.getBridge().getPlugin(id);
        assertNotNull("Missing plugin: " + id, handle);
        assertEquals(expected, handle.getPluginClass());
        Set<String> registered = new HashSet<>();
        for (PluginMethodHandle method : handle.getMethods()) registered.add(method.getName());
        for (String method : methods) assertTrue("Missing native method: " + id + "." + method, registered.contains(method));
    }

    private static CapturedCall invoke(ActivityScenario<MainActivity> scenario, String plugin, String method, JSObject data) throws InterruptedException {
        CapturedCall call = new CapturedCall(plugin, method, data);
        scenario.onActivity(activity -> {
            try { activity.getBridge().getPlugin(plugin).invoke(method, call); }
            catch (Exception error) { throw new AssertionError("Native invocation failed: " + plugin + "." + method, error); }
        });
        assertTrue("Native call did not settle: " + plugin + "." + method, call.completed.await(5, TimeUnit.SECONDS));
        return call;
    }

    private static final class CapturedCall extends PluginCall {
        final CountDownLatch completed = new CountDownLatch(1);
        JSObject result;
        String errorCode;
        CapturedCall(String plugin, String method, JSObject data) { super(null, plugin, "instrumentation", method, data); }
        @Override public void resolve(JSObject value) { result = value; completed.countDown(); }
        @Override public void resolve() { resolve(new JSObject()); }
        @Override public void reject(String message, String code, Exception error, JSObject data) { errorCode = code; completed.countDown(); }
        void assertSuccess() { assertNull("Native call was rejected", errorCode); assertNotNull("Native call did not resolve", result); }
    }
}
