package com.queryeer.backend.queryengine.jdbc.runtime;

public final class SharedNativeLibraryLoader
{
    private SharedNativeLibraryLoader()
    {
    }

    public static void load(String absolutePath)
    {
        System.load(absolutePath);
    }
}
