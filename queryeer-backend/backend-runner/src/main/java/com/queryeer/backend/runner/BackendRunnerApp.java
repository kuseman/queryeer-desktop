package com.queryeer.backend.runner;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.PluginRuntime;
import com.queryeer.backend.core.PluginRuntimeStatus;
import com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin;
import com.queryeer.backend.transport.stdio.ConnectionUpsertRequestHandler;
import com.queryeer.backend.transport.stdio.CredentialStoreRequestHandler;
import com.queryeer.backend.transport.stdio.EngineInvokeRequestHandler;
import com.queryeer.backend.transport.stdio.EngineInvokeService;
import com.queryeer.backend.transport.stdio.EnvelopeCodec;
import com.queryeer.backend.transport.stdio.FileBindRequestHandler;
import com.queryeer.backend.transport.stdio.FileChangeNotificationHandler;
import com.queryeer.backend.transport.stdio.FileCloseRequestHandler;
import com.queryeer.backend.transport.stdio.FileOpenRequestHandler;
import com.queryeer.backend.transport.stdio.HandshakeRequestHandler;
import com.queryeer.backend.transport.stdio.HealthPingRequestHandler;
import com.queryeer.backend.transport.stdio.NotificationDispatcher;
import com.queryeer.backend.transport.stdio.NotificationHandler;
import com.queryeer.backend.transport.stdio.NotificationPublisher;
import com.queryeer.backend.transport.stdio.QueryCancelRequestHandler;
import com.queryeer.backend.transport.stdio.QueryExecuteRequestHandler;
import com.queryeer.backend.transport.stdio.QueryExecutionService;
import com.queryeer.backend.transport.stdio.RequestDispatcher;
import com.queryeer.backend.transport.stdio.RequestHandler;
import com.queryeer.backend.transport.stdio.ResponseWriter;
import com.queryeer.backend.transport.stdio.RuntimeStatusRequestHandler;
import com.queryeer.backend.transport.stdio.StdioTransportServer;

public final class BackendRunnerApp
{
    private static final String STARTED_AT = Instant.now()
            .toString();
    private static final String RUN_ID = UUID.randomUUID()
            .toString();

    private BackendRunnerApp()
    {
    }

    public static void main(String[] args)
    {
        ObjectMapper objectMapper = new ObjectMapper();
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(objectMapper);

        PluginRuntime runtime = new PluginRuntime();
        List<DiscoveredPlugin> discoveredPlugins = discoverPlugins(discoveryService);
        for (DiscoveredPlugin discovered : discoveredPlugins)
        {
            runtime.register(discovered.plugin());
        }

        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        try
        {
            runtime.activateAll(services.pluginContext());
            logRuntimeSummary(services, runtime, discoveredPlugins);
        }
        catch (Exception e)
        {
            throw new IllegalStateException("Failed to activate backend plugins", e);
        }

        long startedAt = System.currentTimeMillis();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(System.out, codec);
        NotificationPublisher notificationPublisher = new NotificationPublisher(responseWriter);
        QueryExecutionService queryExecutionService = new QueryExecutionService(services.queryEngines(), notificationPublisher);
        EngineInvokeService engineInvokeService = new EngineInvokeService(services.queryEngines());

        List<RequestHandler> handlers = List.of(new HandshakeRequestHandler(responseWriter), new RuntimeStatusRequestHandler(responseWriter, codec, () -> runtimeStatusSnapshot(runtime)),
                new HealthPingRequestHandler(startedAt, responseWriter, codec), new QueryExecuteRequestHandler(responseWriter, codec, queryExecutionService),
                new QueryCancelRequestHandler(responseWriter, codec, queryExecutionService), new EngineInvokeRequestHandler(responseWriter, codec, engineInvokeService),
                new ConnectionUpsertRequestHandler(responseWriter, codec), new CredentialStoreRequestHandler(responseWriter, codec),
                new FileOpenRequestHandler(responseWriter, codec, services.fileRegistryView()), new FileCloseRequestHandler(responseWriter, codec, services.fileRegistryView()),
                new FileBindRequestHandler(responseWriter, codec, services.fileRegistryView()));

        RequestDispatcher requestDispatcher = new RequestDispatcher(responseWriter, handlers);

        List<NotificationHandler> notificationHandlers = List.of(new FileChangeNotificationHandler(codec, services.fileRegistryView()));
        NotificationDispatcher notificationDispatcher = new NotificationDispatcher(notificationHandlers);

        StdioTransportServer transportServer = new StdioTransportServer(System.in, codec, responseWriter, requestDispatcher, notificationDispatcher);
        System.err.println(withCorrelation("Queryeer backend runner started (stdio mode).", null));
        try
        {
            transportServer.start();
        }
        catch (IOException e)
        {
            throw new IllegalStateException("Failed to start stdio transport", e);
        }
        finally
        {
            try
            {
                runtime.deactivateAll();
            }
            catch (Exception e)
            {
                services.logger()
                        .error(withCorrelation("Failed to deactivate backend plugins", null), e);
            }
        }
    }

    private static List<DiscoveredPlugin> discoverPlugins(PluginDiscoveryService discoveryService)
    {
        Optional<String> explicitPath = resolvePluginPath();
        if (explicitPath.isPresent())
        {
            PluginDiscoveryService.DiscoveryResult discovered = discoveryService.discoverFromPath(explicitPath.get());
            return discovered.backendPlugins();
        }

        List<DiscoveredPlugin> builtins = new ArrayList<>();
        builtins.add(new DiscoveredPlugin(new PluginManifest(1, "query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0",
                new PluginManifest.BackendTarget("com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin", null, "17"), null, List.of(), List.of("query.execute", "engine.invoke"),
                List.of(), null, null), new PayloadbuilderBackendPlugin(), null, false));
        builtins.add(new DiscoveredPlugin(new PluginManifest(1, "query.jdbc", "JDBC Query Engine", "0.1.0",
                new PluginManifest.BackendTarget("com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin", null, "17"), null, List.of(), List.of("query.execute"), List.of(), null, null),
                new JdbcBackendPlugin(), null, false));
        return builtins;
    }

    private static Optional<String> resolvePluginPath()
    {
        String fromProperty = System.getProperty("queryeer.plugins.path");
        if (fromProperty != null
                && !fromProperty.isBlank())
        {
            return Optional.of(fromProperty);
        }

        String fromEnv = System.getenv("QUERYEER_PLUGINS_PATH");
        if (fromEnv != null
                && !fromEnv.isBlank())
        {
            return Optional.of(fromEnv);
        }

        return Optional.empty();
    }

    private static RuntimeStatusResult runtimeStatusSnapshot(PluginRuntime runtime)
    {
        List<PluginRuntimeStatus> coreStatuses = runtime.statuses();
        List<String> pluginOrder = runtime.plugins()
                .stream()
                .map(plugin -> plugin.descriptor()
                        .id())
                .toList();
        List<RuntimePluginStatus> statuses = new ArrayList<>();
        Set<String> providedCapabilities = new LinkedHashSet<>();
        for (String pluginId : pluginOrder)
        {
            PluginRuntimeStatus status = coreStatuses.stream()
                    .filter(candidate -> candidate.pluginId()
                            .equals(pluginId))
                    .findFirst()
                    .orElse(new PluginRuntimeStatus(pluginId, com.queryeer.backend.core.PluginRuntimeState.LOADED, "Registered"));
            statuses.add(new RuntimePluginStatus(status.pluginId(), toContractState(status.state()), status.reason()));
            runtime.plugins()
                    .stream()
                    .filter(plugin -> plugin.descriptor()
                            .id()
                            .equals(status.pluginId()))
                    .findFirst()
                    .ifPresent(plugin -> providedCapabilities.addAll(plugin.descriptor()
                            .providesCapabilities()));
        }

        return new RuntimeStatusResult(STARTED_AT, statuses, runtime.activatedPluginIds(), new ArrayList<>(providedCapabilities));
    }

    private static RuntimePluginState toContractState(com.queryeer.backend.core.PluginRuntimeState state)
    {
        return RuntimePluginState.valueOf(state.name());
    }

    private static void logRuntimeSummary(BackendPlatformServices services, PluginRuntime runtime, List<DiscoveredPlugin> discoveredPlugins)
    {
        List<PluginRuntimeStatus> statuses = runtime.statuses();
        long activated = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.ACTIVATED)
                .count();
        long skipped = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.SKIPPED)
                .count();
        long failed = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.FAILED)
                .count();

        services.logger()
                .info(withCorrelation("Runtime startup summary: activated=" + activated + ", skipped=" + skipped + ", failed=" + failed, null));

        for (DiscoveredPlugin discovered : discoveredPlugins)
        {
            String source = discovered.source() == null ? "builtin"
                    : discovered.source()
                            .toString();
            services.logger()
                    .info(withCorrelation("Discovered plugin " + discovered.manifest()
                            .id() + " from " + source + ", isolatedClassLoader=" + discovered.isolatedClassLoader(), null));
        }

        for (PluginRuntimeStatus status : statuses)
        {
            services.logger()
                    .info(withCorrelation("Plugin status " + status.pluginId()
                                          + " -> "
                                          + status.state()
                                          + ""
                                          + (status.reason() == null ? ""
                                                  : " (" + status.reason() + ")"),
                            status.pluginId()));
        }
    }

    private static String withCorrelation(String message, String pluginId)
    {
        String pluginSegment = pluginId == null ? ""
                : ",pluginId=" + pluginId;
        return "[runId=" + RUN_ID + pluginSegment + "] " + sanitizeLogMessage(message);
    }

    private static String sanitizeLogMessage(String message)
    {
        return message.replaceAll("(?i)(password|secret|token|credential|authorization)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
    }
}
