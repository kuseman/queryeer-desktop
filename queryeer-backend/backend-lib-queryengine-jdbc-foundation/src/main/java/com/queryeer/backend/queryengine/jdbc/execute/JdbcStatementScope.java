package com.queryeer.backend.queryengine.jdbc.execute;

import java.sql.SQLException;

/**
 * What a dialect set up for one statement ({@code JdbcDialect.beginStatement}), undone when the statement is done. For example, PostgreSQL streams a result only outside autocommit, so its dialect
 * turns autocommit off for a query and here commits, or rolls back, and turns it on again.
 */
@FunctionalInterface
public interface JdbcStatementScope
{
    /** Nothing to undo. */
    JdbcStatementScope NONE = succeeded ->
    {
    };

    /**
     * Called once, after the statement's results are read and closed. Restore the connection even when this fails: a session connection runs the file's later queries. With pgJDBC, roll back before
     * turning autocommit on again, which commits.
     *
     * @param succeeded false when the statement failed or was cancelled
     */
    void end(boolean succeeded) throws SQLException;
}
