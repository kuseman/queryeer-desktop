package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Map;

/**
 * Defines a single field in a dialect's connection setup form.
 *
 * <p>
 * {@code visibleWhen} is an optional map of {@code fieldId -> requiredValue}. When non-null the field is only shown if every entry in the map matches the current form values. A null map means the
 * field is always visible.
 */
public record JdbcConnectionFieldDefinition(String id, String label, JdbcConnectionFieldType type, boolean required, String description, List<JdbcConnectionFieldOption> options, Object defaultValue,
        Map<String, String> visibleWhen)
{
}
