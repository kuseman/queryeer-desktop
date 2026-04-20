package com.queryeer.backend.contract.runtime;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum RuntimePluginState
{
    LOADED("loaded"),
    SKIPPED("skipped"),
    ACTIVATED("activated"),
    FAILED("failed"),
    DEACTIVATED("deactivated");

    private final String wireValue;

    RuntimePluginState(String wireValue)
    {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue()
    {
        return wireValue;
    }

    @JsonCreator
    public static RuntimePluginState fromWireValue(String value)
    {
        if (value == null)
        {
            throw new IllegalArgumentException("Runtime plugin state cannot be null");
        }

        for (RuntimePluginState state : values())
        {
            if (state.wireValue.equalsIgnoreCase(value)
                    || state.name()
                            .equalsIgnoreCase(value))
            {
                return state;
            }
        }

        throw new IllegalArgumentException("Unknown runtime plugin state: " + value);
    }
}
