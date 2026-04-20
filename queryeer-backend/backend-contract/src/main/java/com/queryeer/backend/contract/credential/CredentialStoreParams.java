package com.queryeer.backend.contract.credential;

public record CredentialStoreParams(String connectionId, CredentialKind credentialKind, String password)
{
}
