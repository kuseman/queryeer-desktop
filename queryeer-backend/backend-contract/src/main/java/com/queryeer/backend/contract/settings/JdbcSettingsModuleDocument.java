package com.queryeer.backend.contract.settings;

/**
 * Full JDBC settings module document as stored on disk.
 */
public record JdbcSettingsModuleDocument(long version, String moduleId, String updatedAt, JdbcSettingsModuleValues values)
{
}
