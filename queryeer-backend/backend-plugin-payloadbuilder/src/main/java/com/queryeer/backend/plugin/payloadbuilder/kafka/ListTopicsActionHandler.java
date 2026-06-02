package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeSet;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.ListTopicsOptions;
import org.apache.kafka.common.errors.TimeoutException;

class ListTopicsActionHandler
{
    private static final String KEY_TOPICS = "topics";
    private static final String ERROR_PROPERTIES_REQUIRED = "payloadbuilder.kafka.listTopics payload.properties must be an object";
    private static final String ERROR_INTERRUPTED = "Interrupted while listing Kafka topics";
    private static final String ERROR_TIMEOUT = "Timed out listing Kafka topics after 30 seconds";
    private static final String ERROR_FAILED = "Failed to list Kafka topics: ";
    private static final int DEFAULT_TIMEOUT_SECONDS = 30;
    private static final int DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;

    private final KafkaCatalogProvider provider;

    ListTopicsActionHandler(KafkaCatalogProvider provider)
    {
        this.provider = provider;
    }

    Map<String, Object> listTopics(Object payload)
    {
        KafkaListTopicsPayload params = provider.payloadMapper.convert(payload, KafkaListTopicsPayload.class);
        if (params.properties() == null)
        {
            throw new IllegalArgumentException(ERROR_PROPERTIES_REQUIRED);
        }

        String connectionId = stringValue(params.properties(), KafkaCatalogProvider.KEY_CONNECTION_ID);
        KafkaConnection connection = provider.getConnection(connectionId);
        if (connection == null)
        {
            throw new IllegalArgumentException("Connection with id: " + connectionId + " could not be found");
        }

        Properties adminProperties = buildAdminProperties(provider.connectionSettings, connection);

        try (AdminClient admin = AdminClient.create(adminProperties))
        {
            ListTopicsOptions options = new ListTopicsOptions().listInternal(false);
            TreeSet<String> topics = new TreeSet<>(admin.listTopics(options)
                    .names()
                    .get(DEFAULT_TIMEOUT_SECONDS, TimeUnit.SECONDS));
            return Map.of(KEY_TOPICS, List.copyOf(topics));
        }
        catch (InterruptedException e)
        {
            Thread.currentThread()
                    .interrupt();
            throw new IllegalArgumentException(ERROR_INTERRUPTED, e);
        }
        catch (ExecutionException e)
        {
            Throwable cause = e.getCause();
            if (cause instanceof InterruptedException)
            {
                Thread.currentThread()
                        .interrupt();
                throw new IllegalArgumentException(ERROR_INTERRUPTED, cause);
            }
            if (cause instanceof TimeoutException)
            {
                throw new IllegalArgumentException(ERROR_TIMEOUT, cause);
            }
            String message = cause != null ? cause.getMessage()
                    : e.getMessage();
            throw new IllegalArgumentException(ERROR_FAILED + message, e);
        }
        catch (java.util.concurrent.TimeoutException e)
        {
            throw new IllegalArgumentException(ERROR_TIMEOUT, e);
        }
    }

    // Package-private for tests: timeout values are 32-bit ints because Kafka's ConfigDef expects Type.INT for these keys.
    static Properties buildAdminProperties(KafkaConnectionSettings settings, KafkaConnection connection)
    {
        Properties adminProperties = settings.toClientProperties(connection);
        adminProperties.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, DEFAULT_TIMEOUT_MS);
        adminProperties.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, DEFAULT_TIMEOUT_MS);
        return adminProperties;
    }
}
