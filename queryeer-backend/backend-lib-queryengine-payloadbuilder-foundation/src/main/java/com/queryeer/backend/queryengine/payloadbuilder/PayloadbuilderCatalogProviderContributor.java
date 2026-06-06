package com.queryeer.backend.queryengine.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;

/**
 * SPI interface that external plugins implement to contribute catalog types to the payloadbuilder query engine.
 *
 * <p>
 * Implementations are registered via {@code PluginServiceRegistry} in the plugin's activation phase:
 * </p>
 *
 * <pre>{@code
 * public void activate(BackendPluginContext context, PluginDescriptor descriptor)
 * {
 *     context.services()
 *             .register(PayloadbuilderCatalogProviderContributor.class, new MyCatalogContributor());
 * }
 * }</pre>
 *
 * <p>
 * The payloadbuilder backend plugin discovers all registered contributors and wraps them into full catalog providers.
 * </p>
 */
public interface PayloadbuilderCatalogProviderContributor
{
    /** Unique identifier for this catalog type (e.g. "mycatalog"). */
    String catalogId();

    /** Create a new catalog instance. */
    Catalog createCatalog();

    /** Optional set of action names this contributor handles. */
    default Set<String> actions()
    {
        return Set.of();
    }

    /** Handle an action invocation. Returns null if the action is not handled. */
    default Object invoke(String action, Object payload)
    {
        return null;
    }

    /** Optional SQL editor services (completion, hover, symbol resolution) for this catalog provider. */
    default PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return PayloadbuilderCatalogSqlEditorServices.NONE;
    }

    /** Inject properties for this catalog / alias combo before query execution. Implementations should call {@code session.setCatalogProperty(...)} as needed. */
    default void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
    {
    }

    /**
     * After query execution, allows the provider to contribute catalog property changes to the engine state patch.
     */
    default Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        return Map.of();
    }

    /**
     * Compares each input property against the current session value. Providers that override {@link #buildCatalogPatch} can call this to get the generic input-key comparison, then add their own
     * native-property checks on top.
     */
    static Map<String, Object> compareInputProperties(IQuerySession session, String alias, Map<String, Object> inputProperties)
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
