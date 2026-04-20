package com.queryeer.backend.contract;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum EnvelopeType
{
    REQUEST("request"),
    RESPONSE("response"),
    NOTIFICATION("notification");

    private final String wireValue;

    EnvelopeType(String wireValue)
    {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue()
    {
        return wireValue;
    }

    @JsonCreator
    public static EnvelopeType fromWireValue(String value)
    {
        if (value == null)
        {
            throw new IllegalArgumentException("Envelope type cannot be null");
        }

        for (EnvelopeType type : values())
        {
            if (type.wireValue.equalsIgnoreCase(value)
                    || type.name()
                            .equalsIgnoreCase(value))
            {
                return type;
            }
        }

        throw new IllegalArgumentException("Unknown envelope type: " + value);
    }
}
