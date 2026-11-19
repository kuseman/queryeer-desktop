package com.queryeer.backend.plugin.jdbc.sqlserver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

class SqlServerConnectionSetupTest
{
    @Test
    void offersWindowsNativeAuthenticationOnWindowsOnly()
    {
        assertEquals(List.of("SQL_SERVER_AUTH", "WINDOWS_NATIVE_AUTH", "WINDOWS_NTLM_AUTH", "JAVA_KERBEROS"), authOptions(SqlServerConnectionSetup.build(true)));
        assertEquals(List.of("SQL_SERVER_AUTH", "WINDOWS_NTLM_AUTH", "JAVA_KERBEROS"), authOptions(SqlServerConnectionSetup.build(false)));
    }

    @Test
    void showsUsernameAndPasswordForSqlServerAndNtlmAuthentication()
    {
        JdbcConnectionSetupDefinition setup = SqlServerConnectionSetup.build(true);
        Map<String, List<String>> expected = Map.of("authType", List.of("SQL_SERVER_AUTH", "WINDOWS_NTLM_AUTH"));
        assertEquals(expected, field(setup, "username").visibleWhen());
        assertEquals(expected, field(setup, "password").visibleWhen());
        assertEquals(Map.of("authType", List.of("WINDOWS_NTLM_AUTH")), field(setup, "domain").visibleWhen());
    }

    @Test
    void hasNoPortDefaultSoNamedInstancesKeepTheirPort()
    {
        // The form saves defaults; a saved port would make the driver ignore instanceName
        assertNull(field(SqlServerConnectionSetup.build(true), "port").defaultValue());
        String url = SqlServerUrlBuilder.buildUrl(Map.<String, Object>of("host", "db", "instanceName", "SQLEXPRESS"));
        assertTrue(url.startsWith("jdbc:sqlserver://db\\SQLEXPRESS;"), url);
    }

    private static List<String> authOptions(JdbcConnectionSetupDefinition setup)
    {
        return field(setup, "authType").options()
                .stream()
                .map(JdbcConnectionFieldOption::value)
                .toList();
    }

    private static JdbcConnectionFieldDefinition field(JdbcConnectionSetupDefinition setup, String id)
    {
        return setup.fields()
                .stream()
                .filter(f -> f.id()
                        .equals(id))
                .findFirst()
                .orElseThrow();
    }
}
