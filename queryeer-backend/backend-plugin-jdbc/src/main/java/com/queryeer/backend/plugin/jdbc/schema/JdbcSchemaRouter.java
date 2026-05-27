package com.queryeer.backend.plugin.jdbc.schema;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.plugin.jdbc.DefaultJdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;

public final class JdbcSchemaRouter
{
    private static final String OPTION_PARENT_KIND = "parentKind";
    private static final String OPTION_TARGET = "target";

    private final DefaultJdbcSchemaResolver defaultResolver;

    public JdbcSchemaRouter(DefaultJdbcSchemaResolver defaultResolver)
    {
        this.defaultResolver = defaultResolver;
    }

    public List<JdbcSchemaObject> resolve(JdbcConnection connection, String parentKind, Object target)
    {
        Map<String, Object> options = new HashMap<>();
        options.put(OPTION_PARENT_KIND, parentKind);
        if (target != null)
        {
            options.put(OPTION_TARGET, target);
        }

        Map<String, JdbcSchemaResolver> branchResolvers = connection.dialect()
                .branchResolvers();
        JdbcSchemaResolver resolver = branchResolvers.getOrDefault(parentKind, defaultResolver);
        return resolver.resolveSchema(connection, options);
    }
}
