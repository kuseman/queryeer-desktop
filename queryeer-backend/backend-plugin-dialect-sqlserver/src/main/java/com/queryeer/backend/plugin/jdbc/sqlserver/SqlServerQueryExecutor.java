package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import com.queryeer.backend.queryengine.jdbc.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

final class SqlServerQueryExecutor extends AbstractJdbcQueryExecutor
{
    /**
     * Matches a T-SQL GO batch separator line: optional whitespace, the word GO (case-insensitive), an optional repeat count, optional trailing whitespace. Must occupy its own line.
     */
    private static final Pattern GO_PATTERN = Pattern.compile("^\\s*GO(?:\\s+\\d+)?\\s*$", Pattern.CASE_INSENSITIVE | Pattern.MULTILINE);

    @Override
    protected Connection openConnection(JdbcConnectionProfile profile) throws SQLException
    {
        String url = SqlServerUrlBuilder.buildUrl(profile.properties());
        Properties jdbcProps = SqlServerUrlBuilder.buildConnectionProperties(profile.properties());
        return DriverManager.getConnection(url, jdbcProps);
    }

    /**
     * Splits T-SQL on the GO batch separator. GO must appear alone on a line (with optional whitespace). Blank batches (e.g. consecutive GOs) are discarded. Falls back to a single-element list if
     * splitting yields no non-empty batches.
     */
    @Override
    protected List<String> splitStatements(String sql)
    {
        String[] parts = GO_PATTERN.split(sql);
        List<String> batches = new ArrayList<>(parts.length);
        for (String part : parts)
        {
            String trimmed = part.strip();
            if (!trimmed.isEmpty())
            {
                batches.add(trimmed);
            }
        }
        return batches.isEmpty() ? List.of(sql)
                : batches;
    }

    @Override
    protected Object mapColumnValue(Object value, String columnTypeName)
    {
        if (value != null
                && "microsoft.sql.DateTimeOffset".equals(value.getClass()
                        .getName()))
        {
            return value.toString();
        }
        return value;
    }

}
