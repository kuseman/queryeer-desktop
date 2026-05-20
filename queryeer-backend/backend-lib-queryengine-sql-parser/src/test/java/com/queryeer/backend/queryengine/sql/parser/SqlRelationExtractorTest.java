package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;

import org.junit.jupiter.api.Test;

class SqlRelationExtractorTest
{
    @Test
    void extractsExplicitAlias()
    {
        assertEquals(Map.of("a", "table_a"), SqlRelationExtractor.extractAliases("SELECT * FROM table_a a", 1, 10));
    }

    @Test
    void extractsAsAlias()
    {
        assertEquals(Map.of("a", "table_a"), SqlRelationExtractor.extractAliases("SELECT * FROM table_a AS a", 1, 10));
    }

    @Test
    void extractsJoinAliases()
    {
        assertEquals(Map.of("a", "table_a", "b", "table_b"), SqlRelationExtractor.extractAliases("SELECT * FROM table_a a JOIN table_b b ON a.id = b.id", 1, 45));
    }

    @Test
    void extractsCommaSeparatedRelations()
    {
        assertEquals(Map.of("a", "table_a", "b", "table_b"), SqlRelationExtractor.extractAliases("SELECT * FROM table_a a, table_b b WHERE a.id = b.id", 1, 47));
    }

    @Test
    void extractsQualifiedTableName()
    {
        assertEquals(Map.of("a", "dbo.table_a"), SqlRelationExtractor.extractAliases("SELECT * FROM dbo.table_a a", 1, 15));
    }

    @Test
    void extractsBracketQuotedQualifiedName()
    {
        assertEquals(Map.of("a", "dbo.Table A"), SqlRelationExtractor.extractAliases("SELECT * FROM [dbo].[Table A] a", 1, 15));
    }

    @Test
    void extractsDoubleQuotedQualifiedName()
    {
        assertEquals(Map.of("a", "dbo.Table A"), SqlRelationExtractor.extractAliases("SELECT * FROM \"dbo\".\"Table A\" a", 1, 15));
    }

    @Test
    void doesNotCaptureClauseKeywordAsAlias()
    {
        assertEquals(Map.of("table_a", "table_a"), SqlRelationExtractor.extractAliases("SELECT * FROM table_a WHERE id = 1", 1, 30));
    }

    @Test
    void scopesAliasesToCursorStatement()
    {
        String sql = "SELECT * FROM first_table ft WHERE ft.id = 1\nSELECT s. FROM second_table s";

        assertEquals(Map.of("s", "second_table"), SqlRelationExtractor.extractAliases(sql, 2, 9));
    }

    @Test
    void extractsAliasFromIncompleteErrorStatement()
    {
        assertEquals(Map.of("a", "table_a"), SqlRelationExtractor.extractAliases("SELECT a. FROM table_a a", 1, 10));
    }

    @Test
    void extractsAliasWhenCursorIsInSelectListBeforeFrom()
    {
        assertEquals(Map.of("o", "public.orders"), SqlRelationExtractor.extractAliases("SELECT na\nFROM public.orders o", 1, 10));
    }

    @Test
    void extractsInsertTargetForColumnList()
    {
        assertEquals(Map.of("tableb", "tableB"), SqlRelationExtractor.extractAliases("INSERT INTO tableB (", 1, 21));
    }

    @Test
    void extractsQualifiedInsertTargetForColumnList()
    {
        assertEquals(Map.of("public.tableb", "public.tableB"), SqlRelationExtractor.extractAliases("INSERT INTO public.tableB (na", 1, 30));
    }

    @Test
    void extractsInsertTargetWhenCursorIsBetweenParentheses()
    {
        assertEquals(Map.of("public.orders", "public.orders"), SqlRelationExtractor.extractAliases("INSERT INTO public.orders()", 1, 27));
    }

    @Test
    void ignoresRelationsInsideComments()
    {
        assertEquals(Map.of("real_table", "real_table"), SqlRelationExtractor.extractAliases("SELECT * -- FROM fake f\nFROM real_table", 2, 10));
    }
}
