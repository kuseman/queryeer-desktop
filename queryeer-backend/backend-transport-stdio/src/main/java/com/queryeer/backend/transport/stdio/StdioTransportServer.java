package com.queryeer.backend.transport.stdio;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryFailedNotification;

public final class StdioTransportServer
{
    private final BufferedReader reader;
    private final EnvelopeCodec codec;
    private final ResponseWriter responseWriter;
    private final RequestDispatcher requestDispatcher;

    public StdioTransportServer(InputStream input, EnvelopeCodec codec, ResponseWriter responseWriter, RequestDispatcher requestDispatcher)
    {
        this.reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
        this.codec = codec;
        this.responseWriter = responseWriter;
        this.requestDispatcher = requestDispatcher;
    }

    public void start() throws IOException
    {
        String line;
        while ((line = reader.readLine()) != null)
        {
            if (line.isBlank())
            {
                continue;
            }
            handleLine(line);
        }
    }

    private void handleLine(String line)
    {
        try
        {
            BackendEnvelope envelope = codec.decode(line);
            requestDispatcher.dispatch(envelope);
        }
        catch (Exception error)
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, "query.failed",
                    new QueryFailedNotification("transport", new BackendError(BackendErrorCode.INTERNAL, error.getMessage(), null)), null, null));
        }
    }
}
