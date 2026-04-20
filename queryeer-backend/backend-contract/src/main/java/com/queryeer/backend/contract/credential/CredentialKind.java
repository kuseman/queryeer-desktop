package com.queryeer.backend.contract.credential;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum CredentialKind
{
    PASSWORD("password");

    private final String wireValue;

    CredentialKind(String wireValue)
    {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue()
    {
        return wireValue;
    }

    @JsonCreator
    public static CredentialKind fromWireValue(String value)
    {
        if (value == null)
        {
            throw new IllegalArgumentException("Credential kind cannot be null");
        }

        for (CredentialKind kind : values())
        {
            if (kind.wireValue.equalsIgnoreCase(value)
                    || kind.name()
                            .equalsIgnoreCase(value))
            {
                return kind;
            }
        }

        throw new IllegalArgumentException("Unknown credential kind: " + value);
    }
}
