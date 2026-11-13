package com.queryeer.backend.transport.stdio;

import java.util.List;
import java.util.Locale;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.OutputSeverity;
import com.queryeer.backend.contract.query.QueryChunkRowsNotification;

class TransportQueryPublisherTest
{
    @Test
    void serializesSeverityIndependentlyOfDefaultLocale()
    {
        Locale previous = Locale.getDefault();
        try
        {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            NotificationPublisher notifications = Mockito.mock(NotificationPublisher.class);
            TransportQueryPublisher publisher = new TransportQueryPublisher("query-1", notifications);

            publisher.resultSetRows(List.of(), List.of(new OutputEvent(OutputSeverity.INFO, "Information")));

            ArgumentCaptor<Object> params = ArgumentCaptor.forClass(Object.class);
            Mockito.verify(notifications)
                    .publishForQuery(Mockito.eq("query-1"), Mockito.eq("queryengine.chunkRows"), params.capture());
            QueryChunkRowsNotification notification = (QueryChunkRowsNotification) params.getValue();
            Assertions.assertEquals("info", notification.messages()
                    .getFirst()
                    .severity());
        }
        finally
        {
            Locale.setDefault(previous);
        }
    }
}
