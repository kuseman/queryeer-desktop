package com.queryeer.backend.transport.stdio;

import java.util.Arrays;
import java.util.Base64;

final class SecuritySessionBridge
{
    private volatile String sessionId;
    private volatile String vaultPath;
    private volatile String vaultUpdatedAt;
    private volatile byte[] sessionKey;

    public void openSession(String sessionId, String vaultPath, String sessionKeyBase64, String vaultUpdatedAt)
    {
        byte[] nextKey = sessionKeyBase64 == null ? null
                : Base64.getDecoder()
                        .decode(sessionKeyBase64);
        byte[] currentKey = this.sessionKey;
        if (currentKey != null)
        {
            Arrays.fill(currentKey, (byte) 0);
        }

        this.sessionId = sessionId;
        this.vaultPath = vaultPath;
        this.sessionKey = nextKey;
        this.vaultUpdatedAt = vaultUpdatedAt;
    }

    public void closeSession()
    {
        byte[] currentKey = this.sessionKey;
        if (currentKey != null)
        {
            Arrays.fill(currentKey, (byte) 0);
        }

        this.sessionId = null;
        this.sessionKey = null;
    }

    public void markVaultChanged(String vaultPath, String vaultUpdatedAt)
    {
        this.vaultPath = vaultPath;
        this.vaultUpdatedAt = vaultUpdatedAt;
    }

    public SecuritySessionSnapshot snapshot()
    {
        byte[] key = this.sessionKey;
        return new SecuritySessionSnapshot(sessionId, vaultPath, vaultUpdatedAt, key == null ? null
                : key.clone());
    }

    public record SecuritySessionSnapshot(String sessionId, String vaultPath, String vaultUpdatedAt, byte[] sessionKey)
    {
        boolean isOpen()
        {
            return sessionId != null
                    && vaultPath != null
                    && sessionKey != null;
        }
    }
}
