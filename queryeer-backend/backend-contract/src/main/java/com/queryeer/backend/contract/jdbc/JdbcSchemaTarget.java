package com.queryeer.backend.contract.jdbc;

/**
 * Target descriptor used inside schema refresh / fetch payloads.
 */
public record JdbcSchemaTarget(String database, String schema, String table)
{
}
