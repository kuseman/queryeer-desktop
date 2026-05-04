package com.queryeer.backend.api;

/**
 * Thrown when an operation requires an open security session (vault unlocked) but the session is currently closed. This allows callers to distinguish a retryable "vault locked" state from other
 * secret-resolution failures.
 */
public final class SecuritySessionClosedException extends RuntimeException
{
    public SecuritySessionClosedException(String message)
    {
        super(message);
    }
}
