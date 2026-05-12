package com.queryeer.backend.transport.stdio;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Optional;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.file.FileChangeNotification;
import com.queryeer.backend.contract.file.FileEngineBindingParams;

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

        Optional<FileSession> existing = fileRegistry.get(params.fileId());
        FileEngineBindingParams binding = params.engineBinding();
        if (existing.isEmpty())
        {
            if (params.uri() != null
                    && params.mimeType() != null)
            {
                try
                {
                    String engineId = binding == null ? null
                            : binding.engineId();
                    String connectionId = binding == null ? null
                            : binding.connectionId();
                    URI uri = new URI(params.uri());
                    fileRegistry.open(params.fileId(), uri, params.mimeType(), engineId, connectionId, params.text());
                }
                catch (URISyntaxException ignored)
                {
                    return;
                }
            }
            else
            {
                return;
            }
        }
        else if (binding != null)
        {
            FileSession session = existing.get();
            if (!binding.engineId()
                    .equals(session.engineId())
                    || !java.util.Objects.equals(binding.connectionId(), session.connectionId()))
            {
                fileRegistry.bind(params.fileId(), binding.engineId(), binding.connectionId());
            }
        }

        fileRegistry.change(params.fileId(), params.version(), params.text());
    }
}
