package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.parse.ParseResult;

class TreeSitterSqlParseFunctionTest
{
    @Test
    void parsesSqlAndReturnsMetadata()
    {
        TreeSitterSqlParseFunction parseFunction = new TreeSitterSqlParseFunction();
        ParseResult result = parseFunction.parse("sql", "select top 1 as id", null);
        assertNotNull(result);
        assertNotNull(result.attributes());
        assertNotNull(result.attributes()
                .get("rootType"));
    }

    @Test
    void handlesIncompleteSql()
    {
        TreeSitterSqlParseFunction parseFunction = new TreeSitterSqlParseFunction();
        ParseResult result = parseFunction.parse("sql", "select * from where", null);
        assertNotNull(result);
        assertTrue(result.attributes()
                .containsKey("rootType"));
    }
}
