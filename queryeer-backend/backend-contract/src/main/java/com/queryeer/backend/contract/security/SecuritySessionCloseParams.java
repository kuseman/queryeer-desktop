package com.queryeer.backend.contract.security;

public record SecuritySessionCloseParams(String sessionId, String reason)
{
}
