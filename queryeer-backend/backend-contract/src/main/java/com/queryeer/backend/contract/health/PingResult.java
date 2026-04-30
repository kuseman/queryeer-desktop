package com.queryeer.backend.contract.health;

public record PingResult(String timestamp, long uptimeMs, Integer javaDebugPort)
{
}
