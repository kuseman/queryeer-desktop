package com.queryeer.backend.plugin.payloadbuilder.mongodb;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderSystemTableSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.catalog.mongodb.MongoCatalog;

public final class MongoCatalogProvider implements PayloadbuilderCatalogProviderContributor
{
    private static final String MONGO_MODULE_ID = "core.queryengine.payloadbuilder.mongodb";
    private static final String MONGO_CONNECTIONS_SETTING_ID = "core.queryengine.payloadbuilder.mongodb.connections";
    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String CATALOG_ID = "mongodb";
    private static final MongoCatalog CATALOG = new MongoCatalog();

    private final ConfigService configService;
    private final PayloadMapper payloadMapper;

    public MongoCatalogProvider(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.configService = configService;
        this.payloadMapper = payloadMapper;
    }

    @Override
    public String catalogId()
    {
        return CATALOG_ID;
    }

    @Override
    public Catalog createCatalog()
    {
        return CATALOG;
    }

    @Override
    public void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
    {
        clearCatalogProperties(session, alias);
        MongoConnection connection = getConnection(stringValue(properties, KEY_CONNECTION_ID));
        if (connection == null)
        {
            return;
        }

        session.setCatalogProperty(alias, MongoCatalog.CONNECTIONSTRING_KEY, connection.connectionString());
        session.setCatalogProperty(alias, MongoCatalog.AUTH_USERNAME_KEY, connection.authUsername());
        session.setCatalogProperty(alias, MongoCatalog.AUTH_PASSWORD_KEY, configService.materializeSecrets(connection.authPassword()));
        session.setCatalogProperty(alias, MongoCatalog.AUTH_DATABASE_KEY, connection.authDatabase());
    }

    @Override
    public void clearProperties(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        clearCatalogProperties(session, alias);
    }

    @Override
    public PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return PayloadbuilderSystemTableSqlEditorServices.INSTANCE;
    }

    private MongoConnection getConnection(String connectionId)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return null;
        }
        SettingsModule module = configService.getModule(MONGO_MODULE_ID);
        if (module == null)
        {
            return null;
        }

        List<MongoConnection> connections = payloadMapper.convertToList(module.values()
                .get(MONGO_CONNECTIONS_SETTING_ID), MongoConnection.class);
        for (MongoConnection connection : connections)
        {
            if (connection.isEnabled()
                    && connectionId.equals(connection.connectionId()))
            {
                return connection;
            }
        }
        return null;
    }

    private static void clearCatalogProperties(IQuerySession session, String alias)
    {
        session.setCatalogProperty(alias, KEY_CONNECTION_ID, (Object) null);
        session.setCatalogProperty(alias, MongoCatalog.CONNECTIONSTRING_KEY, (Object) null);
        session.setCatalogProperty(alias, MongoCatalog.AUTH_USERNAME_KEY, (Object) null);
        session.setCatalogProperty(alias, MongoCatalog.AUTH_PASSWORD_KEY, (Object) null);
        session.setCatalogProperty(alias, MongoCatalog.AUTH_DATABASE_KEY, (Object) null);
    }
}
