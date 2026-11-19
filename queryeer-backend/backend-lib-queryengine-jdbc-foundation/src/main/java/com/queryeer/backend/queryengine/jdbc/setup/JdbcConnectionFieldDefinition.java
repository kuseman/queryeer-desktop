package com.queryeer.backend.queryengine.jdbc.setup;

import java.util.List;
import java.util.Map;

/**
 * Defines a single field in a dialect's connection setup form.
 *
 * <p>
 * {@code visibleWhen} is an optional map of {@code fieldId -> accepted values}. When non-null the field is only shown if every field named in the map has one of its accepted values (a field's default
 * counts when it has no value). A null map means the field is always visible.
 *
 * <p>
 * The form is rendered on the machine the backend runs on, so a dialect can leave out options that do not apply to the current platform.
 */
public record JdbcConnectionFieldDefinition(String id, String label, JdbcConnectionFieldType type, boolean required, String description, List<JdbcConnectionFieldOption> options, Object defaultValue,
        Map<String, List<String>> visibleWhen)
{
}
