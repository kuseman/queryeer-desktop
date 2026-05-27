package com.queryeer.backend.plugin.jdbc.postgres;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.toInt;

import java.util.Map;
import java.util.Properties;

final class PostgresUrlBuilder
{
    private static final String KEY_SSLMODE = "sslMode";

    /**
     * Builds the JDBC URL for a PostgreSQL connection. Format: {@code jdbc:postgresql://<host>[:<port>]/<database>?sslmode=<mode>}
     */
    static String buildUrl(Map<String, Object> properties)
    {
        String host = stringValue(properties, "host");
        if (host == null)
        {
            throw new IllegalArgumentException("host is required for PostgreSQL connections");
        }

        StringBuilder url = new StringBuilder("jdbc:postgresql://");
        url.append(host);

        int port = toInt(properties.get("port"), 5432);
        if (port > 0)
        {
            url.append(':')
                    .append(port);
        }

        String database = stringValue(properties, "database");
        if (database != null)
        {
            url.append('/')
                    .append(database);
        }

        String sslMode = stringValue(properties, KEY_SSLMODE);
        if (sslMode != null
                && !"prefer".equals(sslMode))
        {
            url.append("?sslmode=")
                    .append(sslMode);
        }

        return url.toString();
    }

    /**
     * Builds a JDBC URL that targets a specific database, replacing the initial database from properties. Used during schema crawling when we need to connect to a database other than the default.
     */
    static String buildUrlForDatabase(Map<String, Object> properties, String targetDatabase)
    {
        String base = buildUrl(properties);

        String database = stringValue(properties, "database");
        if (database != null
                && targetDatabase != null)
        {
            base = base.replace("/" + database, "/" + targetDatabase);
        }
        else if (targetDatabase != null)
        {
            if (base.contains("?"))
            {
                base = base.replace("?", "/" + targetDatabase + "?");
            }
            else
            {
                base = base + "/" + targetDatabase;
            }
        }

        return base;
    }

    /**
     * Builds the JDBC {@link Properties} object for the connection.
     */
    static Properties buildConnectionProperties(Map<String, Object> properties)
    {
        Properties props = new Properties();

        String username = stringValue(properties, "username");
        if (username != null)
        {
            props.setProperty("user", username);
        }

        String password = stringValue(properties, "password");
        if (password != null)
        {
            props.setProperty("password", password);
        }

        return props;
    }

    private PostgresUrlBuilder()
    {
    }
}
