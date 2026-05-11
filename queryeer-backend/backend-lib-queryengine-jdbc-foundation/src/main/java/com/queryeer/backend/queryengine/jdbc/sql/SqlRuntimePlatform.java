package com.queryeer.backend.queryengine.jdbc.sql;

import java.util.Locale;

public record SqlRuntimePlatform(String os, String arch)
{
    public static SqlRuntimePlatform detect()
    {
        return from(System.getProperty("os.name"), System.getProperty("os.arch"));
    }

    public static SqlRuntimePlatform from(String osName, String osArch)
    {
        return new SqlRuntimePlatform(normalizeOs(osName), normalizeArch(osArch));
    }

    public String classifier()
    {
        return os + "-" + arch;
    }

    private static String normalizeOs(String osName)
    {
        String normalized = osName == null ? ""
                : osName.toLowerCase(Locale.ROOT);
        if (normalized.contains("win"))
        {
            return "windows";
        }
        if (normalized.contains("mac")
                || normalized.contains("darwin"))
        {
            return "darwin";
        }
        if (normalized.contains("nux")
                || normalized.contains("linux"))
        {
            return "linux";
        }
        return "unknown";
    }

    private static String normalizeArch(String osArch)
    {
        String normalized = osArch == null ? ""
                : osArch.toLowerCase(Locale.ROOT);
        return switch (normalized)
        {
            case "x86_64", "amd64" -> "x64";
            case "aarch64", "arm64" -> "arm64";
            default -> normalized.isBlank() ? "unknown"
                    : normalized;
        };
    }
}
