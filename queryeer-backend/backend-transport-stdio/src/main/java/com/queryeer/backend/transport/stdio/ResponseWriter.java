package com.queryeer.backend.transport.stdio;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.queryeer.backend.contract.BackendEnvelope;

final class ResponseWriter
{
    private final OutputStream output;
    private final EnvelopeCodec codec;
    private volatile Runnable brokenPipeListener = () ->
    {
    };

    public ResponseWriter(OutputStream output, EnvelopeCodec codec)
    {
        this.output = output;
        this.codec = codec;
    }

    public synchronized void write(BackendEnvelope envelope)
    {
        final byte[] body;
        try
        {
            String json = codec.encode(envelope);
            body = json.getBytes(StandardCharsets.UTF_8);
        }
        catch (JsonProcessingException e)
        {
            throw new IllegalStateException("Could not encode envelope", e);
        }

        try
        {
            byte[] header = ("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            output.write(header);
            output.write(body);
            output.flush();
        }
        catch (IOException e)
        {
            brokenPipeListener.run();
            throw new IllegalStateException("Could not write envelope", e);
        }
    }

    public void onBrokenPipe(Runnable listener)
    {
        this.brokenPipeListener = Objects.requireNonNull(listener, "listener");
    }
}
