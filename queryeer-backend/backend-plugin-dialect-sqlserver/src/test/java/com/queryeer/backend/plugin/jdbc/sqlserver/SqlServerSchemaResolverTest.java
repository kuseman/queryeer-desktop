package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.DriverPropertyInfo;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

class SqlServerSchemaResolverTest
{
    @Test
    void deepScopeResolvesTablesForTargetSchema() throws SQLException
    {
        FakeSqlServerDriver driver = new FakeSqlServerDriver();
        DriverManager.registerDriver(driver);
        try
        {
            SqlServerSchemaResolver resolver = new SqlServerSchemaResolver();
            Map<String, Object> profile = Map.of("host", "localhost", "database", "master", "authType", "WINDOWS_NATIVE_AUTH");

            JdbcConnection connection = new JdbcConnection("connection", "connection", new SqlServerDialect(), profile);
            List<JdbcSchemaObject> result = resolver.resolveSchema(connection, Map.of("scope", "deep", "target", Map.of("database", "master", "schema", "dbo")));

            Assertions.assertTrue(driver.tablesQueryCalled.get(), "deep scope should query tables");
            Assertions.assertFalse(result.isEmpty());
            Assertions.assertEquals("table", result.get(0)
                    .kind());
            Assertions.assertEquals("Users", result.get(0)
                    .name());
        }
        finally
        {
            DriverManager.deregisterDriver(driver);
        }
    }

    private static final class FakeSqlServerDriver implements Driver
    {
        private final AtomicBoolean tablesQueryCalled = new AtomicBoolean(false);

        @Override
        public Connection connect(String url, Properties info)
        {
            return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] { Connection.class }, (_, method, args) ->
            {
                return switch (method.getName())
                {
                    case "prepareStatement" -> preparedStatement(String.valueOf(args[0]));
                    case "close" -> null;
                    case "isClosed" -> false;
                    default -> defaultValue(method.getReturnType());
                };
            });
        }

        private PreparedStatement preparedStatement(String sql)
        {
            return (PreparedStatement) Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(), new Class<?>[] { PreparedStatement.class }, (_, method, _) ->
            {
                return switch (method.getName())
                {
                    case "setString" -> null;
                    case "executeQuery" ->
                    {
                        if (sql.contains("from sys.objects"))
                        {
                            tablesQueryCalled.set(true);
                            yield resultSet(List.of(Map.of("schema_name", "dbo", "object_name", "Users", "object_type", "U")));
                        }
                        if (sql.contains("from sys.columns"))
                        {
                            yield resultSet(List.of(Map.of("column_name", "id", "type_name", "int")));
                        }
                        if (sql.contains("from sys.schemas"))
                        {
                            yield resultSet(List.of(Map.of("schema_name", "dbo")));
                        }
                        yield resultSet(List.of(Map.of("database_name", "master")));
                    }
                    case "close" -> null;
                    default -> defaultValue(method.getReturnType());
                };
            });
        }

        @Override
        public boolean acceptsURL(String url)
        {
            return url != null
                    && url.startsWith("jdbc:sqlserver://");
        }

        @Override
        public DriverPropertyInfo[] getPropertyInfo(String url, Properties info)
        {
            return new DriverPropertyInfo[0];
        }

        @Override
        public int getMajorVersion()
        {
            return 1;
        }

        @Override
        public int getMinorVersion()
        {
            return 0;
        }

        @Override
        public boolean jdbcCompliant()
        {
            return false;
        }

        @Override
        public Logger getParentLogger()
        {
            return Logger.getGlobal();
        }
    }

    private static ResultSet resultSet(List<Map<String, String>> rows)
    {
        class Cursor
        {
            int index = -1;
        }
        Cursor cursor = new Cursor();

        return (ResultSet) Proxy.newProxyInstance(ResultSet.class.getClassLoader(), new Class<?>[] { ResultSet.class }, (_, method, args) ->
        {
            return switch (method.getName())
            {
                case "next" ->
                {
                    cursor.index++;
                    yield cursor.index < rows.size();
                }
                case "getString" ->
                {
                    String key = String.valueOf(args[0]);
                    yield rows.get(cursor.index)
                            .get(key);
                }
                case "close" -> null;
                default -> defaultValue(method.getReturnType());
            };
        });
    }

    private static Object defaultValue(Class<?> returnType)
    {
        if (returnType == boolean.class)
        {
            return false;
        }
        if (returnType == byte.class)
        {
            return (byte) 0;
        }
        if (returnType == short.class)
        {
            return (short) 0;
        }
        if (returnType == int.class)
        {
            return 0;
        }
        if (returnType == long.class)
        {
            return 0L;
        }
        if (returnType == float.class)
        {
            return 0f;
        }
        if (returnType == double.class)
        {
            return 0d;
        }
        if (returnType == char.class)
        {
            return '\0';
        }
        return null;
    }
}
