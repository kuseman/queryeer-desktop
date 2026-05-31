package com.queryeer.example.jdbc.h2;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;

/**
 * Minimal H2 in-memory database dialect.
 *
 * <p>
 * This dialect connects to an H2 database using either an embedded file path,
 * an in-memory database name, or a TCP remote URL. It serves as a reference
 * implementation for writing a JDBC dialect plugin.
 *
 * @see <a href="https://h2database.com/html/features.html">H2 Database Features</a>
 */
public final class H2Dialect implements JdbcDialect
{
    private static final String DIALECT_ID = "h2";
    private static final String DRIVER_CLASS_NAME = "org.h2.Driver";

    private static final JdbcDialectMetadata METADATA = new JdbcDialectMetadata(
            DIALECT_ID,
            "H2 Database",
            9092,
            "jdbc:h2:{database}",
            DRIVER_CLASS_NAME);

    @Override
    public JdbcDialectMetadata metadata()
    {
        return METADATA;
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        // Use the standard JDBC result set executor
        return new AbstractJdbcQueryExecutor()
        {};
    }

    @Override
    public boolean canSwitchDatabase()
    {
        return false;
    }

    @Override
    public void applyDatabase(Connection connection, String database) throws SQLException
    {
        connection.setSchema(database);
    }

    @Override
    public String resolveCurrentDatabase(Connection connection) throws SQLException
    {
        return connection.getSchema();
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        String database = stringValue(materializedProperties, "database");
        StringBuilder url = new StringBuilder("jdbc:h2:");
        String mode = stringValue(materializedProperties, "mode");

        if ("mem".equalsIgnoreCase(mode))
        {
            url.append("mem:").append(database != null ? database : "default");
        }
        else if ("tcp".equalsIgnoreCase(mode))
        {
            Integer port = (Integer) materializedProperties.get("port");
            url.append("tcp://localhost")
                    .append(port != null ? ":" + port : ":9092")
                    .append("/")
                    .append(database != null ? database : "test");
        }
        else
        {
            // Embedded file mode
            url.append(database != null ? database : "./test");
        }

        String username = stringValue(materializedProperties, "username");
        if (username != null)
        {
            url.append(";USER=").append(username);
        }
        // H2 automatically creates databases; no additional parameters needed

        return url.toString();
    }
}
