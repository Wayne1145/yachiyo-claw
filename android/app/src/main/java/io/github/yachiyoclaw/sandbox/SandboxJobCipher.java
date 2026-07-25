package io.github.yachiyoclaw.sandbox;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypts persisted sandbox commands because build/deploy commands may contain credentials. */
final class SandboxJobCipher {
    private static final String ALIAS = "yachiyo_sandbox_jobs_v1";
    private static final String STORE = "AndroidKeyStore";

    synchronized String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer envelope = ByteBuffer.allocate(1 + iv.length + encrypted.length);
        envelope.put((byte) iv.length).put(iv).put(encrypted);
        return Base64.encodeToString(envelope.array(), Base64.NO_WRAP);
    }

    synchronized String decrypt(String encoded) throws Exception {
        ByteBuffer envelope = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP));
        int ivLength = envelope.get() & 0xff;
        if (ivLength < 12 || ivLength > 32 || envelope.remaining() <= ivLength) throw new IllegalStateException("sandbox_job_ciphertext_invalid");
        byte[] iv = new byte[ivLength];
        byte[] encrypted = new byte[envelope.remaining() - ivLength];
        envelope.get(iv).get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(STORE);
        store.load(null);
        java.security.Key existing = store.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
