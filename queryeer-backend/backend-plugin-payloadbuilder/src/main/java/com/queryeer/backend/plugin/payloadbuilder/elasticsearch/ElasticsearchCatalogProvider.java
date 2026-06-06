package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderSystemTableSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.catalog.es.ESCatalog;

public final class ElasticsearchCatalogProvider implements PayloadbuilderCatalogProviderContributor
{
    private static final String LIST_INDICES_ACTION = "payloadbuilder.es.listIndices";
    private static final String ES_MODULE_ID = "core.queryengine.payloadbuilder.elasticsearch";
    private static final String ES_CONNECTIONS_SETTING_ID = "core.queryengine.payloadbuilder.elasticsearch.connections";

    static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_INDEX = "index";
    private static final String ERROR_UNSUPPORTED_ACTION = "Unsupported payloadbuilder action: ";
    private static final String CATALOG_ID = "elasticsearch";

    private static final ESCatalog CATALOG = new ESCatalog();
    final ConfigService configService;
    final PayloadMapper payloadMapper;
    final ListIndicesActionHandler listIndicesActionHandler;

    public ElasticsearchCatalogProvider(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.configService = configService;
        this.payloadMapper = payloadMapper;
        this.listIndicesActionHandler = new ListIndicesActionHandler(this);
    }

    @Override
    public void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
    {
        String connectionId = stringValue(properties, KEY_CONNECTION_ID);
        ElasticsearchConnection connection = getConnection(connectionId);
        if (connection == null)
        {
            throw new IllegalArgumentException("Connection with id: " + connectionId + " could not be found");
        }

        String index = stringValue(properties, KEY_INDEX);
        session.setCatalogProperty(alias, ESCatalog.INDEX_KEY, index);

        // TODO: ESCatalog.TRUSTCERTIFICATE_KEY
        // TODO: ESCatalog.CONNECT_TIMEOUT_KEY
        // TODO: ESCatalog.RECEIVE_TIMEOUT_KEY
        session.setCatalogProperty(alias, ESCatalog.ENDPOINT_KEY, connection.endpoint());
        if (connection.authType() != null)
        {
            session.setCatalogProperty(alias, ESCatalog.AUTH_TYPE_KEY, connection.authType());
            session.setCatalogProperty(alias, ESCatalog.AUTH_USERNAME_KEY, connection.authUsername());
            session.setCatalogProperty(alias, ESCatalog.AUTH_PASSWORD_KEY, configService.materializeSecrets(connection.authPassword()));
        }
    }

    ElasticsearchConnection getConnection(String connectionId)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return null;
        }
        SettingsModule module = configService.getModule(ES_MODULE_ID);
        if (module == null)
        {
            return null;
        }
        List<ElasticsearchConnection> connections = payloadMapper.convertToList(module.values()
                .get(ES_CONNECTIONS_SETTING_ID), ElasticsearchConnection.class);

        for (ElasticsearchConnection con : connections)
        {
            if (connectionId.equals(con.connectionId()))
            {
                return con;
            }
        }
        return null;
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
    public PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return PayloadbuilderSystemTableSqlEditorServices.INSTANCE;
    }

    @Override
    public Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        Map<String, Object> changed = new LinkedHashMap<>(PayloadbuilderCatalogProviderContributor.compareInputProperties(session, alias, inputProperties));

        // If the connectionId resolved to a native endpoint that the session changed during execution,
        // find which connectionId now matches the session's endpoint and report that instead.
        String inputConnectionId = stringValue(inputProperties, KEY_CONNECTION_ID);
        if (inputConnectionId != null)
        {
            ValueVector endpointVec = session.getCatalogProperty(alias, ESCatalog.ENDPOINT_KEY);
            String sessionEndpoint = endpointVec == null
                    || endpointVec.size() == 0 ? null
                            : endpointVec.valueAsString(0);
            if (sessionEndpoint != null)
            {
                String matchingConnectionId = findConnectionIdByEndpoint(sessionEndpoint);
                if (!Objects.equals(inputConnectionId, matchingConnectionId))
                {
                    changed.put(KEY_CONNECTION_ID, matchingConnectionId);
                }
            }
        }

        return changed;
    }

    private String findConnectionIdByEndpoint(String endpoint)
    {
        SettingsModule module = configService.getModule(ES_MODULE_ID);
        if (module == null)
        {
            return null;
        }
        List<ElasticsearchConnection> connections = payloadMapper.convertToList(module.values()
                .get(ES_CONNECTIONS_SETTING_ID), ElasticsearchConnection.class);
        for (ElasticsearchConnection con : connections)
        {
            if (endpoint.equals(con.endpoint()))
            {
                return con.connectionId();
            }
        }
        return null;
    }

    @Override
    public Set<String> actions()
    {
        return Set.of(LIST_INDICES_ACTION);
    }

    @Override
    public Object invoke(String action, Object payload)
    {
        if (!LIST_INDICES_ACTION.equals(action))
        {
            throw new IllegalArgumentException(ERROR_UNSUPPORTED_ACTION + action);
        }
        return listIndicesActionHandler.listIndices(payload);
    }
}
