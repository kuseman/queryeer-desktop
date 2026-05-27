package com.queryeer.backend.plugin.jdbc.postgres;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.contract.graph.GraphDocument;
import com.queryeer.backend.contract.graph.GraphVertex;

class PostgresExplainJsonConverterTest
{
    @Test
    void convertsSimpleSelect()
    {
        String json = """
                [{"Plan": {"Node Type": "Result", "Startup Cost": 0.00, "Total Cost": 0.01, "Plan Rows": 1, "Plan Width": 4, "Output": ["?column?"]}, "Planning Time": 0.042, "Triggers": []}]
                """;
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-1");
        Assertions.assertEquals("pg-plan-1", graph.id());
        Assertions.assertEquals(1, graph.vertices()
                .size());
        Assertions.assertEquals(0, graph.edges()
                .size());
        GraphVertex v = graph.vertices()
                .getFirst();
        Assertions.assertEquals("Result", v.label());
        Assertions.assertEquals("Result", v.kind());
    }

    @Test
    void convertsSeqScanWithFilter()
    {
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Seq Scan", "Relation Name": "users", "Schema": "public", "Alias": "u", "Startup Cost": 0.00, "Total Cost": 35.50, "Plan Rows": 10, "Plan Width": 42, "Filter": "(age > 18)", "Output": ["id", "name", "age"]}, "Planning Time": 0.050, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-2");
        Assertions.assertEquals(1, graph.vertices()
                .size());
        GraphVertex v = graph.vertices()
                .getFirst();
        Assertions.assertEquals("Seq Scan", v.label());
        Assertions.assertEquals("Scan", v.kind());
        Assertions.assertTrue(v.properties()
                .stream()
                .filter(g -> "predicates".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "filter".equals(p.id())
                        && "(age > 18)".equals(p.value())));
        Assertions.assertTrue(v.properties()
                .stream()
                .filter(g -> "object".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "relation".equals(p.id())
                        && "users".equals(p.value())));
        Assertions.assertTrue(v.properties()
                .stream()
                .filter(g -> "output".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "outputColumn-1".equals(p.id())
                        && "id".equals(p.value())));
    }

    @Test
    void convertsJoinWithTwoChildren()
    {
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Hash Join", "Join Type": "INNER", "Startup Cost": 15.50, "Total Cost": 95.20, "Plan Rows": 500, "Plan Width": 84, "Hash Cond": "(u.id = o.user_id)", "Output": ["u.name", "o.total"], "Plans": [{"Node Type": "Seq Scan", "Parent Relationship": "Outer", "Relation Name": "users", "Schema": "public", "Alias": "u", "Startup Cost": 0.00, "Total Cost": 35.50, "Plan Rows": 100, "Plan Width": 42}, {"Node Type": "Hash", "Parent Relationship": "Inner", "Startup Cost": 35.00, "Total Cost": 35.00, "Plan Rows": 400, "Plan Width": 42, "Plans": [{"Node Type": "Seq Scan", "Parent Relationship": "Outer", "Relation Name": "orders", "Schema": "public", "Alias": "o", "Startup Cost": 0.00, "Total Cost": 35.00, "Plan Rows": 400, "Plan Width": 42}]}]}, "Planning Time": 0.120, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-3");
        // Hash Join + Seq Scan (users) + Hash + Seq Scan (orders) = 4
        Assertions.assertEquals(4, graph.vertices()
                .size());
        Assertions.assertEquals(3, graph.edges()
                .size());
        Assertions.assertTrue(graph.vertices()
                .stream()
                .anyMatch(v -> "Hash Join".equals(v.label())));
        Assertions.assertTrue(graph.vertices()
                .stream()
                .anyMatch(v -> "Hash".equals(v.label())));
        Assertions.assertTrue(graph.vertices()
                .stream()
                .anyMatch(v -> "Seq Scan".equals(v.label())
                        && "Scan".equals(v.kind())));
        Assertions.assertTrue(graph.edges()
                .stream()
                .anyMatch(e -> "input".equals(e.kind())));
    }

    @Test
    void convertsActualPlanWithRuntimeStats()
    {
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Nested Loop", "Join Type": "INNER", "Startup Cost": 0.00, "Total Cost": 85.20, "Plan Rows": 50, "Plan Width": 84, "Actual Startup Time": 0.045, "Actual Total Time": 12.300, "Actual Rows": 45, "Actual Loops": 1, "Plans": [{"Node Type": "Index Scan", "Parent Relationship": "Outer", "Relation Name": "users", "Schema": "public", "Alias": "u", "Startup Cost": 0.00, "Total Cost": 25.30, "Plan Rows": 10, "Plan Width": 42, "Actual Startup Time": 0.012, "Actual Total Time": 1.500, "Actual Rows": 10, "Actual Loops": 1, "Index Cond": "(id = 123)"}, {"Node Type": "Index Only Scan", "Parent Relationship": "Inner", "Relation Name": "orders", "Schema": "public", "Alias": "o", "Startup Cost": 0.00, "Total Cost": 35.00, "Plan Rows": 5, "Plan Width": 42, "Actual Startup Time": 0.030, "Actual Total Time": 8.200, "Actual Rows": 4, "Actual Loops": 10}]}, "Planning Time": 0.080, "Execution Time": 12.500, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-4");
        Assertions.assertEquals(3, graph.vertices()
                .size());
        Assertions.assertEquals(2, graph.edges()
                .size());

        GraphVertex join = graph.vertices()
                .stream()
                .filter(v -> "Nested Loop".equals(v.label()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(join.properties()
                .stream()
                .filter(g -> "runtime".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "actualRows".equals(p.id())
                        && Double.valueOf(45D)
                                .equals(p.value())));
        Assertions.assertTrue(join.properties()
                .stream()
                .filter(g -> "runtime".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "actualTotal".equals(p.id())
                        && Double.valueOf(12.3D)
                                .equals(p.value())));

        GraphVertex indexScan = graph.vertices()
                .stream()
                .filter(v -> "Index Scan".equals(v.label()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(indexScan.properties()
                .stream()
                .filter(g -> "predicates".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "indexCond".equals(p.id())
                        && "(id = 123)".equals(p.value())));
    }

    @Test
    void convertsAggregateWithSortKeys()
    {
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Aggregate", "Strategy": "Hashed", "Startup Cost": 50.00, "Total Cost": 55.00, "Plan Rows": 1, "Plan Width": 40, "Group Key": ["category"], "Sort Key": ["category"], "Plans": [{"Node Type": "Seq Scan", "Parent Relationship": "Outer", "Relation Name": "products", "Schema": "public", "Startup Cost": 0.00, "Total Cost": 35.00, "Plan Rows": 1000, "Plan Width": 40}]}, "Planning Time": 0.100, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-5");
        Assertions.assertEquals(2, graph.vertices()
                .size());
        GraphVertex agg = graph.vertices()
                .stream()
                .filter(v -> "Aggregate".equals(v.label()))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("Aggregate", agg.kind());
        Assertions.assertTrue(agg.properties()
                .stream()
                .filter(g -> "groupKeys".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "groupKey-1".equals(p.id())
                        && "category".equals(p.value())));
        Assertions.assertTrue(agg.properties()
                .stream()
                .filter(g -> "sortKeys".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "sortKey-1".equals(p.id())
                        && "category".equals(p.value())));
    }

    @Test
    void convertsParallelQuery()
    {
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Gather", "Parallel Aware": false, "Startup Cost": 100.00, "Total Cost": 200.00, "Plan Rows": 5000, "Plan Width": 42, "Plans": [{"Node Type": "Seq Scan", "Parallel Aware": true, "Parent Relationship": "Outer", "Relation Name": "events", "Schema": "public", "Startup Cost": 0.00, "Total Cost": 150.00, "Plan Rows": 5000, "Plan Width": 42, "Filter": "(event_date > '2024-01-01')"}]}, "Planning Time": 0.200, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-6");
        Assertions.assertEquals(2, graph.vertices()
                .size());
        GraphVertex gather = graph.vertices()
                .stream()
                .filter(v -> "Gather".equals(v.label()))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("Parallelism", gather.kind());
        Assertions.assertTrue(gather.overlays()
                .stream()
                .anyMatch(o -> "parallel".equals(o.kind())));

        GraphVertex seqScan = graph.vertices()
                .stream()
                .filter(v -> "Seq Scan".equals(v.label()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(seqScan.overlays()
                .stream()
                .anyMatch(o -> "parallel".equals(o.kind())));
    }

    @Test
    void handlesMalformedJson()
    {
        GraphDocument graph = PostgresExplainJsonConverter.convert("not json", "pg-plan-err");
        Assertions.assertNotNull(graph.description());
        Assertions.assertTrue(graph.description()
                .startsWith("Unable to parse EXPLAIN JSON"));
    }

    @Test
    void handlesEmptyPlan()
    {
        // A plan with 0 plan rows and 0 cost - minimal conversion
        String json = """
                [{"Plan": {"Node Type": "Result", "Startup Cost": 0.00, "Total Cost": 0.00, "Plan Rows": 0, "Plan Width": 0}, "Planning Time": 0.010, "Triggers": []}]
                """;
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-0");
        Assertions.assertEquals(1, graph.vertices()
                .size());
        Assertions.assertEquals("Result", graph.vertices()
                .getFirst()
                .label());
    }

    @Test
    void warnsOnExpensiveSeqScan()
    {
        // Seq Scan with ~100% of total cost
        // CSOFF
        String json = """
                [{"Plan": {"Node Type": "Seq Scan", "Relation Name": "big_table", "Schema": "public", "Startup Cost": 0.00, "Total Cost": 9999.00, "Plan Rows": 100000, "Plan Width": 42}, "Planning Time": 0.100, "Triggers": []}]
                """;
        // CSON
        GraphDocument graph = PostgresExplainJsonConverter.convert(json, "pg-plan-warn");
        GraphVertex seqScan = graph.vertices()
                .getFirst();
        Assertions.assertTrue(seqScan.overlays()
                .stream()
                .anyMatch(o -> "warning".equals(o.kind())));
        Assertions.assertTrue(seqScan.properties()
                .stream()
                .filter(g -> "warnings".equals(g.id()))
                .flatMap(g -> g.properties()
                        .stream())
                .anyMatch(p -> "seqScan".equals(p.id())));
    }
}
