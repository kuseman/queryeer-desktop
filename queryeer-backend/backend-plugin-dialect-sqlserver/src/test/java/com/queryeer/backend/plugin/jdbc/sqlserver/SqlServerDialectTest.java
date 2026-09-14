package com.queryeer.backend.plugin.jdbc.sqlserver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class SqlServerDialectTest
{
    @Test
    void columnQueryReadsKeysFromCatalogViewsInsteadOfJdbcMetadata()
    {
        assertTrue(SqlServerDialect.SQL_COLUMNS.contains("sys.indexes"));
        assertTrue(SqlServerDialect.SQL_COLUMNS.contains("sys.foreign_key_columns"));
    }

    @Test
    void appliesPrimaryAndForeignKeyMetadata() throws Exception
    {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getBoolean("is_primary_key")).thenReturn(true);
        when(rs.getString("referenced_schema")).thenReturn("dbo");
        when(rs.getString("referenced_table")).thenReturn("parent");
        when(rs.getString("referenced_column")).thenReturn("id");
        Map<String, Object> attrs = new LinkedHashMap<>();

        SqlServerDialect.applyKeyMetadata(rs, attrs);

        assertEquals(Map.of("primaryKey", true, "foreignKey", true, "referencesSchema", "dbo", "referencesTable", "parent", "referencesColumn", "id"), attrs);
    }
}
