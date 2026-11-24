package com.queryeer.backend.queryengine.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.CatalogException;
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
     * Clear properties injected for this catalog / alias after query execution. Implementations that translate input properties to native catalog properties must clear both forms here.
     */
    default void clearProperties(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        for (String propertyKey : inputProperties.keySet())
        {
            session.setCatalogProperty(alias, propertyKey, (Object) null);
        }
    }

    /**
     * After query execution, the catalog property changes the file's catalog panel should show, e.g. a {@code use alias.database = 'x'} in the query. The default reports each input property the query
     * changed ({@link #compareInputProperties}), as for a catalog without a provider. Override it to map changed native properties back to input properties as well.
     *
     * <p>
     * Until 0.22.0 the default reported nothing.
     * </p>
     */
    default Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
    {
        return compareInputProperties(session, alias, inputProperties);
    }

    /**
     * A run failed with {@code exception}, which this catalog threw for {@code alias}. Whether to run the query once more with changed input properties, as Queryeer's Swing version did: e.g. on
     * payloadbuilder's {@code CredentialsException}, when the query set its own endpoint ({@code use es.endpoint = '...'}) and that is another configured connection than the one selected, return that
     * connection's {@code connectionId}. Null fails the run as before, which is the default.
     *
     * <p>
     * Called after the failed run and before its properties are cleared, so {@code session} still holds what the query set. The engine runs again at most once, and only when the failed run published
     * nothing (no rows, no messages) and created or replaced no temp table, so a retry never shows results twice. The changed properties reach the file's catalog panel in every case: with the
     * completed run's catalog patch, or with the failure ({@code error.details.engineState}), so the next run uses them. An exception from this method is added to the run's error as suppressed, and
     * the run fails as before; a {@code SecuritySessionClosedException} is thrown on, so the frontend asks to unlock the vault.
     * </p>
     *
     * <p>
     * {@code CredentialsException} is in {@code payloadbuilder-catalog-common}, which each plugin bundles: check for it with the plugin's own copy, the one its catalog throws.
     * </p>
     *
     * @param session the query session after the failed run
     * @param alias the catalog alias the exception names
     * @param inputProperties the properties the file's catalog panel submitted
     * @param exception the failure, found in the run's exception or its causes
     * @since 0.24.0
     */
    default PayloadbuilderCatalogRetry retryAfterFailure(IQuerySession session, String alias, Map<String, Object> inputProperties, CatalogException exception)
    {
        return null;
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
