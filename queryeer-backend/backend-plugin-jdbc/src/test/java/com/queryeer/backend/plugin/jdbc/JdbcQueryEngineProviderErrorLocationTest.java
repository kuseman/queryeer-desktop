package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class JdbcQueryEngineProviderErrorLocationTest
{
    @Test
    void lineInLaterBatchIsMovedToItsLineInTheText()
    {
        String sql = "SELECT 1\nGO\n\nSELECT\n  bad\n";
        Map<String, Object> details = new LinkedHashMap<>(Map.of("line", 2));

        JdbcQueryEngineProvider.resolveErrorLocation(details, sql, sql.indexOf("SELECT\n"));

        assertEquals(5, details.get("line"));
    }

    @Test
    void lineIsUnchangedWhenStatementStartsTheText()
    {
        Map<String, Object> details = new LinkedHashMap<>(Map.of("line", 3));

        JdbcQueryEngineProvider.resolveErrorLocation(details, "a\nb\nc", 0);

        assertEquals(3, details.get("line"));
    }

    @Test
    void lineIsUnchangedWhenStatementOffsetIsUnknown()
    {
        Map<String, Object> details = new LinkedHashMap<>(Map.of("line", 3));

        JdbcQueryEngineProvider.resolveErrorLocation(details, "\n\na\nb\nc", null);

        assertEquals(3, details.get("line"));
    }

    @Test
    void columnOnFirstLineOfStatementIsShiftedByWhereTheStatementStarts()
    {
        String sql = "SELECT 1; SELECT bad";
        Map<String, Object> details = new LinkedHashMap<>(Map.of("line", 1, "column", 8));

        JdbcQueryEngineProvider.resolveErrorLocation(details, sql, 10);

        assertEquals(1, details.get("line"));
        assertEquals(18, details.get("column"));
    }

    @Test
    void positionInLaterStatementIsMappedToLineAndColumnInTheText()
    {
        String sql = "SELECT 1;\nSELECT\n  bad";
        // "bad" is at 1-based position 10 within the second statement
        Map<String, Object> details = new LinkedHashMap<>(Map.of("position", 10));

        JdbcQueryEngineProvider.resolveErrorLocation(details, sql, sql.indexOf("SELECT\n"));

        assertEquals(3, details.get("line"));
        assertEquals(3, details.get("column"));
    }

    @Test
    void positionAfterExplainPrefixMapsBackToUserText()
    {
        String prefix = "EXPLAIN (FORMAT JSON) ";
        String sql = "SELECT bad";
        // Postgres reports the position within the executed EXPLAIN text
        Map<String, Object> details = new LinkedHashMap<>(Map.of("position", prefix.length() + 8));

        JdbcQueryEngineProvider.resolveErrorLocation(details, sql, -prefix.length());

        assertEquals(1, details.get("line"));
        assertEquals(8, details.get("column"));
    }
}
