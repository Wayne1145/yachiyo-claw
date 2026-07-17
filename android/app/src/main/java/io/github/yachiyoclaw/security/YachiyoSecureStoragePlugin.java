package io.github.yachiyoclaw.security;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "YachiyoSecureStorage")
public final class YachiyoSecureStoragePlugin extends Plugin {

    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "io.github.yachiyoclaw.settings.aes_gcm.v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String ENVELOPE_PREFIX = "yachiyo-secure-storage:";
    private static final String ENVELOPE_ALGORITHM = "AES-256-GCM";
    private static final int ENVELOPE_VERSION = 1;
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;
    private static final byte[] SETTINGS_AAD = "io.github.yachiyoclaw/settings/v1".getBytes(StandardCharsets.UTF_8);

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plaintext = call.getString("plaintext");
        if (plaintext == null) {
            call.reject("Secure storage input is required.", "SECURE_STORAGE_INVALID_INPUT");
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            // AndroidKeyStore creates a fresh random nonce. GCM on Android uses the required 96-bit IV.
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != GCM_IV_BYTES) {
                throw new IllegalStateException("Unexpected GCM IV length");
            }
            cipher.updateAAD(SETTINGS_AAD);
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            JSONObject payload = new JSONObject();
            payload.put("version", ENVELOPE_VERSION);
            payload.put("algorithm", ENVELOPE_ALGORITHM);
            payload.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            payload.put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP));

            JSObject result = new JSObject();
            result.put("envelope", ENVELOPE_PREFIX + payload);
            call.resolve(result);
        } catch (Exception ignored) {
            // Never forward crypto-provider details because they can expose key aliases or input fragments.
            call.reject("Secure storage encryption failed.", "SECURE_STORAGE_ENCRYPT_FAILED");
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String envelope = call.getString("envelope");
        if (envelope == null) {
            call.reject("Secure storage input is required.", "SECURE_STORAGE_INVALID_INPUT");
            return;
        }

        try {
            JSONObject payload = parseEnvelope(envelope);
            byte[] iv = Base64.decode(payload.getString("iv"), Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP);
            if (iv.length != GCM_IV_BYTES || ciphertext.length < GCM_TAG_BITS / Byte.SIZE) {
                throw new IllegalArgumentException("Invalid encrypted payload");
            }

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            cipher.updateAAD(SETTINGS_AAD);
            byte[] plaintext = cipher.doFinal(ciphertext);

            JSObject result = new JSObject();
            result.put("plaintext", new String(plaintext, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception ignored) {
            call.reject("Secure storage decryption failed.", "SECURE_STORAGE_DECRYPT_FAILED");
        }
    }

    private static JSONObject parseEnvelope(String envelope) throws Exception {
        if (!envelope.startsWith(ENVELOPE_PREFIX)) {
            throw new IllegalArgumentException("Invalid encrypted envelope");
        }

        JSONObject payload = new JSONObject(envelope.substring(ENVELOPE_PREFIX.length()));
        if (
            payload.getInt("version") != ENVELOPE_VERSION ||
            !ENVELOPE_ALGORITHM.equals(payload.getString("algorithm")) ||
            !payload.has("iv") ||
            !payload.has("ciphertext")
        ) {
            throw new IllegalArgumentException("Unsupported encrypted envelope");
        }
        return payload;
    }

    private static synchronized SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
        keyStore.load(null);
        java.security.Key existingKey = keyStore.getKey(KEY_ALIAS, null);
        if (existingKey instanceof SecretKey) {
            return (SecretKey) existingKey;
        }
        if (existingKey != null) {
            throw new IllegalStateException("Unexpected key type");
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE);
        KeyGenParameterSpec specification = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build();
        generator.init(specification);
        return generator.generateKey();
    }
}
