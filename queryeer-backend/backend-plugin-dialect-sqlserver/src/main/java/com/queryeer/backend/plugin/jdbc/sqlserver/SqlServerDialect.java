package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;

public final class SqlServerDialect implements JdbcDialect
{
    static final String DIALECT_ID = "sqlserver";

    private final SqlServerQueryExecutor queryExecutor = new SqlServerQueryExecutor();
    private final SqlServerSchemaResolver schemaResolver = new SqlServerSchemaResolver();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata(DIALECT_ID, "Microsoft SQL Server", 1433, "jdbc:sqlserver://<host>:<port>;databaseName=<database>", "com.microsoft.sqlserver.jdbc.SQLServerDriver");
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public JdbcSchemaResolver schemaResolver()
    {
        return schemaResolver;
    }

    @Override
    public String sqlGrammarId()
    {
        return "tsql";
    }

    @Override
    public String resolveSessionId(Connection connection) throws SQLException
    {
        try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery("select @@SPID"))
        {
            if (!rs.next())
            {
                return "";
            }
            Object value = rs.getObject(1);
            if (value == null)
            {
                return "";
            }
            String text = String.valueOf(value)
                    .trim();
            return text;
        }
        catch (SQLException ignored)
        {
            return "";
        }
    }

    @Override
    public Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = buildUrl(materializedProperties);
        Properties jdbcProps = SqlServerUrlBuilder.buildConnectionProperties(materializedProperties);
        return DriverManager.getConnection(url, jdbcProps);
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        return SqlServerUrlBuilder.buildUrl(materializedProperties);
    }

    @Override
    public Map<String, Object> extractErrorDetails(Throwable throwable)
    {
        Throwable current = throwable;
        while (current != null)
        {
            Map<String, Object> details = tryExtractSqlServerErrorDetails(current);
            if (!details.isEmpty())
            {
                return details;
            }
            current = current.getCause();
        }
        return Map.of();
    }

    private static Map<String, Object> tryExtractSqlServerErrorDetails(Throwable throwable)
    {
        try
        {
            Class<?> sqlServerExceptionClass = Class.forName("com.microsoft.sqlserver.jdbc.SQLServerException");
            if (!sqlServerExceptionClass.isInstance(throwable))
            {
                return Map.of();
            }
            Method getSqlServerError = sqlServerExceptionClass.getMethod("getSQLServerError");
            Object sqlServerError = getSqlServerError.invoke(throwable);
            if (sqlServerError == null)
            {
                return Map.of();
            }

            Class<?> errorClass = sqlServerError.getClass();
            Method getLineNumber = errorClass.getMethod("getLineNumber");
            Method getErrorNumber = errorClass.getMethod("getErrorNumber");
            Method getProcedureName = errorClass.getMethod("getProcedureName");

            Map<String, Object> details = new LinkedHashMap<>();
            Object lineNumberValue = getLineNumber.invoke(sqlServerError);
            if (lineNumberValue instanceof Number lineNumber
                    && lineNumber.intValue() > 0)
            {
                details.put("line", lineNumber.intValue());
            }

            Object errorNumberValue = getErrorNumber.invoke(sqlServerError);
            if (errorNumberValue instanceof Number errorNumber)
            {
                details.put("sqlErrorNumber", errorNumber.intValue());
            }

            Object procedureNameValue = getProcedureName.invoke(sqlServerError);
            if (procedureNameValue instanceof String procedureName
                    && !procedureName.isBlank())
            {
                details.put("procedure", procedureName);
            }

            Method getErrorState = errorClass.getMethod("getErrorState");
            Object errorStateValue = getErrorState.invoke(sqlServerError);
            if (errorStateValue instanceof Number errorState)
            {
                details.put("state", errorState.intValue());
            }
            return details;
        }
        catch (ReflectiveOperationException | LinkageError ignored)
        {
            return Map.of();
        }
    }
}
