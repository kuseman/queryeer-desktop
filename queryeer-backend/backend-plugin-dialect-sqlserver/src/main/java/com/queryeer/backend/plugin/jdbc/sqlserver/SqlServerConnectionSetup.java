package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.util.List;
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
        List<JdbcConnectionFieldOption> authOptions = List.of(new JdbcConnectionFieldOption(SqlServerAuthType.SQL_SERVER_AUTH.name(), SqlServerAuthType.SQL_SERVER_AUTH.displayName()),
                new JdbcConnectionFieldOption(SqlServerAuthType.WINDOWS_NATIVE_AUTH.name(), SqlServerAuthType.WINDOWS_NATIVE_AUTH.displayName()),
                new JdbcConnectionFieldOption(SqlServerAuthType.WINDOWS_NTLM_AUTH.name(), SqlServerAuthType.WINDOWS_NTLM_AUTH.displayName()),
                new JdbcConnectionFieldOption(SqlServerAuthType.JAVA_KERBEROS.name(), SqlServerAuthType.JAVA_KERBEROS.displayName()));

        List<JdbcConnectionFieldOption> encryptOptions = List.of(new JdbcConnectionFieldOption("true", "true — encrypt all traffic"),
                new JdbcConnectionFieldOption("strict", "strict — TLS 1.3 / enforce trust"), new JdbcConnectionFieldOption("false", "false — no encryption"));

        Map<String, String> sqlAuthOnly = Map.of(FIELD_AUTH_TYPE, SqlServerAuthType.SQL_SERVER_AUTH.name());
        Map<String, String> ntlmAuthOnly = Map.of(FIELD_AUTH_TYPE, SqlServerAuthType.WINDOWS_NTLM_AUTH.name());
        Map<String, String> javaKerberosOnly = Map.of(FIELD_AUTH_TYPE, SqlServerAuthType.JAVA_KERBEROS.name());

        // Note: username/password appear for both SQL_SERVER_AUTH and WINDOWS_NTLM_AUTH.
        // visibleWhen supports a single value; the actual conditional rendering is handled
        // by SqlServerConnectionForm.tsx which evaluates both cases in JSX.
        return new JdbcConnectionSetupDefinition(
                List.of(new JdbcConnectionFieldDefinition("host", "Host", JdbcConnectionFieldType.TEXT, true, "Hostname or IP address of the SQL Server instance", List.of(), null, null),

                        new JdbcConnectionFieldDefinition("port", "Port", JdbcConnectionFieldType.NUMBER, false, "TCP port (default: 1433)", List.of(), 1433, null),

                        new JdbcConnectionFieldDefinition("instanceName", "Instance Name", JdbcConnectionFieldType.TEXT, false,
                                "Named instance, e.g. SQLEXPRESS (leave blank for the default instance)", List.of(), null, null),

                        new JdbcConnectionFieldDefinition("database", "Database", JdbcConnectionFieldType.TEXT, false, "Initial database to connect to", List.of(), null, null),

                        new JdbcConnectionFieldDefinition(FIELD_AUTH_TYPE, "Authentication", JdbcConnectionFieldType.SELECT, true, "Authentication scheme", authOptions,
                                SqlServerAuthType.SQL_SERVER_AUTH.name(), null),

                        new JdbcConnectionFieldDefinition("username", "Username", JdbcConnectionFieldType.TEXT, true, null, List.of(), null, sqlAuthOnly),

                        new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, true, "Stored in security vault", List.of(), null, sqlAuthOnly),

                        new JdbcConnectionFieldDefinition("domain", "Windows Domain", JdbcConnectionFieldType.TEXT, false, "Optional Windows domain, e.g. CORP", List.of(), null, ntlmAuthOnly),

                        new JdbcConnectionFieldDefinition("encrypt", "Encrypt", JdbcConnectionFieldType.SELECT, false, "Whether to encrypt the connection", encryptOptions, "true", null),

                        new JdbcConnectionFieldDefinition("trustServerCertificate", "Trust Server Certificate", JdbcConnectionFieldType.BOOLEAN, false,
                                "Trust self-signed or untrusted server certificates (set true for local dev)", List.of(), false, null),

                        new JdbcConnectionFieldDefinition("hostNameInCertificate", "Host Name In Certificate", JdbcConnectionFieldType.TEXT, false,
                                "Expected host name in the TLS certificate, overrides SNI", List.of(), null, null),

                        new JdbcConnectionFieldDefinition("krb5ConfigFile", "Kerberos Config File (krb5.conf)", JdbcConnectionFieldType.FOLDER_PATH, false,
                                "Path to the krb5.conf / krb5.ini file for Java Kerberos authentication", List.of(), null, javaKerberosOnly),

                        new JdbcConnectionFieldDefinition("jaasConfigEntry", "JAAS Config Entry Name", JdbcConnectionFieldType.TEXT, false,
                                "Entry name in jaas.conf to use for Kerberos login (default: SQLJDBCDriver)", List.of(), "SQLJDBCDriver", javaKerberosOnly)));
    }

    private SqlServerConnectionSetup()
    {
    }
}
