package com.queryeer.backend.transport.stdio;

final class JavaDebugPortDetector
{
    Integer detect()
    {
        Integer fromListener = parsePort(System.getProperty("sun.jdwp.listenerAddress"));
        if (fromListener != null)
        {
            return fromListener;
        }

        String agentSpec = System.getProperty("jdk.jdwp.agent");
        if (agentSpec != null)
        {
            Integer fromAgent = extractAddressPort(agentSpec);
            if (fromAgent != null)
            {
                return fromAgent;
            }
        }

        return null;
    }

    private Integer extractAddressPort(String value)
    {
        int index = value.indexOf("address=");
        if (index < 0)
        {
            return null;
        }
        String address = value.substring(index + "address=".length())
                .split(",", 2)[0].trim();
        return parsePort(address);
    }

    private Integer parsePort(String value)
    {
        if (value == null
                || value.isBlank())
        {
            return null;
        }

        String normalized = value.trim();
        if (normalized.contains(":"))
        {
            normalized = normalized.substring(normalized.lastIndexOf(':') + 1);
        }

        try
        {
            int port = Integer.parseInt(normalized);
            return port > 0 ? port
                    : null;
        }
        catch (NumberFormatException e)
        {
            return null;
        }
    }
}
