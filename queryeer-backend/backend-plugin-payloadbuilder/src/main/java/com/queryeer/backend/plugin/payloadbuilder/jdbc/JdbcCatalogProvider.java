package com.queryeer.backend.plugin.payloadbuilder.jdbc;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.Map;
import java.util.Objects;

import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.catalog.jdbc.JdbcCatalog;

public final class JdbcCatalogProvider implements PayloadbuilderCatalogProviderContributor
{
    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_DATABASE = "database";
    private static final String NO_USERNAME_DUMMY = System.getProperty("user.name");
    private static final String NO_PASSWORD_DUMMY = "__queryeer_no_password__";
    private static final JdbcCatalog CATALOG = new JdbcCatalog();

    private final JdbcRuntimeService jdbcRuntimeService;
    private final PayloadbuilderCatalogSqlEditorServices editorServices;

    public JdbcCatalogProvider(JdbcRuntimeService jdbcRuntimeService, JdbcSqlEditorServices jdbcSqlEditorServices)
    {
        this.jdbcRuntimeService = Objects.requireNonNull(jdbcRuntimeService, "jdbcRuntimeService");
        this.editorServices = new PayloadbuilderJdbcSqlEditorServices(Objects.requireNonNull(jdbcSqlEditorServices, "jdbcSqlEditorServices"));
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
    public PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return editorServices;
    }

    @Override
    public Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        // Generic input-property comparison covers database (USE database) etc.
        // The URL/driver/credentials are connection-config-derived and don't change during execution.
        return PayloadbuilderCatalogProviderContributor.compareInputProperties(session, alias, inputProperties);
    }

    @Override
    public void injectProperties(IQuerySession querySession, String alias, Map<String, Object> properties)
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

        // PLB required a username/password so we set a dummy for connections that doesn't use password like Windows Native auth
        String username = PayloadUtils.stringValue(jdbcConnection.properties()
                .get(JdbcConnection.KEY_USERNAME), NO_USERNAME_DUMMY);
        String password = PayloadUtils.stringValue(jdbcConnection.properties()
                .get(JdbcConnection.KEY_PASSWORD), NO_PASSWORD_DUMMY);

        querySession.setCatalogProperty(alias, JdbcCatalog.USERNAME, username);
        querySession.setCatalogProperty(alias, JdbcCatalog.PASSWORD, password);
    }
}
