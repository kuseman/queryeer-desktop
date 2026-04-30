package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.file.FileCloseParams;
import com.queryeer.backend.contract.file.FileCloseResult;

final class FileCloseRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final FileRegistry fileRegistry;

    public FileCloseRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, FileRegistry fileRegistry)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.fileRegistry = fileRegistry;
    }

    @Override
    public String method()
    {
        return "file.close";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        FileCloseParams params = codec.objectMapper()
                .convertValue(envelope.params(), FileCloseParams.class);

        boolean accepted = fileRegistry.close(params.fileId())
                .isPresent();

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new FileCloseResult(params.fileId(), accepted), null));
    }
}
