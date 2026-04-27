package com.queryeer.backend.contract.security;

public record SecuritySessionOpenParams(String sessionId, String vaultPath, String sessionKeyBase64, String vaultUpdatedAt)
{
}
