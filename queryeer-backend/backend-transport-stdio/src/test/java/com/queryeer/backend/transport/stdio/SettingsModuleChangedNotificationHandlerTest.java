package com.queryeer.backend.transport.stdio;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.Events;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.core.MapperUtils;

import tools.jackson.databind.ObjectMapper;

class SettingsModuleChangedNotificationHandlerTest
{
    private final ObjectMapper objectMapper = MapperUtils.MAPPER;
    private final EnvelopeCodec codec = new EnvelopeCodec(objectMapper);

    @Test
    void handleInvalidatesModule()
    {
        String[] invalidated = { null };
        ConfigService configService = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public void invalidateModule(String moduleId)
            {
                invalidated[0] = moduleId;
            }
        };

        EventBus events = Mockito.mock(EventBus.class);

        SettingsModuleChangedNotificationHandler handler = new SettingsModuleChangedNotificationHandler(codec, configService, events);
        assertEquals("settings.module.changed", handler.method());

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "settings.module.changed",
                Map.of("moduleId", "core.editor.texteditor", "version", 7L), null, null);

        handler.handle(envelope);

        String moduleId = "core.editor.texteditor";
        assertEquals(moduleId, invalidated[0]);

        verify(events).publish(Events.SETTINGS_MODULE_CHANGED, Map.of("moduleId", moduleId));
        verifyNoMoreInteractions(events);
    }
}
