package com.queryeer.backend.contract.credential;

public record CredentialStoreResult(String connectionId, String credentialId, long version)
{
}
