package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

final class SqlServerConnectionSetup
{
    private static final String FIELD_AUTH_TYPE = "authType";

    static JdbcConnectionSetupDefinition build()
    {
        return build(System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT)
                .startsWith("windows"));
    }

    /** The form for this platform: Windows Native Authentication needs the Windows auth DLL, so it is offered on Windows only. */
    static JdbcConnectionSetupDefinition build(boolean windows)
    {
        List<JdbcConnectionFieldOption> authOptions = new ArrayList<>();
        authOptions.add(option(SqlServerAuthType.SQL_SERVER_AUTH));
        if (windows)
        {
            authOptions.add(option(SqlServerAuthType.WINDOWS_NATIVE_AUTH));
        }
        authOptions.add(option(SqlServerAuthType.WINDOWS_NTLM_AUTH));
        authOptions.add(option(SqlServerAuthType.JAVA_KERBEROS));

        List<JdbcConnectionFieldOption> encryptOptions = List.of(new JdbcConnectionFieldOption("true", "true — encrypt all traffic"),
                new JdbcConnectionFieldOption("strict", "strict — TLS 1.3 / enforce trust"), new JdbcConnectionFieldOption("false", "false — no encryption"));

        Map<String, List<String>> userAndPassword = Map.of(FIELD_AUTH_TYPE, List.of(SqlServerAuthType.SQL_SERVER_AUTH.name(), SqlServerAuthType.WINDOWS_NTLM_AUTH.name()));
        Map<String, List<String>> ntlmAuthOnly = Map.of(FIELD_AUTH_TYPE, List.of(SqlServerAuthType.WINDOWS_NTLM_AUTH.name()));
        Map<String, List<String>> javaKerberosOnly = Map.of(FIELD_AUTH_TYPE, List.of(SqlServerAuthType.JAVA_KERBEROS.name()));

        return new JdbcConnectionSetupDefinition(List.of(
                new JdbcConnectionFieldDefinition("host", "Host", JdbcConnectionFieldType.TEXT, true, "Hostname or IP address of the SQL Server instance", List.of(), null, null),

                // No default: a saved port overrides the instance name, and an empty one lets the driver find a named instance's port
                new JdbcConnectionFieldDefinition("port", "Port", JdbcConnectionFieldType.NUMBER, false, "TCP port. Leave empty for 1433, or for a named instance's own port", List.of(), null, null),

                new JdbcConnectionFieldDefinition("instanceName", "Instance Name", JdbcConnectionFieldType.TEXT, false, "Named instance, e.g. SQLEXPRESS (leave blank for the default instance)",
                        List.of(), null, null),

                new JdbcConnectionFieldDefinition("database", "Database", JdbcConnectionFieldType.TEXT, false, "Initial database to connect to", List.of(), null, null),

                new JdbcConnectionFieldDefinition("applicationName", "Application Name", JdbcConnectionFieldType.TEXT, false, "Application name reported to SQL Server", List.of(), "Queryeer", null),

                new JdbcConnectionFieldDefinition(FIELD_AUTH_TYPE, "Authentication", JdbcConnectionFieldType.SELECT, true, "Authentication scheme", authOptions,
                        SqlServerAuthType.SQL_SERVER_AUTH.name(), null),

                new JdbcConnectionFieldDefinition("username", "Username", JdbcConnectionFieldType.TEXT, true, null, List.of(), null, userAndPassword),

                new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, true, "Stored in security vault", List.of(), null, userAndPassword),

                new JdbcConnectionFieldDefinition("domain", "Windows Domain", JdbcConnectionFieldType.TEXT, false, "Optional Windows domain, e.g. CORP", List.of(), null, ntlmAuthOnly),

                new JdbcConnectionFieldDefinition("encrypt", "Encrypt", JdbcConnectionFieldType.SELECT, false, "Whether to encrypt the connection", encryptOptions, "true", null),

                new JdbcConnectionFieldDefinition("trustServerCertificate", "Trust Server Certificate", JdbcConnectionFieldType.BOOLEAN, false,
                        "Trust self-signed or untrusted server certificates (set true for local dev)", List.of(), false, null),

                new JdbcConnectionFieldDefinition("hostNameInCertificate", "Host Name In Certificate", JdbcConnectionFieldType.TEXT, false, "Expected host name in the TLS certificate, overrides SNI",
                        List.of(), null, null),

                new JdbcConnectionFieldDefinition("krb5ConfigFile", "Kerberos Config File (krb5.conf)", JdbcConnectionFieldType.FILE_PATH, false,
                        "Path to the krb5.conf / krb5.ini file for Java Kerberos authentication", List.of(), null, javaKerberosOnly),

                new JdbcConnectionFieldDefinition("jaasConfigEntry", "JAAS Config Entry Name", JdbcConnectionFieldType.TEXT, false,
                        "Entry name in jaas.conf to use for Kerberos login (default: SQLJDBCDriver)", List.of(), "SQLJDBCDriver", javaKerberosOnly)));
    }

    private static JdbcConnectionFieldOption option(SqlServerAuthType authType)
    {
        return new JdbcConnectionFieldOption(authType.name(), authType.displayName());
    }

    private SqlServerConnectionSetup()
    {
    }
}
