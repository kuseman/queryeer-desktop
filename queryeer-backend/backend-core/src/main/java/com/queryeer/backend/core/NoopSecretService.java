package com.queryeer.backend.core;

import com.queryeer.backend.api.SecretService;

final class NoopSecretService implements SecretService
{
    @Override
    public char[] getSecret(String key)
    {
        return null;
    }
}
