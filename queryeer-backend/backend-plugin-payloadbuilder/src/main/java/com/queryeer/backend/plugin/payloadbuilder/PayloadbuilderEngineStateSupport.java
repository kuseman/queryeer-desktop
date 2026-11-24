package com.queryeer.backend.plugin.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

final class PayloadbuilderEngineStateSupport
{
    private static final String KEY_PAYLOADBUILDER = "payloadbuilder";
    private static final String KEY_CATALOGS = "catalogs";
    private static final String KEY_CATALOG_ID = "catalogId";
    private static final String KEY_PROPERTIES = "properties";
    private static final String KEY_DEFAULT_CATALOGALIAS = "defaultCatalogAlias";

    private static final String ERROR_ALIAS_REQUIRED = "Catalog alias is required";
    private static final String ERROR_DUPLICATE_ALIAS = "Duplicate catalog alias: ";
    private static final String ERROR_INSTANCE_OBJECT = "Catalog instance for alias '";
    private static final String ERROR_INSTANCE_OBJECT_SUFFIX = "' must be an object";
    private static final String ERROR_CATALOG_ID_REQUIRED = "catalogId is required for alias '";
    private static final String ERROR_DEFAULT_ALIAS_MISMATCH = "defaultCatalogAlias must match a mapped alias";

    private PayloadbuilderEngineStateSupport()
    {
    }

    static PayloadbuilderCatalogState parse(PayloadbuilderEngineState engineState)
    {
        if (engineState == null
                || engineState.payloadbuilder() == null)
        {
            return new PayloadbuilderCatalogState(null, null, Map.of());
        }

        PayloadbuilderEngineState.PayloadbuilderCatalogState pb = engineState.payloadbuilder();
        String defaultCatalogAlias = trimToNull(pb.defaultCatalogAlias());
        String selectedEnvironmentId = trimToNull(pb.selectedEnvironmentId());

        Map<String, PayloadbuilderCatalogState.Instance> byAlias = new LinkedHashMap<>();
        if (pb.catalogs() != null)
        {
            for (Map.Entry<String, PayloadbuilderCatalogInstance> entry : pb.catalogs()
                    .entrySet())
            {
                String alias = trimToNull(entry.getKey());
                if (alias == null)
                {
                    throw new IllegalArgumentException(ERROR_ALIAS_REQUIRED);
                }
                if (byAlias.containsKey(alias))
                {
                    throw new IllegalArgumentException(ERROR_DUPLICATE_ALIAS + alias);
                }

                PayloadbuilderCatalogInstance instance = entry.getValue();
                if (instance == null)
                {
                    throw new IllegalArgumentException(ERROR_INSTANCE_OBJECT + alias + ERROR_INSTANCE_OBJECT_SUFFIX);
                }

                String catalogId = trimToNull(instance.catalogId());
                if (catalogId == null)
                {
                    throw new IllegalArgumentException(ERROR_CATALOG_ID_REQUIRED + alias + "'");
                }

                Map<String, Object> properties = new LinkedHashMap<>();
                if (instance.properties() != null)
                {
                    for (Map.Entry<String, Object> property : instance.properties()
                            .entrySet())
                    {
                        String propertyKey = trimToNull(property.getKey());
                        if (propertyKey != null)
                        {
                            properties.put(propertyKey, property.getValue());
                        }
                    }
                }

                byAlias.put(alias, new PayloadbuilderCatalogState.Instance(alias, catalogId, properties));
            }
        }

        if (defaultCatalogAlias != null
                && !byAlias.containsKey(defaultCatalogAlias))
        {
            throw new IllegalArgumentException(ERROR_DEFAULT_ALIAS_MISMATCH);
        }

        return new PayloadbuilderCatalogState(defaultCatalogAlias, selectedEnvironmentId, byAlias);
    }

    static void applyToSession(QuerySession session, PayloadbuilderCatalogState state)
    {
        session.setDefaultCatalogAlias(state.defaultCatalogAlias());
        for (PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            for (Map.Entry<String, Object> property : instance.properties()
                    .entrySet())
            {
                ValueVector vector = property.getValue() == null ? ValueVector.literalNull(ResolvedType.ANY, 1)
                        : ValueVector.literalAny(1, property.getValue());
                session.setCatalogProperty(instance.alias(), property.getKey(), vector);
            }
        }
    }

    static Object buildEngineStatePatch(IQuerySession session, PayloadbuilderCatalogState input, Map<String, PayloadbuilderCatalogProviderContributor> providersByAlias, String sessionId)
    {
        Map<String, Object> catalogsPatch = new LinkedHashMap<>();
        boolean defaultAliasSwitched = !Objects.equals(input.defaultCatalogAlias, session.getDefaultCatalogAlias());
        for (PayloadbuilderCatalogState.Instance instance : input.instancesByAlias()
                .values())
        {
            PayloadbuilderCatalogProviderContributor provider = providersByAlias.get(instance.alias());
            Map<String, Object> changedProperties = provider != null ? provider.buildCatalogPatch(session, instance.alias(), instance.properties())
                    : PayloadbuilderCatalogProviderContributor.compareInputProperties(session, instance.alias(), instance.properties());

            if (!changedProperties.isEmpty())
            {
                Map<String, Object> instancePatch = new LinkedHashMap<>();
                instancePatch.put(KEY_CATALOG_ID, instance.catalogId());
                instancePatch.put(KEY_PROPERTIES, changedProperties);
                catalogsPatch.put(instance.alias(), instancePatch);
            }
        }

        Map<String, Object> payloadbuilderPatch = new LinkedHashMap<>();
        if (!catalogsPatch.isEmpty())
        {
            payloadbuilderPatch.put(KEY_CATALOGS, catalogsPatch);
        }
        if (defaultAliasSwitched)
        {
            payloadbuilderPatch.put(KEY_DEFAULT_CATALOGALIAS, session.getDefaultCatalogAlias());
        }
        payloadbuilderPatch.put("sessionId", sessionId);

        Map<String, Object> root = new LinkedHashMap<>();
        root.put(KEY_PAYLOADBUILDER, payloadbuilderPatch);
        return root;
    }

    /** {@code state} with {@code changes} merged over the properties of the catalog instance {@code alias}. */
    static PayloadbuilderCatalogState withProperties(PayloadbuilderCatalogState state, String alias, Map<String, Object> changes)
    {
        PayloadbuilderCatalogState.Instance instance = state.instancesByAlias()
                .get(alias);
        if (instance == null)
        {
            throw new IllegalArgumentException("No catalog with alias '" + alias + "'");
        }
        Map<String, Object> properties = new LinkedHashMap<>(instance.properties());
        properties.putAll(changes);
        Map<String, PayloadbuilderCatalogState.Instance> instances = new LinkedHashMap<>(state.instancesByAlias());
        instances.put(alias, new PayloadbuilderCatalogState.Instance(alias, instance.catalogId(), properties));
        return new PayloadbuilderCatalogState(state.defaultCatalogAlias(), state.selectedEnvironmentId(), instances);
    }

    /** An engine state patch that only changes the properties of one catalog instance, e.g. for a failed run's retry the panel should take. */
    static Object buildCatalogPropertiesPatch(String alias, String catalogId, Map<String, Object> properties, String sessionId)
    {
        Map<String, Object> root = new LinkedHashMap<>();
        Map<String, Object> payloadbuilderPatch = new LinkedHashMap<>();
        if (sessionId != null)
        {
            payloadbuilderPatch.put("sessionId", sessionId);
        }
        root.put(KEY_PAYLOADBUILDER, payloadbuilderPatch);
        mergeCatalogProperties(root, alias, catalogId, properties);
        return root;
    }

    /**
     * Adds {@code properties} to {@code patch}'s catalog instance {@code alias}, keeping what the patch already says about a property, also a null. The patch's maps are copied as they're changed,
     * since a provider's {@code buildCatalogPatch} may return an immutable map.
     */
    @SuppressWarnings("unchecked")
    static void mergeCatalogProperties(Object patch, String alias, String catalogId, Map<String, Object> properties)
    {
        Map<String, Object> root = (Map<String, Object>) patch;
        Map<String, Object> payloadbuilderPatch = new LinkedHashMap<>((Map<String, Object>) root.getOrDefault(KEY_PAYLOADBUILDER, Map.of()));
        Map<String, Object> catalogs = new LinkedHashMap<>((Map<String, Object>) payloadbuilderPatch.getOrDefault(KEY_CATALOGS, Map.of()));
        Map<String, Object> instance = new LinkedHashMap<>((Map<String, Object>) catalogs.getOrDefault(alias, Map.of()));
        instance.putIfAbsent(KEY_CATALOG_ID, catalogId);
        Map<String, Object> instanceProperties = new LinkedHashMap<>((Map<String, Object>) instance.getOrDefault(KEY_PROPERTIES, Map.of()));
        for (Map.Entry<String, Object> entry : properties.entrySet())
        {
            if (!instanceProperties.containsKey(entry.getKey()))
            {
                instanceProperties.put(entry.getKey(), entry.getValue());
            }
        }
        instance.put(KEY_PROPERTIES, instanceProperties);
        catalogs.put(alias, instance);
        payloadbuilderPatch.put(KEY_CATALOGS, catalogs);
        root.put(KEY_PAYLOADBUILDER, payloadbuilderPatch);
    }

    record PayloadbuilderCatalogState(String defaultCatalogAlias, String selectedEnvironmentId, Map<String, Instance> instancesByAlias)
    {
        record Instance(String alias, String catalogId, Map<String, Object> properties)
        {
        }
    }
}
