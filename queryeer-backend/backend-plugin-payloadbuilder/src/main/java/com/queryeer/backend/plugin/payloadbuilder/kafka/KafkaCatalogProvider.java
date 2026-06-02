package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.BOOTSTRAP_SERVERS;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.TOPIC;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog;

public final class KafkaCatalogProvider implements PayloadbuilderCatalogProviderContributor
{
    private static final String LIST_TOPICS_ACTION = "payloadbuilder.kafka.listTopics";
    private static final String KAFKA_MODULE_ID = "core.queryengine.payloadbuilder.kafka";
    private static final String KAFKA_CONNECTIONS_SETTING_ID = "core.queryengine.payloadbuilder.kafka.connections";

    static final String KEY_CONNECTION_ID = "connectionId";
    private static final String ERROR_UNSUPPORTED_ACTION = "Unsupported payloadbuilder action: ";
    private static final String CATALOG_ID = "kafka";

    private static final KafkaCatalog CATALOG = new KafkaCatalog();
    final ConfigService configService;
    final PayloadMapper payloadMapper;
    final KafkaConnectionSettings connectionSettings;
    final ListTopicsActionHandler listTopicsActionHandler;

    public KafkaCatalogProvider(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.configService = configService;
        this.payloadMapper = payloadMapper;
        this.connectionSettings = new KafkaConnectionSettings(configService);
        this.listTopicsActionHandler = new ListTopicsActionHandler(this);
    }

    @Override
    public void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
    {
        String connectionId = stringValue(properties, KEY_CONNECTION_ID);
        KafkaConnection connection = getConnection(connectionId);
        if (connection == null)
        {
            throw new IllegalArgumentException("Connection with id: " + connectionId + " could not be found");
        }

        String bootstrapServers = connection.bootstrapServers();
        if (bootstrapServers == null
                || bootstrapServers.isBlank())
        {
            throw new IllegalArgumentException("Kafka connection '" + connectionId + "' is missing bootstrap servers");
        }

        connectionSettings.applyToCatalog(session, alias, connection);

        String topic = stringValue(properties, TOPIC);
        if (topic != null
                && !topic.isBlank())
        {
            session.setCatalogProperty(alias, TOPIC, topic);
        }
    }

    KafkaConnection getConnection(String connectionId)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return null;
        }
        SettingsModule module = configService.getModule(KAFKA_MODULE_ID);
        if (module == null)
        {
            return null;
        }
        List<KafkaConnection> connections = payloadMapper.convertToList(module.values()
                .get(KAFKA_CONNECTIONS_SETTING_ID), KafkaConnection.class);

        for (KafkaConnection con : connections)
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
    public Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        Map<String, Object> changed = new LinkedHashMap<>(PayloadbuilderCatalogProviderContributor.compareInputProperties(session, alias, inputProperties));

        String inputConnectionId = stringValue(inputProperties, KEY_CONNECTION_ID);
        if (inputConnectionId != null)
        {
            ValueVector bootstrapVec = session.getCatalogProperty(alias, BOOTSTRAP_SERVERS);
            String sessionBootstrap = bootstrapVec == null
                    || bootstrapVec.size() == 0 ? null
                            : bootstrapVec.valueAsString(0);
            if (sessionBootstrap != null)
            {
                String matchingConnectionId = findConnectionIdByBootstrap(sessionBootstrap);
                if (!Objects.equals(inputConnectionId, matchingConnectionId))
                {
                    changed.put(KEY_CONNECTION_ID, matchingConnectionId);
                }
            }
        }

        return changed;
    }

    private String findConnectionIdByBootstrap(String bootstrapServers)
    {
        SettingsModule module = configService.getModule(KAFKA_MODULE_ID);
        if (module == null)
        {
            return null;
        }
        List<KafkaConnection> connections = payloadMapper.convertToList(module.values()
                .get(KAFKA_CONNECTIONS_SETTING_ID), KafkaConnection.class);
        for (KafkaConnection con : connections)
        {
            if (bootstrapServers.equals(con.bootstrapServers()))
            {
                return con.connectionId();
            }
        }
        return null;
    }

    @Override
    public Set<String> actions()
    {
        return Set.of(LIST_TOPICS_ACTION);
    }

    @Override
    public Object invoke(String action, Object payload)
    {
        if (!LIST_TOPICS_ACTION.equals(action))
        {
            throw new IllegalArgumentException(ERROR_UNSUPPORTED_ACTION + action);
        }
        return listTopicsActionHandler.listTopics(payload);
    }
}
