package com.queryeer.backend.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.security.SecretRefPayloadResolver;
import com.queryeer.backend.core.security.SecuritySession;

/**
 * {@link ConfigService} that reads settings module files from disk with lazy mtime-based reload and transparent secret resolution.
 *
 * <p>
 * Module files are expected at {@code {queryeer.settings.dir}/{moduleId}.json}. When {@link #getModule(String)} is called, the file's mtime is checked against the cached version. If the file has been
 * modified since last read, it is re-read and the cache is updated. {@code { "secretRef": "..." }} wrappers are resolved to plaintext when the security session is open.
 */
final class FileBasedConfigService implements ConfigService
{
    private static final String SETTINGS_DIR_KEY = "queryeer.settings.dir";

    private final Map<String, String> systemProperties;
    private final Map<String, CachedModule> moduleCache = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private final LoggerService logger;
    private final SecuritySession securitySession;

    private volatile SecretRefPayloadResolver secretResolver;
    private volatile Path settingsDir;
    private volatile boolean settingsDirResolved;

    FileBasedConfigService(Map<String, String> systemProperties, SecuritySession securitySession, LoggerService logger)
    {
        this.systemProperties = Map.copyOf(systemProperties);
        this.objectMapper = new ObjectMapper();
        this.securitySession = securitySession;
        this.logger = logger;
    }

    @Override
    public String get(String key)
    {
        return systemProperties.get(key);
    }

    @Override
    public SettingsModule getModule(String moduleId)
    {
        Path path = resolveModulePath(moduleId);
        if (path == null)
        {
            return null;
        }

        CachedModule cached = moduleCache.get(moduleId);

        try
        {
            long currentMtime = Files.getLastModifiedTime(path)
                    .toMillis();
            if (cached != null
                    && cached.mtime == currentMtime)
            {
                return cached.module;
            }
        }
        catch (IOException e)
        {
            // File does not exist or cannot be stat'd
        }

        if (!Files.exists(path))
        {
            moduleCache.remove(moduleId);
            return null;
        }

        try
        {
            long mtime = Files.getLastModifiedTime(path)
                    .toMillis();
            Map<String, Object> raw = objectMapper.readValue(path.toFile(), new TypeReference<Map<String, Object>>()
            {
            });

            String id = stringValue(raw.get("moduleId"));
            long version = longValue(raw.get("version"), 0L);
            String updatedAt = stringValue(raw.get("updatedAt"));
            @SuppressWarnings("unchecked")
            Map<String, Object> values = raw.get("values") instanceof Map ? (Map<String, Object>) raw.get("values")
                    : Map.of();

            SettingsModule module = new SettingsModule(id != null ? id
                    : moduleId, version, updatedAt, values);
            moduleCache.put(moduleId, new CachedModule(path, mtime, module));
            return module;
        }
        catch (IOException e)
        {
            logger.warn("Failed to read settings module: " + moduleId + " (" + path + ")");
            return null;
        }
    }

    @Override
    public void invalidateModule(String moduleId)
    {
        moduleCache.remove(moduleId);
    }

    @Override
    public Object materializeSecrets(Object payload)
    {
        SecretRefPayloadResolver resolver = getOrCreateSecretResolver();
        if (resolver == null)
        {
            return payload;
        }
        return resolver.materialize(payload);
    }

    private SecretRefPayloadResolver getOrCreateSecretResolver()
    {
        SecretRefPayloadResolver resolver = this.secretResolver;
        if (resolver == null)
        {
            synchronized (this)
            {
                resolver = this.secretResolver;
                if (resolver == null)
                {
                    this.secretResolver = resolver = new SecretRefPayloadResolver(securitySession, objectMapper);
                }
            }
        }
        return resolver;
    }

    private Path resolveModulePath(String moduleId)
    {
        if (!settingsDirResolved)
        {
            String dir = systemProperties.get(SETTINGS_DIR_KEY);
            if (dir != null
                    && !dir.isBlank())
            {
                settingsDir = Path.of(dir.trim());
            }
            settingsDirResolved = true;
        }
        if (settingsDir == null)
        {
            return null;
        }
        return settingsDir.resolve(moduleId + ".json");
    }

    private static String stringValue(Object value)
    {
        return value instanceof String s ? s
                : null;
    }

    private static long longValue(Object value, long defaultValue)
    {
        if (value instanceof Number number)
        {
            return number.longValue();
        }
        if (value instanceof String s)
        {
            try
            {
                return Long.parseLong(s);
            }
            catch (NumberFormatException e)
            {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private record CachedModule(Path path, long mtime, SettingsModule module)
    {
    }
}
