package com.queryeer.backend.transport.stdio;

import java.net.URI;
import java.net.URISyntaxException;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.file.FileEngineBindingParams;
import com.queryeer.backend.contract.file.FileOpenParams;
import com.queryeer.backend.contract.file.FileOpenResult;

public final class FileOpenRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final FileRegistry fileRegistry;

    public FileOpenRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, FileRegistry fileRegistry)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.fileRegistry = fileRegistry;
    }

    @Override
    public String method()
    {
        return "file.open";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        FileOpenParams params = codec.objectMapper()
                .convertValue(envelope.params(), FileOpenParams.class);

        URI uri;
        try
        {
            uri = new URI(params.uri());
        }
        catch (URISyntaxException error)
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null,
                    new BackendError(BackendErrorCode.VALIDATION, "Invalid file uri: " + error.getMessage(), null)));
            return;
        }

        FileEngineBindingParams binding = params.engineBinding();
        String engineId = binding == null ? null
                : binding.engineId();
        String connectionId = binding == null ? null
                : binding.connectionId();

        FileSession session = fileRegistry.open(params.fileId(), uri, params.mimeType(), engineId, connectionId, params.initialText());

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new FileOpenResult(session.fileId(), session.backendVersion()), null));
    }
}
