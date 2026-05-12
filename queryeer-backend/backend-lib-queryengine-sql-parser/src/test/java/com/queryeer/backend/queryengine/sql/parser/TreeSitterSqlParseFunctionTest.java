package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.treesitter.TSTree;

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

    @Test
    void storesTreeInState()
    {
        TreeSitterSqlParseFunction parseFunction = new TreeSitterSqlParseFunction();
        ParseResult result = parseFunction.parse("sql", "select * from t1", null);
        assertNotNull(result.state());
        assertInstanceOf(TSTree.class, result.state());
    }

    @Test
    void reusesPreviousTreeForIncrementalParsing()
    {
        TreeSitterSqlParseFunction parseFunction = new TreeSitterSqlParseFunction();
        ParseResult first = parseFunction.parse("sql", "select * from t1", null);
        assertNotNull(first.state());
        ParseResult second = parseFunction.parse("sql", "select * from t1 join t2", first.state());
        assertNotNull(second.state());
        assertInstanceOf(TSTree.class, second.state());
    }
}
