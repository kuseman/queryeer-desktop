package com.queryeer.backend.transport.stdio;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import com.queryeer.backend.contract.BackendEnvelope;

public final class ResponseWriter
{
    private final OutputStream output;
    private final EnvelopeCodec codec;

    public ResponseWriter(OutputStream output, EnvelopeCodec codec)
    {
        this.output = output;
        this.codec = codec;
    }

    public synchronized void write(BackendEnvelope envelope)
    {
        try
        {
            String json = codec.encode(envelope);
            byte[] body = json.getBytes(StandardCharsets.UTF_8);
            byte[] header = ("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            output.write(header);
            output.write(body);
            output.flush();
        }
        catch (IOException e)
        {
            throw new IllegalStateException("Could not write envelope", e);
        }
    }
}
