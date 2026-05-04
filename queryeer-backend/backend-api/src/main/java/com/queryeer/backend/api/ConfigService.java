package com.queryeer.backend.api;

public interface ConfigService
{
    /** Legacy: system-property / env-var lookup. */
    String get(String key);

    /**
     * Returns the settings module document for the given module ID. Lazily re-reads from disk if the file's mtime has changed since last read.
     */
    default SettingsModule getModule(String moduleId)
    {
        return null;
    }

    /**
     * Resolves {@code { "secretRef": "..." }} wrappers in the given payload to plaintext using the security session. Returns the input unchanged if the session is not open or no secretRefs are
     * present.
     */
    default Object materializeSecrets(Object payload)
    {
        return payload;
    }

    /**
     * Explicitly invalidates the cached settings module so the next {@link #getModule(String)} call re-reads from disk.
     */
    default void invalidateModule(String moduleId)
    {
    }
}
