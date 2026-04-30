package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.file.FileChangeNotification;

final class FileChangeNotificationHandler implements NotificationHandler
{
    private final EnvelopeCodec codec;
    private final FileRegistry fileRegistry;

    public FileChangeNotificationHandler(EnvelopeCodec codec, FileRegistry fileRegistry)
    {
        this.codec = codec;
        this.fileRegistry = fileRegistry;
    }

    @Override
    public String method()
    {
        return "file.change";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        FileChangeNotification params = codec.objectMapper()
                .convertValue(envelope.params(), FileChangeNotification.class);

        fileRegistry.change(params.fileId(), params.version(), params.text());
    }
}
