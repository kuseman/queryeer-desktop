package com.queryeer.backend.plugin.payloadbuilder.kafka;

record KafkaConnection(String connectionId, String title, String bootstrapServers, String schemaRegistryUrl, String securityProtocol, String saslMechanism, Object saslJaasConfig, Boolean enabled)
{
    boolean isEnabled()
    {
        return !Boolean.FALSE.equals(enabled);
    }
}
