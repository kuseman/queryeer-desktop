package com.queryeer.backend.transport.stdio;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;

public final class NotificationDispatcher
{
    private final Map<String, NotificationHandler> handlersByMethod;

    public NotificationDispatcher(List<NotificationHandler> handlers)
    {
        this.handlersByMethod = indexHandlers(handlers);
    }

    public void dispatch(BackendEnvelope envelope)
    {
        if (envelope.type() != EnvelopeType.NOTIFICATION)
        {
            return;
        }

        NotificationHandler handler = handlersByMethod.get(envelope.method());
        if (handler == null)
        {
            return;
        }

        handler.handle(envelope);
    }

    private Map<String, NotificationHandler> indexHandlers(List<NotificationHandler> handlers)
    {
        Map<String, NotificationHandler> map = new LinkedHashMap<>();
        for (NotificationHandler handler : handlers)
        {
            map.put(handler.method(), handler);
        }
        return Map.copyOf(map);
    }
}
