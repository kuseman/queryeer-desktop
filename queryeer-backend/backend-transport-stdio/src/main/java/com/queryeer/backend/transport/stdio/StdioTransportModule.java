package com.queryeer.backend.transport.stdio;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.function.Supplier;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.engine.EngineInvokeService;
import com.queryeer.backend.core.query.QueryExecutionService;
import com.queryeer.backend.core.security.SecuritySession;

public final class StdioTransportModule
{
    public RunningTransport create(InputStream input, OutputStream output, ObjectMapper objectMapper, QueryEngineRegistry queryEngines, FileRegistry fileRegistry, EventBus events,
            Supplier<RuntimeStatusResult> runtimeStatusSupplier, long startedAt)
    {
        return create(input, output, objectMapper, queryEngines, fileRegistry, events, runtimeStatusSupplier, startedAt, null, new SecuritySession());
    }

    public RunningTransport create(InputStream input, OutputStream output, ObjectMapper objectMapper, QueryEngineRegistry queryEngines, FileRegistry fileRegistry, EventBus events,
            Supplier<RuntimeStatusResult> runtimeStatusSupplier, long startedAt, ConfigService configService)
    {
        return create(input, output, objectMapper, queryEngines, fileRegistry, events, runtimeStatusSupplier, startedAt, configService, new SecuritySession());
    }

    public RunningTransport create(InputStream input, OutputStream output, ObjectMapper objectMapper, QueryEngineRegistry queryEngines, FileRegistry fileRegistry, EventBus events,
            Supplier<RuntimeStatusResult> runtimeStatusSupplier, long startedAt, ConfigService configService, SecuritySession securitySession)
    {
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        NotificationPublisher notificationPublisher = new NotificationPublisher(responseWriter);
        QueryExecutionService queryExecutionService = new QueryExecutionService(queryEngines);
        EngineInvokeService engineInvokeService = new EngineInvokeService(queryEngines);

        List<RequestHandler> handlers = List.of(new HandshakeRequestHandler(responseWriter), new RuntimeStatusRequestHandler(responseWriter, codec, runtimeStatusSupplier),
                new SecuritySessionOpenRequestHandler(responseWriter, codec, securitySession, events), new SecuritySessionCloseRequestHandler(responseWriter, securitySession, events),
                new SecurityVaultChangedRequestHandler(responseWriter, codec, securitySession), new HealthPingRequestHandler(startedAt, responseWriter, codec),
                new QueryExecuteRequestHandler(responseWriter, codec, queryExecutionService, notificationPublisher), new QueryCancelRequestHandler(responseWriter, codec, queryExecutionService),
                new EngineInvokeRequestHandler(responseWriter, codec, engineInvokeService), new ConnectionUpsertRequestHandler(responseWriter, codec, queryEngines),
                new FileOpenRequestHandler(responseWriter, codec, fileRegistry), new FileCloseRequestHandler(responseWriter, codec, fileRegistry));

        RequestDispatcher requestDispatcher = new RequestDispatcher(responseWriter, handlers);

        List<NotificationHandler> notificationHandlers = List.of(new FileChangeNotificationHandler(codec, fileRegistry),
                new SettingsModuleChangedNotificationHandler(codec, configService != null ? configService
                        : new com.queryeer.backend.api.ConfigService()
                        {
                            @Override
                            public String get(String key)
                            {
                                return null;
                            }
                        }));
        NotificationDispatcher notificationDispatcher = new NotificationDispatcher(notificationHandlers);

        StdioTransportServer transportServer = new StdioTransportServer(input, codec, responseWriter, requestDispatcher, notificationDispatcher);
        responseWriter.onBrokenPipe(transportServer::stop);
        return new RunningTransport(transportServer);
    }

    public static final class RunningTransport
    {
        private final StdioTransportServer transportServer;

        RunningTransport(StdioTransportServer transportServer)
        {
            this.transportServer = transportServer;
        }

        public void start() throws java.io.IOException
        {
            transportServer.start();
        }

        public boolean isStopped()
        {
            return transportServer.isStopped();
        }

        public long lastFrameAtNanos()
        {
            return transportServer.lastFrameAtNanos();
        }
    }
}
