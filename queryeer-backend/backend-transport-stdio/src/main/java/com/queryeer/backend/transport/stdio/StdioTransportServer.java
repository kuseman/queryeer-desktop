package com.queryeer.backend.transport.stdio;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryFailedNotification;

public final class StdioTransportServer
{
    private final FramedReader framedReader;
    private final EnvelopeCodec codec;
    private final ResponseWriter responseWriter;
    private final RequestDispatcher requestDispatcher;
    private final NotificationDispatcher notificationDispatcher;
    private final ExecutorService handlerExecutor = Executors.newCachedThreadPool(r ->
    {
        Thread t = new Thread(r, "StdioTransportServer-handler-dispatcher");
        t.setDaemon(true);
        return t;
    });

    public StdioTransportServer(InputStream input, EnvelopeCodec codec, ResponseWriter responseWriter, RequestDispatcher requestDispatcher, NotificationDispatcher notificationDispatcher)
    {
        this.framedReader = new FramedReader(input, line -> System.err.println("[console] " + line));
        this.codec = codec;
        this.responseWriter = responseWriter;
        this.requestDispatcher = requestDispatcher;
        this.notificationDispatcher = notificationDispatcher;
    }

    public void start() throws IOException
    {
        String frame;
        while ((frame = framedReader.readFrame()) != null)
        {
            final String f = frame;
            handlerExecutor.submit(() -> handleLine(f));
        }
    }

    @SuppressWarnings("UseSpecificCatch")
    private void handleLine(String line)
    {
        try
        {
            BackendEnvelope envelope = codec.decode(line);
            if (envelope.type() == EnvelopeType.REQUEST)
            {
                requestDispatcher.dispatch(envelope);
            }
            else if (envelope.type() == EnvelopeType.NOTIFICATION)
            {
                notificationDispatcher.dispatch(envelope);
            }
        }
        catch (Exception error)
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "query.failed",
                    new QueryFailedNotification("transport", new BackendError(BackendErrorCode.INTERNAL, error.getMessage(), null)), null, null));
        }
    }
}
