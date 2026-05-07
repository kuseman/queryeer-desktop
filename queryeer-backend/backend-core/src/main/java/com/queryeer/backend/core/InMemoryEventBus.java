package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import com.queryeer.backend.api.EventBus;

final class InMemoryEventBus implements EventBus
{
    public record PublishedEvent(String topic, Object event)
    {
    }

    private final List<PublishedEvent> publishedEvents = new ArrayList<>();
    private final Map<String, List<Consumer<Object>>> listenersByTopic = new LinkedHashMap<>();

    @Override
    public synchronized void publish(String topic, Object event)
    {
        publishedEvents.add(new PublishedEvent(topic, event));
        List<Consumer<Object>> listeners = listenersByTopic.get(topic);
        if (listeners == null)
        {
            return;
        }
        for (Consumer<Object> listener : List.copyOf(listeners))
        {
            listener.accept(event);
        }
    }

    @Override
    public synchronized void subscribe(String topic, Consumer<Object> listener)
    {
        listenersByTopic.computeIfAbsent(topic, _ -> new ArrayList<>())
                .add(listener);
    }

    public synchronized List<PublishedEvent> publishedEvents()
    {
        return Collections.unmodifiableList(new ArrayList<>(publishedEvents));
    }
}
