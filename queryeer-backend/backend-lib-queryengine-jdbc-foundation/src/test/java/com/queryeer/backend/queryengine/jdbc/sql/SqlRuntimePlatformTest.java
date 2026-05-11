package com.queryeer.backend.queryengine.jdbc.sql;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class SqlRuntimePlatformTest
{
    @Test
    void normalizesWindowsAmd64()
    {
        SqlRuntimePlatform platform = SqlRuntimePlatform.from("Windows 11", "amd64");
        assertEquals("windows", platform.os());
        assertEquals("x64", platform.arch());
        assertEquals("windows-x64", platform.classifier());
    }

    @Test
    void normalizesMacArm64()
    {
        SqlRuntimePlatform platform = SqlRuntimePlatform.from("Mac OS X", "aarch64");
        assertEquals("darwin", platform.os());
        assertEquals("arm64", platform.arch());
    }
}
