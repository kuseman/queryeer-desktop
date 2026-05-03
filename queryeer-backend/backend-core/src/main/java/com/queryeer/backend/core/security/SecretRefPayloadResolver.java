package com.queryeer.backend.core.security;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class SecretRefPayloadResolver
{
    private static final String SECRET_REF_FIELD = "secretRef";
    private static final String CIPHER = "AES/GCM/NoPadding";

    private final SecuritySession securitySession;
    private final ObjectMapper objectMapper;

    private volatile String cachedVaultPath;
    private volatile long cachedModifiedAt = -1;
    private volatile JsonNode cachedEntriesNode;

    public SecretRefPayloadResolver(SecuritySession securitySession, ObjectMapper objectMapper)
    {
        this.securitySession = securitySession;
        this.objectMapper = objectMapper;
    }

    public Object materialize(Object payload)
    {
        SecuritySession.SecuritySessionSnapshot session = securitySession.snapshot();
        return materialize(payload, session);
    }

    private Object materialize(Object value, SecuritySession.SecuritySessionSnapshot session)
    {
        if (value == null)
        {
            return null;
        }

        if (value instanceof Map<?, ?> map)
        {
            if (isSecretRefWrapper(map))
            {
                return resolveSecretRef(asText(map.get(SECRET_REF_FIELD)), session);
            }

            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet())
            {
                if (!(entry.getKey() instanceof String key))
                {
                    continue;
                }

                result.put(key, materialize(entry.getValue(), session));
            }
            return result;
        }

        if (value instanceof List<?> list)
        {
            List<Object> result = new ArrayList<>(list.size());
            for (Object item : list)
            {
                result.add(materialize(item, session));
            }
            return result;
        }

        return value;
    }

    private String resolveSecretRef(String secretRef, SecuritySession.SecuritySessionSnapshot session)
    {
        if (secretRef == null
                || secretRef.isBlank())
        {
            throw new SecretResolutionException("Secret reference is missing");
        }

        if (session == null
                || !session.isOpen())
        {
            throw new SecretResolutionException("Security session is not open");
        }

        JsonNode entries = loadEntries(session.vaultPath());
        JsonNode entry = entries.get(secretRef);
        if (entry == null
                || entry.isMissingNode())
        {
            throw new SecretResolutionException("Secret reference was not found: " + secretRef);
        }

        String iv = asText(entry.path("iv"));
        String authTag = asText(entry.path("authTag"));
        String ciphertext = asText(entry.path("ciphertext"));
        if (iv == null
                || authTag == null
                || ciphertext == null)
        {
            throw new SecretResolutionException("Secret entry is malformed: " + secretRef);
        }

        try
        {
            return decrypt(session.sessionKey(), iv, authTag, ciphertext);
        }
        catch (GeneralSecurityException e)
        {
            throw new SecretResolutionException("Failed to decrypt secret reference: " + secretRef, e);
        }
    }

    private JsonNode loadEntries(String vaultPath)
    {
        try
        {
            Path path = Path.of(vaultPath);
            long modifiedAt = Files.exists(path) ? Files.getLastModifiedTime(path)
                    .toMillis()
                    : -1;

            JsonNode localCachedEntries = cachedEntriesNode;
            if (localCachedEntries != null
                    && vaultPath.equals(cachedVaultPath)
                    && modifiedAt == cachedModifiedAt)
            {
                return localCachedEntries;
            }

            JsonNode root = objectMapper.readTree(path.toFile());
            JsonNode entries = root.path("entries");
            if (!entries.isObject())
            {
                throw new SecretResolutionException("Vault entries are missing");
            }

            cachedVaultPath = vaultPath;
            cachedModifiedAt = modifiedAt;
            cachedEntriesNode = entries;
            return entries;
        }
        catch (IOException e)
        {
            throw new SecretResolutionException("Failed to read vault file", e);
        }
    }

    private String decrypt(byte[] keyBytes, String ivBase64, String tagBase64, String ciphertextBase64) throws GeneralSecurityException
    {
        byte[] iv = java.util.Base64.getDecoder()
                .decode(ivBase64);
        byte[] tag = java.util.Base64.getDecoder()
                .decode(tagBase64);
        byte[] ciphertext = java.util.Base64.getDecoder()
                .decode(ciphertextBase64);
        byte[] payload = new byte[ciphertext.length + tag.length];
        System.arraycopy(ciphertext, 0, payload, 0, ciphertext.length);
        System.arraycopy(tag, 0, payload, ciphertext.length, tag.length);

        Cipher cipher = Cipher.getInstance(CIPHER);
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(keyBytes, "AES"), new GCMParameterSpec(128, iv));
        byte[] plaintext = cipher.doFinal(payload);
        return new String(plaintext, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static boolean isSecretRefWrapper(Map<?, ?> map)
    {
        return map.size() == 1
                && map.containsKey(SECRET_REF_FIELD)
                && map.get(SECRET_REF_FIELD) instanceof String;
    }

    private static String asText(Object value)
    {
        if (value instanceof JsonNode node)
        {
            return node.isTextual() ? node.asText()
                    : null;
        }
        return value instanceof String text ? text
                : null;
    }

    public static final class SecretResolutionException extends RuntimeException
    {
        public SecretResolutionException(String message)
        {
            super(message);
        }

        public SecretResolutionException(String message, Throwable cause)
        {
            super(message, cause);
        }
    }
}
