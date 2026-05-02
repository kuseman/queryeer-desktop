package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.util.Map;
import java.util.Properties;

final class SqlServerUrlBuilder
{
    /**
     * Builds the JDBC URL for the SQL Server connection. Format: {@code jdbc:sqlserver://<host>[:<port>][\\<instance>]}
     */
    static String buildUrl(Map<String, Object> properties)
    {
        String host = text(properties.get("host"));
        if (host == null)
        {
            throw new IllegalArgumentException("host is required for SQL Server connections");
        }

        StringBuilder url = new StringBuilder("jdbc:sqlserver://");
        url.append(host);

        Object portObj = properties.get("port");
        if (portObj != null)
        {
            int port = toInt(portObj, 1433);
            if (port > 0)
            {
                url.append(':')
                        .append(port);
            }
        }

        String instanceName = text(properties.get("instanceName"));
        if (instanceName != null)
        {
            url.append('\\')
                    .append(instanceName);
        }

        return url.toString();
    }

    /**
     * Builds the JDBC {@link Properties} object for the connection, including authentication settings, database name, and TLS options.
     */
    static Properties buildConnectionProperties(Map<String, Object> properties)
    {
        Properties props = new Properties();

        String database = text(properties.get("database"));
        if (database != null)
        {
            props.setProperty("databaseName", database);
        }

        SqlServerAuthType authType = SqlServerAuthType.fromString(text(properties.get("authType")));

        switch (authType)
        {
            case SQL_SERVER_AUTH ->
            {
                String username = text(properties.get("username"));
                String password = text(properties.get("password"));
                if (username != null)
                {
                    props.setProperty("user", username);
                }
                if (password != null)
                {
                    props.setProperty("password", password);
                }
            }
            case WINDOWS_NATIVE_AUTH ->
            {
                props.setProperty("integratedSecurity", "true");
            }
            case WINDOWS_NTLM_AUTH ->
            {
                props.setProperty("integratedSecurity", "true");
                props.setProperty("authenticationScheme", "NTLM");
                String domain = text(properties.get("domain"));
                if (domain != null)
                {
                    props.setProperty("domain", domain);
                }
                String username = text(properties.get("username"));
                String password = text(properties.get("password"));
                if (username != null)
                {
                    props.setProperty("user", username);
                }
                if (password != null)
                {
                    props.setProperty("password", password);
                }
            }
            case JAVA_KERBEROS ->
            {
                props.setProperty("integratedSecurity", "true");
                props.setProperty("authenticationScheme", "JavaKerberos");
                String krb5ConfigFile = text(properties.get("krb5ConfigFile"));
                if (krb5ConfigFile != null)
                {
                    System.setProperty("java.security.krb5.conf", krb5ConfigFile);
                }
                String jaasConfigEntry = text(properties.get("jaasConfigEntry"));
                if (jaasConfigEntry != null)
                {
                    props.setProperty("jaasConfigurationName", jaasConfigEntry);
                }
            }
            default ->
            {
                // unknown auth type — no authentication properties set
            }
        }

        String encrypt = text(properties.get("encrypt"));
        if (encrypt != null)
        {
            props.setProperty("encrypt", encrypt);
        }
        else
        {
            props.setProperty("encrypt", "true");
        }

        Object trustCert = properties.get("trustServerCertificate");
        if (Boolean.TRUE.equals(trustCert)
                || "true".equalsIgnoreCase(String.valueOf(trustCert)))
        {
            props.setProperty("trustServerCertificate", "true");
        }

        String hostNameInCert = text(properties.get("hostNameInCertificate"));
        if (hostNameInCert != null)
        {
            props.setProperty("hostNameInCertificate", hostNameInCert);
        }

        return props;
    }

    private static String text(Object value)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }

    private static int toInt(Object value, int fallback)
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

    private SqlServerUrlBuilder()
    {
    }
}
