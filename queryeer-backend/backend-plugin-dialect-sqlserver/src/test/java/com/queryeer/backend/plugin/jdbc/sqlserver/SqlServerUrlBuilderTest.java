package com.queryeer.backend.plugin.jdbc.sqlserver;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;

class SqlServerUrlBuilderTest
{
    @Test
    void defaultsApplicationNameToQueryeer()
    {
        Properties properties = SqlServerUrlBuilder.buildConnectionProperties(Map.of());

        assertEquals("Queryeer", properties.getProperty("applicationName"));
    }

    @Test
    void usesConfiguredApplicationName()
    {
        Properties properties = SqlServerUrlBuilder.buildConnectionProperties(Map.of("applicationName", "Reporting Tool"));

        assertEquals("Reporting Tool", properties.getProperty("applicationName"));
    }

    @Test
    void usesDefaultForBlankApplicationName()
    {
        Properties properties = SqlServerUrlBuilder.buildConnectionProperties(Map.of("applicationName", "  "));

        assertEquals("Queryeer", properties.getProperty("applicationName"));
    }
}
