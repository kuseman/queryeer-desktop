package com.queryeer.backend.transport.stdio;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

class SettingsModuleChangedNotificationHandlerTest
{
    private final ObjectMapper objectMapper = new ObjectMapper();
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

        SettingsModuleChangedNotificationHandler handler = new SettingsModuleChangedNotificationHandler(codec, configService);
        assertEquals("settings.module.changed", handler.method());

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "settings.module.changed",
                Map.of("moduleId", "core.editor.texteditor", "version", 7L), null, null);

        handler.handle(envelope);

        assertEquals("core.editor.texteditor", invalidated[0]);
    }
}
