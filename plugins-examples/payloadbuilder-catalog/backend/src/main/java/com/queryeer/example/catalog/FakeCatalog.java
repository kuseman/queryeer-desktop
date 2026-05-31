package com.queryeer.example.catalog;

import java.util.List;
import java.util.Map;

import se.kuseman.payloadbuilder.api.QualifiedName;
import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.Column.Type;
import se.kuseman.payloadbuilder.api.catalog.DatasourceData;
import se.kuseman.payloadbuilder.api.catalog.FunctionInfo;
import se.kuseman.payloadbuilder.api.catalog.IDatasource;
import se.kuseman.payloadbuilder.api.catalog.Option;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.catalog.TableFunctionInfo;
import se.kuseman.payloadbuilder.api.catalog.TableSchema;
import se.kuseman.payloadbuilder.api.execution.IExecutionContext;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ObjectTupleVector;
import se.kuseman.payloadbuilder.api.execution.TupleIterator;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.expression.IExpression;

final class FakeCatalog extends Catalog
{
    static final String CATALOG_ID = "example.fake";

    private static final String PRODUCTS_TABLE = "products";
    private static final String PRODUCTS_BY_CATEGORY_FUNCTION = "products_by_category";

    private static final Schema PRODUCTS_SCHEMA = Schema.of(
            Column.of("id", ResolvedType.INT),
            Column.of("name", ResolvedType.STRING),
            Column.of("category", ResolvedType.STRING),
            Column.of("price", ResolvedType.DECIMAL));

    FakeCatalog()
    {
        super(CATALOG_ID);
        registerFunction(new ProductsByCategoryFunction());
    }

    @Override
    public TableSchema getTableSchema(IExecutionContext context, String catalogAlias, QualifiedName table, List<Option> options)
    {
        if (isProductsTable(table))
        {
            return new TableSchema(PRODUCTS_SCHEMA);
        }
        return TableSchema.EMPTY;
    }

    @Override
    public IDatasource getScanDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
    {
        if (!isProductsTable(table))
        {
            throw new IllegalArgumentException("Unsupported table: " + table);
        }

        return context -> TupleIterator.singleton(FakeRows.products());
    }

    @Override
    public TableSchema getSystemTableSchema(IQuerySession session, String catalogAlias, QualifiedName table)
    {
        String systemTable = table.getLast();
        if (SYS_TABLES.equalsIgnoreCase(systemTable))
        {
            return new TableSchema(Schema.of(Column.of(SYS_TABLES_NAME, Type.String)));
        }
        else if (SYS_COLUMNS.equalsIgnoreCase(systemTable))
        {
            return new TableSchema(Schema.of(Column.of(SYS_COLUMNS_TABLE, Type.String), Column.of(SYS_COLUMNS_NAME, Type.String)));
        }
        else if (SYS_FUNCTIONS.equalsIgnoreCase(systemTable))
        {
            return new TableSchema(SYS_FUNCTIONS_SCHEMA);
        }

        throw new IllegalArgumentException("Unsupported system table: " + table);
    }

    @Override
    public IDatasource getSystemTableDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
    {
        String systemTable = table.getLast();
        if (SYS_TABLES.equalsIgnoreCase(systemTable))
        {
            return context -> TupleIterator.singleton(FakeRows.systemTables());
        }
        else if (SYS_COLUMNS.equalsIgnoreCase(systemTable))
        {
            return context -> TupleIterator.singleton(FakeRows.systemColumns());
        }
        else if (SYS_FUNCTIONS.equalsIgnoreCase(systemTable))
        {
            return context -> TupleIterator.singleton(getFunctionsTupleVector(SYS_FUNCTIONS_SCHEMA));
        }

        throw new IllegalArgumentException("Unsupported system table: " + table);
    }

    private static boolean isProductsTable(QualifiedName table)
    {
        return PRODUCTS_TABLE.equalsIgnoreCase(table.getLast());
    }

    private static final class ProductsByCategoryFunction extends TableFunctionInfo
    {
        ProductsByCategoryFunction()
        {
            super(PRODUCTS_BY_CATEGORY_FUNCTION);
        }

        @Override
        public String getDescription()
        {
            return "Returns fake products optionally filtered by category";
        }

        @Override
        public FunctionInfo.Arity arity()
        {
            return new FunctionInfo.Arity(0, 1);
        }

        @Override
        public Schema getSchema(IExecutionContext context, String catalogAlias, List<IExpression> arguments, List<Option> options)
        {
            return PRODUCTS_SCHEMA;
        }

        @Override
        public TupleIterator execute(IExecutionContext context, String catalogAlias, List<IExpression> arguments, FunctionData functionData)
        {
            String categoryFilter = null;
            if (!arguments.isEmpty())
            {
                Object value = arguments.get(0)
                        .eval(context)
                        .valueAsObject(0);
                if (value != null)
                {
                    categoryFilter = value.toString();
                }
            }

            TupleVector rows = categoryFilter == null || categoryFilter.isBlank() ? FakeRows.products()
                    : FakeRows.productsByCategory(categoryFilter);
            return TupleIterator.singleton(rows);
        }

        @Override
        public Map<String, Object> getDescribeProperties(IExecutionContext context, String catalogAlias, List<IExpression> arguments, FunctionData functionData)
        {
            return Map.of("catalog", CATALOG_ID, "function", PRODUCTS_BY_CATEGORY_FUNCTION, "argumentCount", arguments.size());
        }
    }

    private static final class FakeRows
    {
        private FakeRows()
        {
        }

        static TupleVector products()
        {
            return tupleFrom(List.of(
                    row(1, "Red Apple", "fruit", "2.49"),
                    row(2, "Yellow Banana", "fruit", "1.89"),
                    row(3, "Carrot", "vegetable", "1.19"),
                    row(4, "Tomato", "vegetable", "2.05")));
        }

        static TupleVector productsByCategory(String category)
        {
            String categoryLower = category.toLowerCase();
            return tupleFrom(List.of(
                    row(1, "Red Apple", "fruit", "2.49"),
                    row(2, "Yellow Banana", "fruit", "1.89"),
                    row(3, "Carrot", "vegetable", "1.19"),
                    row(4, "Tomato", "vegetable", "2.05"))
                    .stream()
                    .filter(row -> row[2].toString().equalsIgnoreCase(categoryLower))
                    .toList());
        }

        static TupleVector systemTables()
        {
            Schema schema = Schema.of(Column.of(SYS_TABLES_NAME, Type.String));
            return new ObjectTupleVector(schema, 1, (row, col) -> PRODUCTS_TABLE);
        }

        static TupleVector systemColumns()
        {
            Schema schema = Schema.of(Column.of(SYS_COLUMNS_TABLE, Type.String), Column.of(SYS_COLUMNS_NAME, Type.String));
            List<String> columns = PRODUCTS_SCHEMA.getColumns()
                    .stream()
                    .map(Column::getName)
                    .toList();
            return new ObjectTupleVector(schema, columns.size(), (row, col) -> col == 0 ? PRODUCTS_TABLE
                    : columns.get(row));
        }

        private static TupleVector tupleFrom(List<Object[]> rows)
        {
            return new ObjectTupleVector(PRODUCTS_SCHEMA, rows.size(), (row, col) -> rows.get(row)[col]);
        }

        private static Object[] row(int id, String name, String category, String price)
        {
            return new Object[] { id, name, category, se.kuseman.payloadbuilder.api.execution.Decimal.from(price) };
        }
    }
}
