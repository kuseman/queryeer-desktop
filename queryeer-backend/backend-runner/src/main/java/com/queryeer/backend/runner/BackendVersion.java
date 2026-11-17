package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/** The backend's own version, written into {@code backend-version.properties} by the build. Built-in plugins report it, so dependency version ranges can target a Queryeer release. */
final class BackendVersion
{
    private static final String RESOURCE = "backend-version.properties";

    private BackendVersion()
    {
    }

    /** The version, or null when the resource is missing or was not filtered (e.g. classes compiled outside Maven). */
    static String get()
    {
        try (InputStream stream = BackendVersion.class.getResourceAsStream(RESOURCE))
        {
            if (stream == null)
            {
                return null;
            }
            Properties properties = new Properties();
            properties.load(stream);
            String version = properties.getProperty("version");
            return version == null
                    || version.isBlank()
                    || version.contains("${") ? null
                            : version.strip();
        }
        catch (IOException e)
        {
            return null;
        }
    }
}
