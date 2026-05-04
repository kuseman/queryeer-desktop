package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.settings.SettingsModuleChangedNotification;

final class SettingsModuleChangedNotificationHandler implements NotificationHandler
{
    private final EnvelopeCodec codec;
    private final ConfigService configService;

    public SettingsModuleChangedNotificationHandler(EnvelopeCodec codec, ConfigService configService)
    {
        this.codec = codec;
        this.configService = configService;
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
    }
}
