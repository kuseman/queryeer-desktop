package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.security.SecuritySession;

class FileBasedConfigServiceTest
{
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @TempDir
    Path tempDir;

    private Path settingsDir;
    private DefaultLoggerService logger;

    @BeforeEach
    void setUp() throws Exception
    {
        settingsDir = tempDir.resolve("settings");
        Files.createDirectories(settingsDir);
        logger = new DefaultLoggerService();
    }

    @Test
    void getModuleReturnsModuleFromDisk()
    {
        writeModule("test.plugin", Map.of("key1", "val1", "key2", Map.of("nested", true)));

        FileBasedConfigService config = configWithDir();
        SettingsModule module = config.getModule("test.plugin");

        assertNotNull(module);
        assertEquals("test.plugin", module.moduleId());
        assertEquals(1L, module.version());
        assertEquals("val1", module.values()
                .get("key1"));
        assertEquals(Map.of("nested", true), module.values()
                .get("key2"));
    }

    @Test
    void getModuleReturnsNullWhenModuleNotFound()
    {
        FileBasedConfigService config = configWithDir();

        SettingsModule module = config.getModule("nonexistent");

        assertNull(module);
    }

    @Test
    void getModuleReturnsNullWhenSettingsDirNotConfigured()
    {
        FileBasedConfigService config = new FileBasedConfigService(Map.of(), new SecuritySession(), logger);

        SettingsModule module = config.getModule("any.module");

        assertNull(module);
    }

    @Test
    void getModuleCachesByMtime() throws Exception
    {
        writeModule("cache.test", Map.of("v", "first"));

        FileBasedConfigService config = configWithDir();
        SettingsModule m1 = config.getModule("cache.test");
        assertEquals("first", m1.values()
                .get("v"));

        // Same mtime — returns cached
        SettingsModule m2 = config.getModule("cache.test");
        assertEquals("first", m2.values()
                .get("v"));

        // Change file content
        Thread.sleep(10L); // ensure mtime tick
        writeModule("cache.test", Map.of("v", "second"));

        // Should re-read
        SettingsModule m3 = config.getModule("cache.test");
        assertEquals("second", m3.values()
                .get("v"));
    }

    @Test
    void getModuleReReadsWhenCacheAgeExceedsMaxTtl() throws Exception
    {
        writeModule("ttl.test", Map.of("v", "first"));

        FileBasedConfigService config = configWithDir();
        SettingsModule m1 = config.getModule("ttl.test");
        assertEquals("first", m1.values()
                .get("v"));

        // Sleep past the 1-second cache TTL to force a re-read even if mtime appears unchanged
        Thread.sleep(1100L);
        writeModule("ttl.test", Map.of("v", "second"));

        SettingsModule m2 = config.getModule("ttl.test");
        assertEquals("second", m2.values()
                .get("v"));
    }

    @Test
    void getModuleResolvesSecretsWhenSessionOpen() throws Exception
    {
        byte[] key = new byte[32];
        for (int i = 0; i < key.length; i++)
        {
            key[i] = (byte) (i + 1);
        }

        String secretRef = "db-pass";
        String plaintext = "super-secret-password";
        Path vaultPath = createVault(secretRef, key, plaintext);

        SecuritySession session = new SecuritySession();
        session.openSession("s1", vaultPath.toString(), Base64.getEncoder()
                .encodeToString(key), null);

        writeModule("credentials.test", Map.of("db_password", Map.of("secretRef", secretRef)));

        FileBasedConfigService config = new FileBasedConfigService(Map.of("queryeer.settings.dir", settingsDir.toString()), session, logger);
        SettingsModule module = config.getModule("credentials.test");

        assertNotNull(module);
        assertEquals(plaintext, module.values()
                .get("db_password"));
    }

    @Test
    void getModuleReturnsRawSecretRefsWhenSessionClosed()
    {
        SecuritySession session = new SecuritySession();

        writeModule("credentials.test", Map.of("db_password", Map.of("secretRef", "db-pass")));

        FileBasedConfigService config = new FileBasedConfigService(Map.of("queryeer.settings.dir", settingsDir.toString()), session, logger);
        SettingsModule module = config.getModule("credentials.test");

        assertNotNull(module);
        assertEquals(Map.of("secretRef", "db-pass"), module.values()
                .get("db_password"));
    }

    @Test
    void getDelegatesToSystemProperties()
    {
        FileBasedConfigService config = new FileBasedConfigService(Map.of("queryeer.settings.dir", settingsDir.toString(), "custom.key", "custom-val"), new SecuritySession(), logger);

        assertEquals("custom-val", config.get("custom.key"));
        assertEquals(settingsDir.toString(), config.get("queryeer.settings.dir"));
        assertNull(config.get("unknown.key"));
    }

    @Test
    void getModuleReturnsUnchangedModuleIdWhenFieldMissing()
    {
        // Write a module file without "moduleId" field
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("version", 2L);
        doc.put("updatedAt", "2026-01-01T00:00:00Z");
        doc.put("values", Map.of("key", "val"));
        writeRaw("no-id.json", doc);

        FileBasedConfigService config = configWithDir();
        SettingsModule module = config.getModule("no-id");

        assertNotNull(module);
        assertEquals("no-id", module.moduleId());
        assertEquals("val", module.values()
                .get("key"));
    }

    @Test
    void moduleWithNullVersionDefaultsToZero()
    {
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("moduleId", "noversion");
        doc.put("values", Map.of("key", "val"));
        writeRaw("noversion.json", doc);

        FileBasedConfigService config = configWithDir();
        SettingsModule module = config.getModule("noversion");

        assertNotNull(module);
        assertEquals(0L, module.version());
    }

    @Test
    void listValuesAreResolvedForSecretRefs() throws Exception
    {
        byte[] key = new byte[32];
        for (int i = 0; i < key.length; i++)
        {
            key[i] = (byte) (i + 1);
        }

        String plaintext = "secret-value";
        Path vaultPath = createVault("s1", key, plaintext);

        SecuritySession session = new SecuritySession();
        session.openSession("s1", vaultPath.toString(), Base64.getEncoder()
                .encodeToString(key), null);

        writeModule("list.test", Map.of("items", List.of(Map.of("secretRef", "s1"), "plain-string")));

        FileBasedConfigService config = new FileBasedConfigService(Map.of("queryeer.settings.dir", settingsDir.toString()), session, logger);
        SettingsModule module = config.getModule("list.test");

        assertNotNull(module);
        assertTrue(module.values()
                .get("items") instanceof List);
        @SuppressWarnings("unchecked")
        List<Object> items = (List<Object>) module.values()
                .get("items");
        assertEquals(plaintext, items.get(0));
        assertEquals("plain-string", items.get(1));
    }

    private FileBasedConfigService configWithDir()
    {
        return new FileBasedConfigService(Map.of("queryeer.settings.dir", settingsDir.toString()), new SecuritySession(), logger);
    }

    private void writeModule(String moduleId, Map<String, Object> values)
    {
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("version", 1L);
        doc.put("moduleId", moduleId);
        doc.put("updatedAt", "2026-01-01T00:00:00Z");
        doc.put("values", values);
        writeRaw(moduleId + ".json", doc);
    }

    private void writeRaw(String fileName, Map<String, Object> document)
    {
        try
        {
            OBJECT_MAPPER.writeValue(settingsDir.resolve(fileName)
                    .toFile(), document);
        }
        catch (Exception e)
        {
            throw new RuntimeException(e);
        }
    }

    private static Path createVault(String secretRef, byte[] key, String plaintext) throws GeneralSecurityException
    {
        try
        {
            Path vaultPath = Files.createTempFile("vault", ".json");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, new byte[12]));

            byte[] encrypted = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] tag = new byte[16];
            byte[] ciphertext = new byte[encrypted.length - tag.length];
            System.arraycopy(encrypted, 0, ciphertext, 0, ciphertext.length);
            System.arraycopy(encrypted, ciphertext.length, tag, 0, tag.length);

            Map<String, Object> vault = new LinkedHashMap<>();
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("iv", Base64.getEncoder()
                    .encodeToString(new byte[12]));
            entry.put("authTag", Base64.getEncoder()
                    .encodeToString(tag));
            entry.put("ciphertext", Base64.getEncoder()
                    .encodeToString(ciphertext));
            vault.put("entries", Map.of(secretRef, entry));

            new ObjectMapper().writeValue(vaultPath.toFile(), vault);
            return vaultPath;
        }
        catch (Exception e)
        {
            throw new RuntimeException(e);
        }
    }
}
