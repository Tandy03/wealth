package com.tandy03.fino;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.Scope;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    private final ExecutorService tokenExecutor = Executors.newSingleThreadExecutor();

    private GoogleSignInClient signInClient() {
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail().requestScopes(new Scope(DRIVE_SCOPE)).build();
        return GoogleSignIn.getClient(getContext(), options);
    }

    @PluginMethod
    public void getAccessToken(PluginCall call) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null || !GoogleSignIn.hasPermissions(account, new Scope(DRIVE_SCOPE))) {
            startActivityForResult(call, signInClient().getSignInIntent(), "signInResult");
            return;
        }
        resolveToken(call, account);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        signInClient().signOut()
            .addOnSuccessListener(ignored -> call.resolve())
            .addOnFailureListener(error -> call.reject("Could not sign out of Google.", "AUTHORIZATION_REQUIRED"));
    }

    @ActivityCallback
    private void signInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Google authorization was cancelled.", "AUTHORIZATION_REQUIRED");
            return;
        }
        GoogleSignIn.getSignedInAccountFromIntent(result.getData())
            .addOnSuccessListener(account -> resolveToken(call, account))
            .addOnFailureListener(error -> call.reject("Google authorization failed.", "AUTHORIZATION_REQUIRED"));
    }

    private void resolveToken(PluginCall call, GoogleSignInAccount account) {
        tokenExecutor.execute(() -> {
            try {
                String token = GoogleAuthUtil.getToken(
                    getContext(), account.getAccount(), "oauth2:" + DRIVE_SCOPE);
                JSObject response = new JSObject();
                response.put("accessToken", token);
                response.put("email", account.getEmail());
                call.resolve(response);
            } catch (UserRecoverableAuthException error) {
                getActivity().runOnUiThread(() -> startActivityForResult(call, error.getIntent(), "recoverToken"));
            } catch (IOException | GoogleAuthException error) {
                call.reject("Could not obtain a Google Drive token.", "AUTHORIZATION_REQUIRED");
            } catch (RuntimeException error) {
                call.reject("Could not obtain a Google Drive token.", "AUTHORIZATION_REQUIRED");
            }
        });
    }

    @ActivityCallback
    private void recoverToken(PluginCall call, ActivityResult result) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || account == null) {
            call.reject("Google authorization was cancelled.", "AUTHORIZATION_REQUIRED");
            return;
        }
        resolveToken(call, account);
    }

    @Override
    protected void handleOnDestroy() {
        tokenExecutor.shutdownNow();
    }
}
