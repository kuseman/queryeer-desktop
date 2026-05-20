package com.queryeer.backend.plugin.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
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

        var pb = engineState.payloadbuilder();
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
        if (state.defaultCatalogAlias() != null)
        {
            session.setDefaultCatalogAlias(state.defaultCatalogAlias());
        }
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

    static Object buildEngineStatePatch(QuerySession session, PayloadbuilderCatalogState input, Map<String, PayloadbuilderCatalogProvider> providersByAlias)
    {
        Map<String, Object> catalogsPatch = new LinkedHashMap<>();
        boolean defaultAliasSwitched = !Objects.equals(input.defaultCatalogAlias, session.getDefaultCatalogAlias());
        for (PayloadbuilderCatalogState.Instance instance : input.instancesByAlias()
                .values())
        {
            PayloadbuilderCatalogProvider provider = providersByAlias.get(instance.alias());
            Map<String, Object> changedProperties;
            if (provider != null)
            {
                changedProperties = provider.buildCatalogPatch(session, instance.alias(), instance.properties());
            }
            else
            {
                changedProperties = PayloadbuilderCatalogProvider.compareInputProperties(session, instance.alias(), instance.properties());
            }

            if (!changedProperties.isEmpty())
            {
                Map<String, Object> instancePatch = new LinkedHashMap<>();
                instancePatch.put(KEY_CATALOG_ID, instance.catalogId());
                instancePatch.put(KEY_PROPERTIES, changedProperties);
                catalogsPatch.put(instance.alias(), instancePatch);
            }
        }

        if (catalogsPatch.isEmpty()
                && !defaultAliasSwitched)
        {
            return null;
        }

        Map<String, Object> payloadbuilderPatch = new LinkedHashMap<>();
        payloadbuilderPatch.put(KEY_CATALOGS, catalogsPatch);
        if (defaultAliasSwitched)
        {
            payloadbuilderPatch.put(KEY_DEFAULT_CATALOGALIAS, session.getDefaultCatalogAlias());
        }
        Map<String, Object> root = new LinkedHashMap<>();
        root.put(KEY_PAYLOADBUILDER, payloadbuilderPatch);
        return root;
    }

    record PayloadbuilderCatalogState(String defaultCatalogAlias, String selectedEnvironmentId, Map<String, Instance> instancesByAlias)
    {
        record Instance(String alias, String catalogId, Map<String, Object> properties)
        {
        }
    }
}
