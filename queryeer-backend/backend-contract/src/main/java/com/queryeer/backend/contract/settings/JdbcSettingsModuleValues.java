package com.queryeer.backend.contract.settings;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The {@code values} block inside a JDBC settings module document.
 */
public record JdbcSettingsModuleValues(@JsonProperty("core.queryengine.jdbc.connections") List<JdbcSettingsConnectionEntry> connections)
{
}
