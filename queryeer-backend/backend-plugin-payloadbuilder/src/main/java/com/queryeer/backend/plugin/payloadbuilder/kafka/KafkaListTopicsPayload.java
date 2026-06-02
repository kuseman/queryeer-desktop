package com.queryeer.backend.plugin.payloadbuilder.kafka;

import java.util.Map;

/**
 * Payload for {@code payloadbuilder.kafka.listTopics} action.
 */
record KafkaListTopicsPayload(String alias, Map<String, Object> properties)
{
}
