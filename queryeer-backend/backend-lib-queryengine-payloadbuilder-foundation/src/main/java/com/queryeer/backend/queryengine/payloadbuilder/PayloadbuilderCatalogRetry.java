package com.queryeer.backend.queryengine.payloadbuilder;

import static java.util.Objects.requireNonNull;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What {@link PayloadbuilderCatalogProviderContributor#retryAfterFailure} asks for: run the query once more with these input properties changed, e.g. the {@code connectionId} of the connection whose
 * endpoint the query set itself.
 *
 * @param properties the input properties to change, a null value clearing one; merged over the ones the file's catalog panel submitted. Not empty
 * @param message shown in the query's output when it runs again, e.g. "The query's endpoint is connection 'Prod': ran again with it"; null for none
 * @since 0.24.0
 */
public record PayloadbuilderCatalogRetry(Map<String, Object> properties, String message)
{
    public PayloadbuilderCatalogRetry
    {
        requireNonNull(properties, "properties");
        if (properties.isEmpty())
        {
            throw new IllegalArgumentException("A retry needs at least one property to change");
        }
        // Not Map.copyOf: a null value is a change too, e.g. clearing an index that belongs to another connection
        properties = Collections.unmodifiableMap(new LinkedHashMap<>(properties));
    }
}
