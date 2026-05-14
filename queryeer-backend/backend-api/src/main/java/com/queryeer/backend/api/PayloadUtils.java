package com.queryeer.backend.api;

import java.util.Map;

public final class PayloadUtils
{
    /** Return string value from provided map key. */
    public static String stringValue(Map<?, ?> properties, String key)
    {
        Object value = properties.get(key);
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? null
                    : trimmed;
        }
        return null;
    }

    /** Normalize input value to a string or null. */
    public static String stringValue(Object value, String defaultValue)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? defaultValue
                    : trimmed;
        }
        return defaultValue;
    }

    /** Trim provided value to null */
    public static String trimToNull(String value)
    {
        if (value == null)
        {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }

    public static boolean isBlank(String string)
    {
        return string == null
                || string.isBlank();
    }

    public static Integer toNullableInteger(Object value)
    {
        if (value instanceof Number n)
        {
            return n.intValue();
        }
        return null;
    }

    public static <T> T getIfNull(T value, T defaultValue)
    {
        return value != null ? value
                : defaultValue;
    }

    public static String nullToEmpty(String value)
    {
        return value == null ? ""
                : value;
    }

    public static int toInt(Object value, int fallback)
    {
        if (value instanceof Number n)
        {
            return n.intValue();
        }
        if (value instanceof String s)
        {
            try
            {
                return Integer.parseInt(s.trim());
            }
            catch (NumberFormatException ignored)
            {
            }
        }
        return fallback;
    }
}
