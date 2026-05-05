package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

/**
 * Resolves {@code secretRef} wrappers in a {@link JdbcConnectionProfile} right before opening a {@code java.sql.Connection}. This keeps secret materialization lazy: profiles are built with raw
 * properties, and plaintext secrets are produced only when credentials are actually needed.
 */
final class JdbcCredentialResolver
{
    private final ConfigService configService;
    private final PayloadMapper payloadMapper;

    JdbcCredentialResolver(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.configService = configService;
        this.payloadMapper = payloadMapper;
    }

    JdbcConnectionProfile resolve(JdbcConnectionProfile profile)
    {
        Object materialized = configService.materializeSecrets(profile.properties());
        Map<String, Object> map = payloadMapper.convert(materialized, Map.class);
        return new JdbcConnectionProfile(profile.connectionId(), profile.name(), profile.dialectId(), map);
    }
}
