package com.queryeer.backend.runner;

/**
 * Loads a native library on behalf of the shared class loader. {@link System#load(String)} binds a library to the class loader of its caller, and JNI only finds a native method in libraries bound to
 * the loader of the class that declares it. So {@link SharedClassLoader} defines its own copy of this class (see {@link SharedClassLoader#nativeLibraryLoader()}), and libraries loaded through that
 * copy serve the drivers in {@code libShared}, such as SQL Server's integrated authentication DLL.
 *
 * <p>
 * Public because the copy lives in another runtime package and is called reflectively. It must only use {@code java.*} types.
 * </p>
 */
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
