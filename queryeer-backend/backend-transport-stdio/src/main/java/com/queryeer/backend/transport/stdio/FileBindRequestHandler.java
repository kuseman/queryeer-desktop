package com.queryeer.backend.transport.stdio;

import java.util.Optional;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.file.FileBindParams;
import com.queryeer.backend.contract.file.FileBindResult;

public final class FileBindRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final FileRegistry fileRegistry;

    public FileBindRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, FileRegistry fileRegistry)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.fileRegistry = fileRegistry;
    }

    @Override
    public String method()
    {
        return "file.bind";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        FileBindParams params = codec.objectMapper()
                .convertValue(envelope.params(), FileBindParams.class);

        Optional<FileSession> session = fileRegistry.bind(params.fileId(), params.engineId(), params.connectionId());
        if (session.isEmpty())
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null,
                    new BackendError(BackendErrorCode.VALIDATION, "Unknown fileId: " + params.fileId(), null)));
            return;
        }

        FileSession bound = session.get();
        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null,
                new FileBindResult(bound.fileId(), bound.engineId(), bound.backendVersion()), null));
    }
}
