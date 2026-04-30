package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.PluginRuntime;
import com.queryeer.backend.core.PluginRuntimeStatus;
import com.queryeer.backend.transport.stdio.StdioTransportModule;

public final class BackendRunnerModule
{
    private static final String STARTED_AT = Instant.now()
            .toString();
    private static final String RUN_ID = UUID.randomUUID()
            .toString();

    public int run(InputStream input, OutputStream output)
    {
        int exitCode = 0;
        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(objectMapper, services);

        PluginRuntime runtime = new PluginRuntime();
        List<DiscoveredPlugin> discoveredPlugins;
        try
        {
            discoveredPlugins = discoverPlugins(discoveryService, services);
            for (DiscoveredPlugin discovered : discoveredPlugins)
            {
                runtime.register(discovered.plugin());
            }
        }
        catch (Exception e)
        {
            services.logger()
                    .error(withCorrelation("Failed to discover/register backend plugins", null), e);
            throw e;
        }

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
        StdioTransportModule.RunningTransport transportServer = new StdioTransportModule().create(input, output, objectMapper, services.queryEngines(), services.fileRegistryView(),
                () -> runtimeStatusSnapshot(runtime), startedAt);
        System.err.println(withCorrelation("Queryeer backend runner started (stdio mode).", null));
        try
        {
            transportServer.start();
        }
        catch (IOException e)
        {
            if (!transportServer.isStopped())
            {
                exitCode = 1;
                throw new IllegalStateException("Failed to start stdio transport", e);
            }
        }
        catch (Throwable t)
        {
            exitCode = 1;
            services.logger()
                    .error(withCorrelation("Unhandled stdio transport failure", null), t);
        }
        finally
        {
            try
            {
                runtime.deactivateAll();
            }
            catch (Exception e)
            {
                exitCode = 1;
                services.logger()
                        .error(withCorrelation("Failed to deactivate backend plugins", null), e);
            }
            PluginResourceCloser.closeClassLoaders(discoveredPlugins, services.logger());
        }
        return exitCode;
    }

    private List<DiscoveredPlugin> discoverPlugins(PluginDiscoveryService discoveryService, BackendPlatformServices services)
    {
        PluginDiscoveryMode mode = resolveDiscoveryMode();
        Optional<String> explicitPath = resolvePluginPath();
        services.logger()
                .info(withCorrelation("Plugin discovery mode resolved to " + mode + " (pluginPathPresent=" + explicitPath.isPresent() + ")", null));

        if (mode == PluginDiscoveryMode.AUTO)
        {
            if (explicitPath.isPresent())
            {
                return discoveryService.discoverFromPath(explicitPath.get())
                        .backendPlugins();
            }
            return new BuiltinPluginDiscovery(new PluginFactory(), services).discover();
        }

        if (mode == PluginDiscoveryMode.BUILTIN)
        {
            return new BuiltinPluginDiscovery(new PluginFactory(), services).discover();
        }

        if (mode == PluginDiscoveryMode.EXTERNAL)
        {
            String path = explicitPath.orElseThrow(() -> new PluginDiscoveryException("Plugin discovery mode external requires queryeer.plugins.path or QUERYEER_PLUGINS_PATH"));
            return discoveryService.discoverFromPath(path)
                    .backendPlugins();
        }

        String path = explicitPath.orElseThrow(() -> new PluginDiscoveryException("Plugin discovery mode mixed requires queryeer.plugins.path or QUERYEER_PLUGINS_PATH"));
        List<DiscoveredPlugin> builtin = new BuiltinPluginDiscovery(new PluginFactory(), services).discover();
        List<DiscoveredPlugin> external = discoveryService.discoverFromPath(path)
                .backendPlugins();
        return mergeDiscoveredPlugins(builtin, external);
    }

    static List<DiscoveredPlugin> mergeDiscoveredPlugins(List<DiscoveredPlugin> primary, List<DiscoveredPlugin> secondary)
    {
        List<DiscoveredPlugin> merged = new ArrayList<>(primary);
        Set<String> seen = new HashSet<>();
        for (DiscoveredPlugin plugin : primary)
        {
            seen.add(plugin.manifest()
                    .id());
        }

        for (DiscoveredPlugin plugin : secondary)
        {
            String pluginId = plugin.manifest()
                    .id();
            if (!seen.add(pluginId))
            {
                String source = plugin.source() == null ? "builtin"
                        : plugin.source()
                                .toString();
                throw new PluginDiscoveryException("Duplicate plugin id discovered in mixed mode: " + pluginId + " (source: " + source + ")");
            }
            merged.add(plugin);
        }

        return merged;
    }

    private Optional<String> resolvePluginPath()
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

    private PluginDiscoveryMode resolveDiscoveryMode()
    {
        String fromProperty = System.getProperty("queryeer.plugins.mode");
        if (fromProperty != null
                && !fromProperty.isBlank())
        {
            return PluginDiscoveryMode.parse(fromProperty);
        }

        String fromEnv = System.getenv("QUERYEER_PLUGINS_MODE");
        return PluginDiscoveryMode.parse(fromEnv);
    }

    private RuntimeStatusResult runtimeStatusSnapshot(PluginRuntime runtime)
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

    private RuntimePluginState toContractState(com.queryeer.backend.core.PluginRuntimeState state)
    {
        return RuntimePluginState.valueOf(state.name());
    }

    private void logRuntimeSummary(BackendPlatformServices services, PluginRuntime runtime, List<DiscoveredPlugin> discoveredPlugins)
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

    private String withCorrelation(String message, String pluginId)
    {
        String pluginSegment = pluginId == null ? ""
                : ",pluginId=" + pluginId;
        return "[runId=" + RUN_ID + pluginSegment + "] " + sanitizeLogMessage(message);
    }

    private String sanitizeLogMessage(String message)
    {
        return message.replaceAll("(?i)(password|secret|token|credential|authorization)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
    }
}
