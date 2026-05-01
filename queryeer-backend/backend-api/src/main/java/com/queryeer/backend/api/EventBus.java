package com.queryeer.backend.api;

import java.util.function.Consumer;

public interface EventBus
{
    void publish(String topic, Object event);

    default void subscribe(String topic, Consumer<Object> listener)
    {
    }
}
