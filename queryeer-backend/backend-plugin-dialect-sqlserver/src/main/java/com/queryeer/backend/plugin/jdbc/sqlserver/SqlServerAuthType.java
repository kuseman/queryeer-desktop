package com.queryeer.backend.plugin.jdbc.sqlserver;

enum SqlServerAuthType
{
    SQL_SERVER_AUTH("SQL Server Authentication"),
    WINDOWS_NATIVE_AUTH("Windows Native Authentication"),
    WINDOWS_NTLM_AUTH("Windows NTLM Authentication"),
    JAVA_KERBEROS("Java Kerberos (cross-platform)");

    private final String displayName;

    SqlServerAuthType(String displayName)
    {
        this.displayName = displayName;
    }

    String displayName()
    {
        return displayName;
    }

    static SqlServerAuthType fromString(String value)
    {
        if (value == null)
        {
            return SQL_SERVER_AUTH;
        }
        for (SqlServerAuthType type : values())
        {
            if (type.name()
                    .equalsIgnoreCase(value))
            {
                return type;
            }
        }
        return SQL_SERVER_AUTH;
    }
}
