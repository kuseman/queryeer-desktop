package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

/**
 * Resolves {@code secretRef} wrappers in a {@link JdbcConnectionProfile} right before opening a {@code java.sql.Connection}. This keeps secret materialization lazy: profiles are built with raw
 * properties, and plaintext secrets are produced only when credentials are actually needed.
 */
final class JdbcCredentialResolver
{
    private final ConfigService configService;

    JdbcCredentialResolver(ConfigService configService)
    {
        this.configService = configService;
    }

    JdbcConnectionProfile resolve(JdbcConnectionProfile profile)
    {
        @SuppressWarnings("unchecked")
        Map<String, Object> materialized = (Map<String, Object>) configService.materializeSecrets(profile.properties());
        return new JdbcConnectionProfile(profile.connectionId(), profile.name(), profile.dialectId(), materialized);
    }
}
