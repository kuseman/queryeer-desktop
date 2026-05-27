package com.queryeer.backend.queryengine.jdbc;

import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

/**
 * Shared helpers used by dialect implementations to avoid duplicating common JDBC metadata and schema-object-building logic across dialect plugins.
 */
public final class JdbcDialectSupport
{
    private static final String KEY_CATALOG = "catalog";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_TABLE = "table";

    /**
     * Collects primary key column names for the given table from {@link DatabaseMetaData#getPrimaryKeys}.
     */
    public static Set<String> collectPrimaryKeys(DatabaseMetaData meta, String catalog, String schema, String table)
    {
        Set<String> pkColumns = new HashSet<>();
        try (ResultSet rs = meta.getPrimaryKeys(catalog, schema, table))
        {
            while (rs.next())
            {
                String col = rs.getString("COLUMN_NAME");
                if (col != null)
                {
                    pkColumns.add(col);
                }
            }
        }
        catch (SQLException ignored)
        {
        }
        return pkColumns;
    }

    /**
     * Collects foreign key column info for the given table from {@link DatabaseMetaData#getImportedKeys}. Returns a map of column name to {@code [referencedTable, referencedColumn]}.
     */
    public static Map<String, List<String>> collectForeignKeys(DatabaseMetaData meta, String catalog, String schema, String table)
    {
        Map<String, List<String>> fkMap = new HashMap<>();
        try (ResultSet rs = meta.getImportedKeys(catalog, schema, table))
        {
            while (rs.next())
            {
                String col = rs.getString("FKCOLUMN_NAME");
                String refTable = rs.getString("PKTABLE_NAME");
                String refCol = rs.getString("PKCOLUMN_NAME");
                if (col != null)
                {
                    fkMap.put(col, List.of(refTable != null ? refTable
                            : "",
                            refCol != null ? refCol
                                    : ""));
                }
            }
        }
        catch (SQLException ignored)
        {
        }
        return fkMap;
    }

    /**
     * Builds the two folder nodes ({@code columns_folder}, {@code indexes_folder}) for a table or view. This logic is identical across dialects — the folder structure is a UI/navigation concern, not
     * a database-specific one.
     */
    public static List<JdbcSchemaObject> resolveTableFolders(JdbcSchemaTarget target)
    {
        if (target == null
                || target.table() == null)
        {
            return List.of();
        }
        String database = trimToNull(target.database());
        String schema = trimToNull(target.schema());
        String table = trimToNull(target.table());
        Map<String, Object> folderAttrs = new LinkedHashMap<>();
        if (database != null)
        {
            folderAttrs.put(KEY_CATALOG, database);
        }
        if (schema != null)
        {
            folderAttrs.put(KEY_SCHEMA, schema);
        }
        folderAttrs.put(KEY_TABLE, table);
        String idPrefix = (database != null ? database + "."
                : "")
                + (schema != null ? schema + "."
                        : "")
                + table;
        return List.of(new JdbcSchemaObject("columns_folder:" + idPrefix, "Columns", "columns_folder", null, Map.copyOf(folderAttrs)),
                new JdbcSchemaObject("indexes_folder:" + idPrefix, "Indexes", "indexes_folder", null, Map.copyOf(folderAttrs)));
    }

    private JdbcDialectSupport()
    {
    }
}
