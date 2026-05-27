package com.queryeer.backend.plugin.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

public interface PayloadbuilderCatalogProvider
{
    String catalogId();

    Catalog createCatalog();

    default Set<String> actions()
    {
        return Set.of();
    }

    default Object invoke(String action, Object payload)
    {
        return null;
    }

    /** Inject properties for this catalog / alias combo. */
    default void injectProperties(QuerySession querySession, String alias, Map<String, Object> properties)
    {
    }

    /**
     * After query execution, allows the provider to contribute catalog property changes to the engine state patch.
     *
     * <p>
     * Called for each catalog instance that this provider owns. The returned map is merged into the patch under {@code payloadbuilder.catalogs.<alias>.properties}. Return an empty map if nothing
     * changed.
     * </p>
     *
     * @param session The query session after execution
     * @param alias The catalog alias in the session
     * @param inputProperties The original input properties the frontend sent for this instance
     * @return Map of property key {@literal ->} new value, or empty map if nothing changed
     */
    default Map<String, Object> buildCatalogPatch(QuerySession session, String alias, Map<String, Object> inputProperties)
    {
        return Map.of();
    }

    /**
     * Static helper that compares each input property against the current session value. Providers that override {@link #buildCatalogPatch} can call this to get the generic input-key comparison, then
     * add their own native-property checks on top.
     */
    static Map<String, Object> compareInputProperties(QuerySession session, String alias, Map<String, Object> inputProperties)
    {
        Map<String, Object> changed = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : inputProperties.entrySet())
        {
            ValueVector current = session.getCatalogProperty(alias, entry.getKey());
            Object currentValue = (current == null
                    || current.size() == 0) ? null
                            : unwrapValue(current.valueAsObject(0));
            if (!Objects.equals(entry.getValue(), currentValue))
            {
                changed.put(entry.getKey(), currentValue);
            }
        }
        return changed;
    }

    /** Unwrap Payloadbuilder internal types to plain Java objects. */
    private static Object unwrapValue(Object object)
    {
        if (object instanceof UTF8String s)
        {
            return s.toString();
        }
        else if (object instanceof Decimal d)
        {
            return d.asBigDecimal();
        }
        else if (object instanceof EpochDateTime d)
        {
            return d.getLocalDateTime();
        }
        else if (object instanceof EpochDateTimeOffset d)
        {
            return d.getZonedDateTime();
        }
        return object;
    }
}
