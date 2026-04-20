package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.queryeer.backend.api.EventBus;

final class InMemoryEventBus implements EventBus
{
    public record PublishedEvent(String topic, Object event)
    {
    }

    private final List<PublishedEvent> publishedEvents = new ArrayList<>();

    @Override
    public synchronized void publish(String topic, Object event)
    {
        publishedEvents.add(new PublishedEvent(topic, event));
    }

    public synchronized List<PublishedEvent> publishedEvents()
    {
        return Collections.unmodifiableList(new ArrayList<>(publishedEvents));
    }
}
