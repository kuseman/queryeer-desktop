package com.queryeer.backend.plugin.payloadbuilder.jdbc;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.Map;
import java.util.Objects;

import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.jdbc.JdbcCatalog;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

public final class JdbcCatalogProvider implements PayloadbuilderCatalogProvider
{
    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_DATABASE = "database";
    private static final String NO_PASSWORD_DUMMY = "__queryeer_no_password__";
    private static final JdbcCatalog CATALOG = new JdbcCatalog();

    private final JdbcRuntimeService jdbcRuntimeService;

    public JdbcCatalogProvider(JdbcRuntimeService jdbcRuntimeService)
    {
        this.jdbcRuntimeService = Objects.requireNonNull(jdbcRuntimeService, "jdbcRuntimeService");
    }

    @Override
    public String catalogId()
    {
        return "jdbc";
    }

    @Override
    public Catalog createCatalog()
    {
        return CATALOG;
    }

    @Override
    public void injectProperties(QuerySession querySession, String alias, Map<String, Object> properties)
    {
        String connectionId = stringValue(properties, KEY_CONNECTION_ID);

        JdbcConnection jdbcConnection = jdbcRuntimeService.connections()
                .resolve(connectionId);
        if (jdbcConnection == null)
        {
            throw new IllegalArgumentException("Connection with id: " + connectionId + " could not be found");
        }

        querySession.setCatalogProperty(alias, JdbcCatalog.DRIVER_CLASSNAME, jdbcConnection.dialect()
                .metadata()
                .driverClassName());
        querySession.setCatalogProperty(alias, JdbcCatalog.URL, jdbcConnection.dialect()
                .buildUrl(jdbcConnection.properties()));
        querySession.setCatalogProperty(alias, JdbcCatalog.DATABASE, properties.get(KEY_DATABASE));
        querySession.setCatalogProperty(alias, JdbcCatalog.USERNAME, jdbcConnection.properties()
                .get(JdbcConnection.KEY_USERNAME));

        // PLB required a password so we set a dummy for connections that doesn't use password like Windows Native auth
        String password = PayloadUtils.stringValue(jdbcConnection.properties()
                .get(JdbcConnection.KEY_PASSWORD), NO_PASSWORD_DUMMY);

        querySession.setCatalogProperty(alias, JdbcCatalog.PASSWORD, password);
    }
}
