package com.queryeer.backend.contract.connection;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ConnectionCredentialStatus
{
    MISSING("missing"),
    PRESENT("present");

    private final String wireValue;

    ConnectionCredentialStatus(String wireValue)
    {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue()
    {
        return wireValue;
    }

    @JsonCreator
    public static ConnectionCredentialStatus fromWireValue(String value)
    {
        if (value == null)
        {
            throw new IllegalArgumentException("Connection credential status cannot be null");
        }

        for (ConnectionCredentialStatus status : values())
        {
            if (status.wireValue.equalsIgnoreCase(value)
                    || status.name()
                            .equalsIgnoreCase(value))
            {
                return status;
            }
        }

        throw new IllegalArgumentException("Unknown connection credential status: " + value);
    }
}
