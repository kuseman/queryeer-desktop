package com.queryeer.backend.api;

public interface EventBus
{
    void publish(String topic, Object event);
}
