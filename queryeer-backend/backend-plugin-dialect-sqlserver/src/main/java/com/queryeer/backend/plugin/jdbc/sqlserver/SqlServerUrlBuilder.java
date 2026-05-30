package com.queryeer.backend.plugin.jdbc.sqlserver;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.toInt;

import java.util.Map;
import java.util.Properties;

final class SqlServerUrlBuilder
{
    /**
     * Builds the JDBC URL for the SQL Server connection. Format: {@code jdbc:sqlserver://<host>[:<port>][\\<instance>]}
     */
    static String buildUrl(Map<String, Object> properties)
    {
        String host = stringValue(properties, "host");
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

        String instanceName = stringValue(properties, "instanceName");
        if (instanceName != null)
        {
            url.append('\\')
                    .append(instanceName);
        }

        String database = stringValue(properties, "database");
        if (database != null)
        {
            url.append(";databaseName=")
                    .append(database);
        }

        SqlServerAuthType authType = SqlServerAuthType.fromString(stringValue(properties, "authType"));
        switch (authType)
        {
            case WINDOWS_NATIVE_AUTH -> {
                url.append(";integratedSecurity=true");
            }
            case WINDOWS_NTLM_AUTH -> {
                url.append(";integratedSecurity=true");
                url.append(";authenticationScheme=NTLM");
                String domain = stringValue(properties, "domain");
                if (domain != null)
                {
                    url.append(";domain=")
                            .append(domain);
                }
            }
            case JAVA_KERBEROS -> {
                url.append(";integratedSecurity=true");
                url.append(";authenticationScheme=JavaKerberos");
                String jaasConfigEntry = stringValue(properties, "jaasConfigEntry");
                if (jaasConfigEntry != null)
                {
                    url.append(";jaasConfigurationName=")
                            .append(jaasConfigEntry);
                }
            }
            default -> {
            }
        }

        String encrypt = stringValue(properties, "encrypt");
        if (encrypt != null)
        {
            url.append(";encrypt=")
                    .append(encrypt);
        }
        else
        {
            url.append(";encrypt=true");
        }

        Object trustCert = properties.get("trustServerCertificate");
        if (Boolean.TRUE.equals(trustCert)
                || "true".equalsIgnoreCase(String.valueOf(trustCert)))
        {
            url.append(";trustServerCertificate=true");
        }

        String hostNameInCert = stringValue(properties, "hostNameInCertificate");
        if (hostNameInCert != null)
        {
            url.append(";hostNameInCertificate=")
                    .append(hostNameInCert);
        }

        return url.toString();
    }

    /**
     * Builds the JDBC {@link Properties} object for the connection, including authentication settings, database name, and TLS options.
     */
    static Properties buildConnectionProperties(Map<String, Object> properties)
    {
        Properties props = new Properties();

        SqlServerAuthType authType = SqlServerAuthType.fromString(stringValue(properties, "authType"));

        switch (authType)
        {
            case SQL_SERVER_AUTH -> {
                String username = stringValue(properties, "username");
                String password = stringValue(properties, "password");
                if (username != null)
                {
                    props.setProperty("user", username);
                }
                if (password != null)
                {
                    props.setProperty("password", password);
                }
            }
            case WINDOWS_NATIVE_AUTH -> {
            }
            case WINDOWS_NTLM_AUTH -> {
                String username = stringValue(properties, "username");
                String password = stringValue(properties, "password");
                if (username != null)
                {
                    props.setProperty("user", username);
                }
                if (password != null)
                {
                    props.setProperty("password", password);
                }
            }
            case JAVA_KERBEROS -> {
                String krb5ConfigFile = stringValue(properties, "krb5ConfigFile");
                if (krb5ConfigFile != null)
                {
                    // Kerberos realm/KDC config is a JVM system property, not a SQL Server JDBC URL/property option.
                    System.setProperty("java.security.krb5.conf", krb5ConfigFile);
                }
            }
            default -> {
                // unknown auth type — no authentication properties set
            }
        }

        return props;
    }

    private SqlServerUrlBuilder()
    {
    }
}
