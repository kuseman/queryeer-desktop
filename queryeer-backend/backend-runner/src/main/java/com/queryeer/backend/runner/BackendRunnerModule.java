package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.PluginRuntime;
import com.queryeer.backend.core.PluginRuntimeStatus;
import com.queryeer.backend.core.security.SecuritySession;
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
        Map<String, String> config = resolveConfigValues();

        ClassLoader appClassLoader = BackendRunnerModule.class.getClassLoader();
        List<URL> sharedLibUrls = SharedLibraryLoader.collect(config.get("queryeer.app.dir"));

        String appDir = config.getOrDefault("queryeer.app.dir", ".");
        SharedClassLoader sharedLoader = new SharedClassLoader(sharedLibUrls, appClassLoader);
        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(sharedLoader);
        Path builtinsDir = Path.of(appDir, "plugins", "builtin");

        BackendPlatformServices services = BackendPlatformServices.defaultServices(config);
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(objectMapper, services, classLoaderFactory);

        PluginRuntime runtime = new PluginRuntime();
        List<DiscoveredPlugin> discoveredPlugins;
        try
        {
            discoveredPlugins = discoverPlugins(discoveryService, services, classLoaderFactory, builtinsDir, sharedLibUrls, appClassLoader);
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

        SecuritySession securitySession = new SecuritySession();
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
        StdioTransportModule.RunningTransport transportServer = new StdioTransportModule().create(input, output, objectMapper, services.queryEngines(), services.fileRegistryView(), services.events(),
                () -> runtimeStatusSnapshot(runtime), startedAt, securitySession);
        System.err.println(withCorrelation("Queryeer backend runner started (stdio mode).", null));

        Thread selfDestruct = new Thread(() ->
        {
            try
            {
                long minIntervalMs = TimeUnit.SECONDS.toMillis(5);
                while (true)
                {
                    Thread.sleep(minIntervalMs);
                    if (transportServer.isStopped())
                    {
                        return;
                    }
                    long idleNanos = System.nanoTime() - transportServer.lastFrameAtNanos();
                    if (idleNanos > TimeUnit.SECONDS.toNanos(60))
                    {
                        break;
                    }
                }
            }
            catch (InterruptedException e)
            {
                return;
            }
            System.err.println("[SELFDESTRUCT] stdio transport hung with no frames for >60s — exiting JVM");
            Runtime.getRuntime()
                    .halt(1);
        }, "stdio-selfdestruct");
        selfDestruct.setDaemon(true);
        selfDestruct.start();

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
            selfDestruct.interrupt();
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
            PluginResourceCloser.closeAll(discoveredPlugins, sharedLoader, services.logger());
        }
        return exitCode;
    }

    static Map<String, String> resolveConfigValues()
    {
        Map<String, String> values = new LinkedHashMap<>();
        putIfPresent(values, "queryeer.app.dir", firstNonBlank(System.getProperty("queryeer.app.dir"), System.getenv("QUERYEER_APP_DIR")));
        putIfPresent(values, "queryeer.settings.dir", firstNonBlank(System.getProperty("queryeer.settings.dir"), System.getenv("QUERYEER_SETTINGS_DIR")));
        putIfPresent(values, "queryeer.settings.path", firstNonBlank(System.getProperty("queryeer.settings.path"), System.getenv("QUERYEER_SETTINGS_PATH")));
        return Map.copyOf(values);
    }

    private static void putIfPresent(Map<String, String> values, String key, String value)
    {
        if (value != null
                && !value.isBlank())
        {
            values.put(key, value.trim());
        }
    }

    private static String firstNonBlank(String first, String second)
    {
        if (first != null
                && !first.isBlank())
        {
            return first;
        }
        return second;
    }

    private List<DiscoveredPlugin> discoverPlugins(PluginDiscoveryService discoveryService, BackendPlatformServices services, PluginClassLoaderFactory classLoaderFactory, Path builtinsDir,
            List<URL> sharedLibUrls, ClassLoader appClassLoader)
    {
        PluginDiscoveryPlan discoveryPlan = PluginDiscoveryPlan.of(resolveDiscoveryMode(), resolvePluginPath());
        PluginDiscoveryMode mode = discoveryPlan.effectiveMode();
        services.logger()
                .info(withCorrelation("Plugin discovery mode resolved to " + mode
                                      + " (pluginPathPresent="
                                      + discoveryPlan.pluginPath()
                                              .isPresent()
                                      + ")",
                        null));

        if (mode == PluginDiscoveryMode.BUILTIN)
        {
            return new BuiltinPluginDiscovery(new PluginFactory(), services, classLoaderFactory, builtinsDir, sharedLibUrls, appClassLoader).discover();
        }

        if (mode == PluginDiscoveryMode.EXTERNAL)
        {
            String path = discoveryPlan.requiredPathFor(PluginDiscoveryMode.EXTERNAL);
            return discoveryService.discoverFromPath(path)
                    .backendPlugins();
        }

        String path = discoveryPlan.requiredPathFor(PluginDiscoveryMode.MIXED);
        List<DiscoveredPlugin> builtin = new BuiltinPluginDiscovery(new PluginFactory(), services, classLoaderFactory, builtinsDir, sharedLibUrls, appClassLoader).discover();
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
            String resolution = discovered.isolatedClassLoader() ? "PluginCL→SharedCL→AppCL"
                    : "AppCL";
            services.logger()
                    .info(withCorrelation("Discovered plugin " + discovered.manifest()
                            .id() + " from " + source + " (resolution: " + resolution + ")", null));
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
