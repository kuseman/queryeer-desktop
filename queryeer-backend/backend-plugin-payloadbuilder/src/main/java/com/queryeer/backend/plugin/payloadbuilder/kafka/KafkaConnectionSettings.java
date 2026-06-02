package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.BOOTSTRAP_SERVERS;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SASL_JAAS_CONFIG;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SASL_MECHANISM;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SCHEMA_REGISTRY_URL;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SECURITY_PROTOCOL;

import java.util.Properties;

import com.queryeer.backend.api.ConfigService;

import se.kuseman.payloadbuilder.api.execution.IQuerySession;

/**
 * Translates a {@link KafkaConnection} into either payloadbuilder catalog session properties or Kafka client {@link Properties} (for {@code AdminClient} / consumers). Centralizes the
 * SASL/security-protocol rules so the catalog provider and the action handlers stay in lockstep.
 */
class KafkaConnectionSettings
{
    private static final String SECURITY_PROTOCOL_SASL_PLAINTEXT = "SASL_PLAINTEXT";
    private static final String SECURITY_PROTOCOL_SASL_SSL = "SASL_SSL";
    private static final String SASL_MECHANISM_GSSAPI = "GSSAPI";

    private final ConfigService configService;

    KafkaConnectionSettings(ConfigService configService)
    {
        this.configService = configService;
    }

    /** Apply the connection as catalog session properties for the given alias. */
    void applyToCatalog(IQuerySession session, String alias, KafkaConnection connection)
    {
        session.setCatalogProperty(alias, BOOTSTRAP_SERVERS, connection.bootstrapServers());

        String schemaRegistryUrl = connection.schemaRegistryUrl();
        if (schemaRegistryUrl != null
                && !schemaRegistryUrl.isBlank())
        {
            session.setCatalogProperty(alias, SCHEMA_REGISTRY_URL, schemaRegistryUrl);
        }

        String securityProtocol = connection.securityProtocol();
        if (securityProtocol == null
                || securityProtocol.isBlank())
        {
            return;
        }
        session.setCatalogProperty(alias, SECURITY_PROTOCOL, securityProtocol);

        String saslMechanism = connection.saslMechanism();
        if (saslMechanism == null
                || saslMechanism.isBlank())
        {
            return;
        }
        session.setCatalogProperty(alias, SASL_MECHANISM, saslMechanism);
        Object jaas = configService.materializeSecrets(connection.saslJaasConfig());
        if (jaas != null
                && !jaas.toString()
                        .isBlank())
        {
            session.setCatalogProperty(alias, SASL_JAAS_CONFIG, jaas.toString());
        }
    }

    /** Build Kafka client properties (e.g. for {@code AdminClient}) from the connection. */
    Properties toClientProperties(KafkaConnection connection)
    {
        Properties properties = new Properties();
        properties.put("bootstrap.servers", connection.bootstrapServers());

        String securityProtocol = connection.securityProtocol();
        if (securityProtocol == null
                || securityProtocol.isBlank())
        {
            return properties;
        }
        properties.put("security.protocol", securityProtocol);

        String saslMechanism = connection.saslMechanism();
        if (!isSaslSecurityProtocol(securityProtocol)
                || saslMechanism == null
                || saslMechanism.isBlank())
        {
            return properties;
        }
        properties.put("sasl.mechanism", saslMechanism);

        // GSSAPI requires the JAAS config to be supplied via JVM system properties, not the client config.
        if (SASL_MECHANISM_GSSAPI.equals(saslMechanism))
        {
            return properties;
        }

        Object jaas = configService.materializeSecrets(connection.saslJaasConfig());
        if (jaas != null
                && !jaas.toString()
                        .isBlank())
        {
            properties.put("sasl.jaas.config", jaas.toString());
        }
        return properties;
    }

    private static boolean isSaslSecurityProtocol(String securityProtocol)
    {
        return SECURITY_PROTOCOL_SASL_PLAINTEXT.equals(securityProtocol)
                || SECURITY_PROTOCOL_SASL_SSL.equals(securityProtocol);
    }
}
