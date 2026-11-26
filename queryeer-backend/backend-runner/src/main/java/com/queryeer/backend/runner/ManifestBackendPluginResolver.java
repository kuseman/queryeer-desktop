package com.queryeer.backend.runner;

import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Optional;

import com.queryeer.backend.api.PluginHostServices;

final class ManifestBackendPluginResolver implements BackendPluginResolver
{
    private final PluginClassLoaderFactory classLoaderFactory;
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;

    ManifestBackendPluginResolver(PluginClassLoaderFactory classLoaderFactory, PluginFactory pluginFactory, PluginHostServices hostServices)
    {
        this.classLoaderFactory = classLoaderFactory;
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
    }

    @Override
    public Optional<DiscoveredPlugin> resolve(PluginManifest manifest, Path source)
    {
        if (manifest.backend() == null)
        {
            return Optional.empty();
        }
        String javaProblem = javaVersionProblem(manifest.backend()
                .minJavaVersion(),
                Runtime.version()
                        .feature());
        if (javaProblem != null)
        {
            throw new PluginDiscoveryException(javaProblem);
        }

        URLClassLoader classLoader = classLoaderFactory.createClassLoader(source, manifest);
        // Created at activation, after every kept plugin has published its exports (see PluginManifestBackedPlugin)
        return Optional
                .of(new DiscoveredPlugin(manifest, new PluginManifestBackedPlugin(manifest, () -> pluginFactory.instantiate(manifest, classLoader, source, hostServices)), source, true, classLoader));
    }

    /**
     * Why a backend can't run on this Java, or null when it can. {@code minJavaVersion} is a feature version ({@code "25"}); a plugin built for a newer Java would fail when its classes load, with an
     * error that doesn't say why.
     */
    static String javaVersionProblem(String minJavaVersion, int runningFeatureVersion)
    {
        if (minJavaVersion == null
                || minJavaVersion.isBlank())
        {
            return null;
        }
        int required;
        try
        {
            required = Integer.parseInt(minJavaVersion.strip());
        }
        catch (NumberFormatException e)
        {
            return "backend.minJavaVersion must be a Java version such as \"25\", not \"" + minJavaVersion + "\"";
        }
        return required > runningFeatureVersion ? "Needs Java " + required + ", but Queryeer's backend runs on Java " + runningFeatureVersion
                : null;
    }
}
