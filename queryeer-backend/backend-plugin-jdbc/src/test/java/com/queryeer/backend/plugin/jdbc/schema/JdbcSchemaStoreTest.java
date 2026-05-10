package com.queryeer.backend.plugin.jdbc.schema;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

class JdbcSchemaStoreTest
{
    @Test
    void persistsAndLoadsLatestSnapshot(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        JdbcSchemaObject personId = new JdbcSchemaObject("column:public:person:id", "id", "column", List.of(), Map.of());
        JdbcSchemaObject table = new JdbcSchemaObject("table:public:person", "person", "table",
                List.of(personId, new JdbcSchemaObject("pk:public:person:id", "pk_person", "primary_key", List.of(), Map.of("column", "id"))), Map.of("schema", "public"));
        JdbcSchemaObject orders = new JdbcSchemaObject("table:public:orders", "orders", "table",
                List.of(new JdbcSchemaObject("column:public:orders:person_id", "person_id", "column", List.of(), Map.of()),
                        new JdbcSchemaObject("fk:public:orders:person_id", "fk_orders_person", "foreign_key", List.of(),
                                Map.of("column", "person_id", "referencesTable", "person", "referencesColumn", "id")),
                        new JdbcSchemaObject("idx:public:orders:person_id", "idx_orders_person", "index", List.of(), Map.of("column", "person_id"))),
                Map.of("schema", "public"));
        JdbcSchemaObject schema = new JdbcSchemaObject("schema:public", "public", "schema", List.of(table), Map.of());
        JdbcSchemaObject schema2 = new JdbcSchemaObject("schema:public2", "public2", "schema", List.of(orders), Map.of());

        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(schema, schema2));

        List<JdbcSchemaObject> loaded = store.latestSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertEquals(2, loaded.size());
        Assertions.assertEquals("public", loaded.get(0)
                .name());
        Assertions.assertEquals("person", loaded.get(0)
                .children()
                .get(0)
                .name());
        List<String> referenceKinds = store.referenceKinds("conn-1");
        Assertions.assertTrue(referenceKinds.contains("primary_key_column"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_column"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_table"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_column_ref"));
        Assertions.assertTrue(referenceKinds.contains("index_column"));
    }
}
