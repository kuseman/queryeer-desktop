package com.queryeer.backend.transport.stdio;

import java.util.Map;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.Events;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.settings.SettingsModuleChangedNotification;

final class SettingsModuleChangedNotificationHandler implements NotificationHandler
{
    private final EnvelopeCodec codec;
    private final ConfigService configService;
    private final EventBus eventBus;

    public SettingsModuleChangedNotificationHandler(EnvelopeCodec codec, ConfigService configService, EventBus eventBus)
    {
        this.codec = codec;
        this.configService = configService;
        this.eventBus = eventBus;
    }

    @Override
    public String method()
    {
        return "settings.module.changed";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        SettingsModuleChangedNotification params = codec.objectMapper()
                .convertValue(envelope.params(), SettingsModuleChangedNotification.class);

        if (params != null)
        {
            configService.invalidateModule(params.moduleId());
        }
        eventBus.publish(Events.SETTINGS_MODULE_CHANGED, Map.of("moduleId", params.moduleId()));
    }
}
