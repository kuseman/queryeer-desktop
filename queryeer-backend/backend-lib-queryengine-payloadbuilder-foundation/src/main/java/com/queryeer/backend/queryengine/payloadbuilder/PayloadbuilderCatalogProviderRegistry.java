package com.queryeer.backend.queryengine.payloadbuilder;

/**
 * Registry that external plugins use to contribute catalog providers.
 *
 * <p>
 * The payloadbuilder backend plugin registers an instance of this interface in {@code PluginServiceRegistry} under {@code PayloadbuilderCatalogProviderRegistry.class}. A plugin that declares a
 * dependency on {@code queryengine.payloadbuilder} gets it during its activation:
 * </p>
 *
 * <pre>{@code
 * public void activate(BackendPluginContext context, PluginDescriptor descriptor)
 * {
 *     context.services()
 *             .require(PayloadbuilderCatalogProviderRegistry.class)
 *             .registerContributor(new MyCatalogContributor());
 * }
 * }</pre>
 *
 * <p>
 * With an optional dependency, do this in a {@code DependencyExtension} started by {@code DependencyExtension.whenDependencyActive(context, "queryengine.payloadbuilder", ...)}.
 * </p>
 */
public interface PayloadbuilderCatalogProviderRegistry
{
    /**
     * Register a catalog provider contributor. Call it from {@code activate}: the registry is read by running queries afterwards and is not safe to change concurrently.
     *
     * @param contributor the contributor to register (must not be null)
     * @throws IllegalArgumentException when the contributor has no catalogId
     * @throws IllegalStateException when another contributor already registered that catalogId (ignoring case), for example a built-in catalog such as {@code jdbc}
     */
    void registerContributor(PayloadbuilderCatalogProviderContributor contributor);
}
