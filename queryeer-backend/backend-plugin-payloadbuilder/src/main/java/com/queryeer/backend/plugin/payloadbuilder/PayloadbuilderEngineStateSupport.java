package com.queryeer.backend.plugin.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

final class PayloadbuilderEngineStateSupport
{
    private PayloadbuilderEngineStateSupport()
    {
    }

    static PayloadbuilderCatalogState parse(Object engineState)
    {
        if (!(engineState instanceof Map<?, ?> root))
        {
            return new PayloadbuilderCatalogState(null, Map.of());
        }

        Object payloadbuilder = root.get("payloadbuilder");
        if (!(payloadbuilder instanceof Map<?, ?> payloadbuilderMap))
        {
            return new PayloadbuilderCatalogState(null, Map.of());
        }

        String defaultCatalogAlias = normalizeAlias(payloadbuilderMap.get("defaultCatalogAlias"));
        if (defaultCatalogAlias.isEmpty())
        {
            defaultCatalogAlias = null;
        }

        Object catalogs = payloadbuilderMap.get("catalogs");
        if (!(catalogs instanceof Map<?, ?> catalogsMap))
        {
            return new PayloadbuilderCatalogState(defaultCatalogAlias, Map.of());
        }

        Map<String, PayloadbuilderCatalogState.Instance> byAlias = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : catalogsMap.entrySet())
        {
            String alias = normalizeAlias(entry.getKey());
            if (alias.isEmpty())
            {
                throw new IllegalArgumentException("Catalog alias is required");
            }
            if (byAlias.containsKey(alias))
            {
                throw new IllegalArgumentException("Duplicate catalog alias: " + alias);
            }
            if (!(entry.getValue() instanceof Map<?, ?> instanceMap))
            {
                throw new IllegalArgumentException("Catalog instance for alias '" + alias + "' must be an object");
            }

            String catalogId = normalizeAlias(instanceMap.get("catalogId"));
            if (catalogId.isEmpty())
            {
                throw new IllegalArgumentException("catalogId is required for alias '" + alias + "'");
            }

            Map<String, Object> properties = new LinkedHashMap<>();
            Object propertiesObject = instanceMap.get("properties");
            if (propertiesObject instanceof Map<?, ?> propertiesMap)
            {
                for (Map.Entry<?, ?> property : propertiesMap.entrySet())
                {
                    String propertyKey = normalizeAlias(property.getKey());
                    if (!propertyKey.isEmpty())
                    {
                        properties.put(propertyKey, property.getValue());
                    }
                }
            }

            byAlias.put(alias, new PayloadbuilderCatalogState.Instance(alias, catalogId, properties));
        }

        if (defaultCatalogAlias != null
                && !byAlias.containsKey(defaultCatalogAlias))
        {
            throw new IllegalArgumentException("defaultCatalogAlias must match a mapped alias");
        }

        return new PayloadbuilderCatalogState(defaultCatalogAlias, byAlias);
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

    static Object buildEngineStatePatch(QuerySession session, PayloadbuilderCatalogState input)
    {
        Map<String, Object> catalogsPatch = new LinkedHashMap<>();
        for (PayloadbuilderCatalogState.Instance instance : input.instancesByAlias()
                .values())
        {
            Map<String, Object> changedProperties = new LinkedHashMap<>();
            for (Map.Entry<String, Object> property : instance.properties()
                    .entrySet())
            {
                ValueVector current = session.getCatalogProperty(instance.alias(), property.getKey());
                Object currentValue = current == null
                        || current.size() == 0 ? null
                                : current.valueAsObject(0);
                if (!Objects.equals(property.getValue(), currentValue))
                {
                    changedProperties.put(property.getKey(), currentValue);
                }
            }

            if (!changedProperties.isEmpty())
            {
                Map<String, Object> instancePatch = new LinkedHashMap<>();
                instancePatch.put("catalogId", instance.catalogId());
                instancePatch.put("properties", changedProperties);
                catalogsPatch.put(instance.alias(), instancePatch);
            }
        }

        if (catalogsPatch.isEmpty())
        {
            return null;
        }

        Map<String, Object> payloadbuilderPatch = new LinkedHashMap<>();
        payloadbuilderPatch.put("catalogs", catalogsPatch);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("payloadbuilder", payloadbuilderPatch);
        return root;
    }

    private static String normalizeAlias(Object value)
    {
        if (!(value instanceof String text))
        {
            return "";
        }
        return text.trim();
    }

    record PayloadbuilderCatalogState(String defaultCatalogAlias, Map<String, Instance> instancesByAlias)
    {
        record Instance(String alias, String catalogId, Map<String, Object> properties)
        {
        }
    }
}
