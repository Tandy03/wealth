package com.tandy03.fino;

import android.content.Intent;
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
import com.google.android.gms.tasks.Tasks;
import java.io.IOException;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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
            .addOnFailureListener(error -> call.reject("Could not sign out of Google.", error));
    }

    @ActivityCallback
    private void signInResult(PluginCall call, ActivityResult result) {
        if (call == null || result.getData() == null) return;
        GoogleSignIn.getSignedInAccountFromIntent(result.getData())
            .addOnSuccessListener(account -> resolveToken(call, account))
            .addOnFailureListener(error -> call.reject("Google authorization failed.", error));
    }

    private void resolveToken(PluginCall call, GoogleSignInAccount account) {
        Executors.newSingleThreadExecutor().execute(() -> {
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
                call.reject("Could not obtain a Google Drive token.", error);
            }
        });
    }

    @ActivityCallback
    private void recoverToken(PluginCall call, ActivityResult result) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (call == null || account == null) return;
        resolveToken(call, account);
    }
}
