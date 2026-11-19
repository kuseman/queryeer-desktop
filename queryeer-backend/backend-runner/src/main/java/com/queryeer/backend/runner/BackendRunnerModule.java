package com.queryeer.backend.runner;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.MapperUtils;
import com.queryeer.backend.core.PluginRuntime;
import com.queryeer.backend.core.PluginRuntimeStatus;
import com.queryeer.backend.core.PluginValidation;
import com.queryeer.backend.core.PluginValidationPlan;
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
        String appDir = config.getOrDefault("queryeer.app.dir", ".");
        String resourcesDir = config.getOrDefault("queryeer.resources.dir", appDir);
        Path builtinsDir = resolveBuiltinsDir(config.get("queryeer.builtins.dir"), Path.of(resourcesDir), Path.of(appDir));
        List<PluginRuntimeContributionCollector.ManifestSource> builtinManifests = loadBuiltinManifests(builtinsDir);
        PluginRuntimeContributionCollector.PluginRuntimeContributions runtimeContributions = new PluginRuntimeContributionCollector().collect(builtinManifests);
        List<URL> sharedLibUrls = new ArrayList<>(SharedLibraryLoader.collect(config.get("queryeer.app.dir"), SharedLibraryLoader.parseDriverClasses(config.get("queryeer.jdbc.driverClasses"))));
        sharedLibUrls.addAll(runtimeContributions.sharedClasspath());

        SharedClassLoader sharedLoader = new SharedClassLoader(sharedLibUrls, appClassLoader);
        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(sharedLoader, runtimeContributions.parentFirstPrefixes());

        SecuritySession securitySession = new SecuritySession();
        BackendPlatformServices services = BackendPlatformServices.fileBased(config, securitySession);
        new NativeLibraryPreloader().preload(Path.of(appDir), runtimeContributions.nativeLibraries(), sharedLoader, services.logger());
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(services, classLoaderFactory);

        PluginRuntime runtime = new PluginRuntime();
        List<DiscoveredPlugin> discoveredPlugins;
        List<PluginDiscoveryService.DiscoveryFailure> discoveryFailures;
        try
        {
            DiscoveredPlugins discovery = discoverPlugins(discoveryService, services, builtinsDir);
            discoveredPlugins = discovery.plugins();
            discoveryFailures = discovery.failures();
            classLoaderFactory.publishExports(discoveredPlugins);
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
            // Plan first: each plugin sees the exports of the optional dependencies it uses before any of its classes load
            PluginValidationPlan plan = PluginValidation.planActivation(runtime.plugins());
            classLoaderFactory.useOptionalDependencies(discoveredPlugins, plan.activeOptionalDependencies());
            runtime.activateAll(services.pluginContext(), plan);
            logRuntimeSummary(services, runtime, discoveredPlugins);
        }
        catch (Exception e)
        {
            throw new IllegalStateException("Failed to activate backend plugins", e);
        }

        long startedAt = System.currentTimeMillis();
        Map<String, PluginDescriptor> descriptorMap = runtime.plugins()
                .stream()
                .collect(Collectors.toMap(plugin -> plugin.descriptor()
                        .id(), BackendPlugin::descriptor));
        StdioTransportModule.RunningTransport transportServer = new StdioTransportModule().create(input, output, MapperUtils.MAPPER, services.queryEngines(), services.fileRegistryView(),
                services.events(), () -> runtimeStatusSnapshot(runtime, discoveryFailures), startedAt, services.config(), securitySession, services.changelogRegistry(), descriptorMap::get,
                services.largeValues());
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
        String appDir = firstNonBlank(System.getProperty("queryeer.app.dir"), System.getenv("QUERYEER_APP_DIR"));
        putIfPresent(values, "queryeer.app.dir", appDir);
        putIfPresent(values, "queryeer.resources.dir", firstNonBlank(System.getProperty("queryeer.resources.dir"), System.getenv("QUERYEER_RESOURCES_DIR")));
        putIfPresent(values, "queryeer.builtins.dir", firstNonBlank(System.getProperty("queryeer.builtins.dir"), System.getenv("QUERYEER_BUILTINS_DIR")));
        putIfPresent(values, "queryeer.settings.dir", firstNonBlank(System.getProperty("queryeer.settings.dir"), System.getenv("QUERYEER_SETTINGS_DIR")));
        putIfPresent(values, "queryeer.settings.path", firstNonBlank(System.getProperty("queryeer.settings.path"), System.getenv("QUERYEER_SETTINGS_PATH")));
        String pluginsDir = firstNonBlank(System.getProperty("queryeer.plugins.dir"), defaultPluginsDir(appDir));
        putIfPresent(values, "queryeer.plugins.dir", pluginsDir);
        putIfPresent(values, "queryeer.plugins.safeMode", System.getProperty("queryeer.plugins.safeMode"));
        putIfPresent(values, "queryeer.plugins.disabledIds", System.getProperty("queryeer.plugins.disabledIds"));
        putIfPresent(values, "queryeer.jdbc.driverClasses", System.getProperty("queryeer.jdbc.driverClasses"));
        putIfPresent(values, "queryeer.plugins.devDirs", System.getProperty("queryeer.plugins.devDirs"));
        return Map.copyOf(values);
    }

    private static String defaultPluginsDir(String appDir)
    {
        if (isBlank(appDir))
        {
            return null;
        }
        return Path.of(appDir.trim(), "plugins")
                .toString();
    }

    private static void putIfPresent(Map<String, String> values, String key, String value)
    {
        if (!isBlank(value))
        {
            values.put(key, value.trim());
        }
    }

    private static String firstNonBlank(String first, String second)
    {
        if (!isBlank(first))
        {
            return first;
        }
        return second;
    }

    /** The plugins to run, and the external ones that were skipped because they couldn't be loaded. */
    record DiscoveredPlugins(List<DiscoveredPlugin> plugins, List<PluginDiscoveryService.DiscoveryFailure> failures)
    {
    }

    private DiscoveredPlugins discoverPlugins(PluginDiscoveryService discoveryService, BackendPlatformServices services, Path builtinsDir)
    {
        String pluginsDir = services.config()
                .get("queryeer.plugins.dir");
        boolean safeMode = Boolean.parseBoolean(services.config()
                .get("queryeer.plugins.safeMode"));
        Set<String> disabledPluginIds = parseDisabledPluginIds(services.config()
                .get("queryeer.plugins.disabledIds"));
        services.logger()
                .info(withCorrelation("Plugin discovery resolved to builtins plus managed user plugins (pluginsDir=" + (pluginsDir == null
                        || pluginsDir.isBlank() ? "not-configured"
                                : pluginsDir) + ", safeMode=" + safeMode + ", disabledExternalPlugins=" + disabledPluginIds.size() + ")",
                        null));

        String backendVersion = BackendVersion.get();
        if (backendVersion == null)
        {
            services.logger()
                    .warn(withCorrelation("Backend version unknown; built-in plugins keep their manifest versions, so dependency version ranges on them may not match", null));
        }
        List<DiscoveredPlugin> builtin = new BuiltinPluginDiscovery(discoveryService, builtinsDir, backendVersion).discover();
        if (safeMode)
        {
            return new DiscoveredPlugins(builtin, List.of());
        }

        // An installed plugin that can't be loaded is skipped and reported; it must not stop the backend
        List<PluginDiscoveryService.DiscoveryFailure> failures = new ArrayList<>();
        List<DiscoveredPlugin> external = List.of();
        // Plugins that loaded, with or without a backend: a failed duplicate of one isn't listed as failed
        Set<String> loadedIds = new HashSet<>();
        if (!isBlank(pluginsDir))
        {
            try
            {
                PluginDiscoveryService.DiscoveryResult installed = discoveryService.discoverFromPath(pluginsDir);
                external = installed.backendPlugins();
                loadedIds.addAll(installed.loadedIds());
                installed.failures()
                        .stream()
                        // A disabled plugin isn't loaded anyway
                        .filter(failure -> !disabledPluginIds.contains(failure.pluginId()))
                        .forEach(failures::add);
            }
            catch (RuntimeException e)
            {
                // The plugins folder itself can't be read: no installed plugins, but the backend starts
                services.logger()
                        .error(withCorrelation("Installed plugins not loaded: the plugins folder " + pluginsDir + " can't be read", null), e);
            }
        }
        external = filterDisabledExternalPlugins(external, disabledPluginIds);

        List<Path> devDirs = parseDevPluginDirs(services.config()
                .get("queryeer.plugins.devDirs"));
        if (!devDirs.isEmpty())
        {
            Set<String> builtinIds = builtin.stream()
                    .map(plugin -> plugin.manifest()
                            .id())
                    .collect(Collectors.toSet());
            PluginManifestLoader manifestLoader = new PluginManifestLoader();
            Set<String> replacedIds = new HashSet<>();
            Set<String> developmentLoadedIds = new HashSet<>();
            List<DiscoveredPlugin> development = new ArrayList<>();
            for (Path devDir : devDirs)
            {
                // One broken folder (e.g. a half-written build) must not stop the backend
                try
                {
                    String pluginId = manifestLoader.load(devDir)
                            .id();
                    if (builtinIds.contains(pluginId))
                    {
                        services.logger()
                                .error(withCorrelation("Developer plugin folder " + devDir + " skipped: " + pluginId + " is a built-in plugin", null), null);
                        continue;
                    }
                    if (!replacedIds.add(pluginId))
                    {
                        continue;
                    }
                    // Replaces the installed plugin by its plugin.json id, also when this folder has no backend or its
                    // backend fails to load: the frontend does the same, so the two halves never come from different builds
                    PluginDiscoveryService.DiscoveryResult result = discoveryService.discoverFromSources(List.of(devDir));
                    development.addAll(result.backendPlugins());
                    developmentLoadedIds.addAll(result.loadedIds());
                    failures.addAll(result.failures());
                }
                catch (RuntimeException e)
                {
                    failures.add(new PluginDiscoveryService.DiscoveryFailure(PluginDiscoveryService.idFromSource(devDir), devDir, "Developer plugin folder skipped: " + e.getMessage()));
                }
            }
            services.logger()
                    .info(withCorrelation("Developer plugin folders: " + devDirs.size() + ", backend plugins: " + development.size(), null));
            external = preferDevelopmentPlugins(development, replacedIds, external);
            // A replaced plugin counts as loaded only if its developer folder loaded
            loadedIds.removeAll(replacedIds);
            loadedIds.addAll(developmentLoadedIds);
        }
        List<DiscoveredPlugin> merged = mergeDiscoveredPlugins(builtin, external, failures);
        for (PluginDiscoveryService.DiscoveryFailure failure : failures)
        {
            services.logger()
                    .error(withCorrelation("Plugin " + failure.pluginId() + " not loaded (" + failure.source() + "): " + failure.reason(), null), null);
        }
        // For the status list: one row per id (the last reason: a developer folder's over the installed copy's it replaced), and none for an id that loaded after all
        Map<String, PluginDiscoveryService.DiscoveryFailure> reported = new LinkedHashMap<>();
        for (PluginDiscoveryService.DiscoveryFailure failure : failures)
        {
            // A loaded id is a failed duplicate (or a clash with a built-in) of a plugin that runs; the log has it
            if (!loadedIds.contains(failure.pluginId()))
            {
                reported.put(failure.pluginId(), failure);
            }
        }
        return new DiscoveredPlugins(merged, List.copyOf(reported.values()));
    }

    /** The developer plugin folders (copies the main process made of them), separated like the platform's path list. */
    static List<Path> parseDevPluginDirs(String value)
    {
        if (isBlank(value))
        {
            return List.of();
        }
        List<Path> dirs = new ArrayList<>();
        for (String item : value.split(java.io.File.pathSeparator))
        {
            if (!item.isBlank())
            {
                dirs.add(Path.of(item.trim()));
            }
        }
        return dirs;
    }

    /**
     * Developer folders replace the installed plugins with their ids ({@code replacedIds}, from their plugin.json); they load even when the installed one is disabled.
     */
    static List<DiscoveredPlugin> preferDevelopmentPlugins(List<DiscoveredPlugin> development, Set<String> replacedIds, List<DiscoveredPlugin> installed)
    {
        List<DiscoveredPlugin> result = new ArrayList<>(development);
        installed.stream()
                .filter(plugin -> !replacedIds.contains(plugin.manifest()
                        .id()))
                .forEach(result::add);
        return result;
    }

    static Set<String> parseDisabledPluginIds(String value)
    {
        Set<String> disabled = new LinkedHashSet<>();
        if (isBlank(value))
        {
            return disabled;
        }
        for (String item : value.split(","))
        {
            String pluginId = item.trim();
            if (!pluginId.isBlank())
            {
                disabled.add(pluginId);
            }
        }
        return disabled;
    }

    static List<DiscoveredPlugin> filterDisabledExternalPlugins(List<DiscoveredPlugin> plugins, Set<String> disabledPluginIds)
    {
        if (disabledPluginIds.isEmpty())
        {
            return plugins;
        }
        return plugins.stream()
                .filter(plugin -> !disabledPluginIds.contains(plugin.manifest()
                        .id()))
                .toList();
    }

    private List<PluginRuntimeContributionCollector.ManifestSource> loadBuiltinManifests(Path builtinsDir)
    {
        PluginSourceExplorer sourceExplorer = new PluginSourceExplorer();
        PluginManifestLoader manifestLoader = new PluginManifestLoader();
        return sourceExplorer.discoverPluginSources(builtinsDir)
                .stream()
                .map(source -> new PluginRuntimeContributionCollector.ManifestSource(manifestLoader.load(source), source))
                .toList();
    }

    static Path resolveBuiltinsDir(String configuredBuiltinsDir, Path resourcesDir, Path appDir)
    {
        if (!isBlank(configuredBuiltinsDir))
        {
            return Path.of(configuredBuiltinsDir)
                    .toAbsolutePath()
                    .normalize();
        }
        Path resourcesBuiltinsDir = resourcesDir.resolve("plugins")
                .resolve("builtin");
        if (java.nio.file.Files.isDirectory(resourcesBuiltinsDir))
        {
            return resourcesBuiltinsDir;
        }

        Path appBuiltinsDir = appDir.resolve("plugins")
                .resolve("builtin");
        if (Files.isDirectory(appBuiltinsDir))
        {
            return appBuiltinsDir;
        }

        Path workingDirBuiltinsDir = Path.of("plugins", "builtin")
                .toAbsolutePath()
                .normalize();
        if (Files.isDirectory(workingDirBuiltinsDir))
        {
            return workingDirBuiltinsDir;
        }

        return appBuiltinsDir;
    }

    /**
     * The built-in plugins followed by the external ones. An external plugin with the id of a built-in (or of an earlier external one) is skipped and added to {@code failures}: it must not stop the
     * backend.
     */
    static List<DiscoveredPlugin> mergeDiscoveredPlugins(List<DiscoveredPlugin> primary, List<DiscoveredPlugin> secondary, List<PluginDiscoveryService.DiscoveryFailure> failures)
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
                failures.add(new PluginDiscoveryService.DiscoveryFailure(pluginId, plugin.source(),
                        "Duplicate external plugin id conflicts with an already discovered plugin: " + pluginId + " (source: " + source + ")"));
                closeQuietly(plugin.classLoaderResource());
                continue;
            }
            merged.add(plugin);
        }

        return merged;
    }

    private static void closeQuietly(AutoCloseable resource)
    {
        if (resource == null)
        {
            return;
        }
        try
        {
            resource.close();
        }
        catch (Exception e)
        {
            // Nothing was loaded from it; a failed close leaves only an open file handle
        }
    }

    private RuntimeStatusResult runtimeStatusSnapshot(PluginRuntime runtime, List<PluginDiscoveryService.DiscoveryFailure> discoveryFailures)
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

        // Plugins skipped at discovery (see discoverPlugins) are listed as failed, unless a plugin with that id runs
        for (PluginDiscoveryService.DiscoveryFailure failure : discoveryFailures)
        {
            if (!pluginOrder.contains(failure.pluginId()))
            {
                statuses.add(new RuntimePluginStatus(failure.pluginId(), RuntimePluginState.FAILED, failure.reason()));
            }
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
        runtime.warnings()
                .forEach((pluginId, warning) -> services.logger()
                        .warn(withCorrelation(pluginId + ": " + warning, pluginId)));

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
