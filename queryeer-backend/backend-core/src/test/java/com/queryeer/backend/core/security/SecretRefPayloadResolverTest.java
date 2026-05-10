package com.queryeer.backend.core.security;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.core.MapperUtils;

class SecretRefPayloadResolverTest
{
    @TempDir
    Path tempDir;

    @Test
    void materializeResolvesNestedSecretRefWrappers() throws Exception
    {
        byte[] key = new byte[32];
        for (int i = 0; i < key.length; i++)
        {
            key[i] = (byte) (i + 1);
        }
        Path vaultPath = createVault("db-pass", key, "db-password");

        SecuritySession session = new SecuritySession();
        session.openSession("session-1", vaultPath.toString(), Base64.getEncoder()
                .encodeToString(key), null);

        SecretRefPayloadResolver resolver = new SecretRefPayloadResolver(session, MapperUtils.MAPPER);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("credentials", Map.of("secretRef", "db-pass"));
        payload.put("items", List.of(Map.of("secretRef", "db-pass"), Map.of("plain", "value")));

        Object resolved = resolver.materialize(payload);
        Map<?, ?> map = (Map<?, ?>) resolved;
        Assertions.assertEquals("db-password", map.get("credentials"));

        List<?> items = (List<?>) map.get("items");
        Assertions.assertEquals("db-password", items.get(0));
        Assertions.assertEquals(Map.of("plain", "value"), items.get(1));
    }

    @Test
    void materializeFailsWhenSecuritySessionIsClosed() throws Exception
    {
        Path vaultPath = createVault("api-key", new byte[32], "secret");
        SecretRefPayloadResolver resolver = new SecretRefPayloadResolver(new SecuritySession(), MapperUtils.MAPPER);

        SecuritySessionClosedException error = Assertions.assertThrows(SecuritySessionClosedException.class, () -> resolver.materialize(Map.of("auth", Map.of("secretRef", "api-key"))));

        Assertions.assertEquals("Security session is not open", error.getMessage());
        Assertions.assertTrue(Files.exists(vaultPath));
    }

    @Test
    void materializeFailsWhenReferenceIsUnknown() throws Exception
    {
        byte[] key = new byte[32];
        Path vaultPath = createVault("known", key, "value");
        SecuritySession session = new SecuritySession();
        session.openSession("session-2", vaultPath.toString(), Base64.getEncoder()
                .encodeToString(key), null);
        SecretRefPayloadResolver resolver = new SecretRefPayloadResolver(session, MapperUtils.MAPPER);

        SecretRefPayloadResolver.SecretResolutionException error = Assertions.assertThrows(SecretRefPayloadResolver.SecretResolutionException.class,
                () -> resolver.materialize(Map.of("auth", Map.of("secretRef", "missing"))));

        Assertions.assertTrue(error.getMessage()
                .contains("Secret reference was not found"));
    }

    @Test
    void materializeLeavesNonWrapperFieldsUntouched() throws Exception
    {
        byte[] key = new byte[32];
        Path vaultPath = createVault("api-key-ref", key, "resolved-api-key");
        SecuritySession session = new SecuritySession();
        session.openSession("session-3", vaultPath.toString(), Base64.getEncoder()
                .encodeToString(key), null);
        SecretRefPayloadResolver resolver = new SecretRefPayloadResolver(session, MapperUtils.MAPPER);

        Object resolved = resolver.materialize(Map.of("apiKeyHandle", "api-key-ref", "name", "conn-1"));
        Assertions.assertEquals(Map.of("apiKeyHandle", "api-key-ref", "name", "conn-1"), resolved);
    }

    private Path createVault(String secretRef, byte[] key, String plaintext) throws Exception
    {
        Path path = tempDir.resolve("vault.json");
        Map<String, String> encrypted = encrypt(key, plaintext);
        Map<String, Object> root = Map.of("entries", Map.of(secretRef, encrypted));
        MapperUtils.MAPPER.writeValue(path.toFile(), root);
        return path;
    }

    private static Map<String, String> encrypt(byte[] key, String plaintext) throws GeneralSecurityException
    {
        byte[] iv = new byte[12];
        for (int i = 0; i < iv.length; i++)
        {
            iv[i] = (byte) (i + 7);
        }

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));

        int tagLength = 16;
        int ciphertextLength = encrypted.length - tagLength;
        byte[] ciphertext = new byte[ciphertextLength];
        byte[] authTag = new byte[tagLength];
        System.arraycopy(encrypted, 0, ciphertext, 0, ciphertextLength);
        System.arraycopy(encrypted, ciphertextLength, authTag, 0, tagLength);

        return Map.of("iv", Base64.getEncoder()
                .encodeToString(iv), "ciphertext",
                Base64.getEncoder()
                        .encodeToString(ciphertext),
                "authTag", Base64.getEncoder()
                        .encodeToString(authTag));
    }
}
