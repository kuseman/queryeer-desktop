package com.queryeer.backend.queryengine.payloadbuilder;

/**
 * Registry that external plugins use to contribute catalog providers.
 *
 * <p>
 * The payloadbuilder backend plugin registers an instance of this interface in {@code PluginServiceRegistry} under {@code PayloadbuilderCatalogProviderRegistry.class}. External plugins obtain it
 * during their activation:
 * </p>
 *
 * <pre>{@code
 * public void activate(BackendPluginContext context, PluginDescriptor descriptor)
 * {
 *     PayloadbuilderCatalogProviderRegistry registry = context.services()
 *             .get(PayloadbuilderCatalogProviderRegistry.class);
 *     if (registry != null)
 *     {
 *         registry.registerContributor(new MyCatalogContributor());
 *     }
 * }
 * }</pre>
 */
public interface PayloadbuilderCatalogProviderRegistry
{
    /**
     * Register a catalog provider contributor.
     *
     * @param contributor the contributor to register (must not be null)
     */
    void registerContributor(PayloadbuilderCatalogProviderContributor contributor);
}
