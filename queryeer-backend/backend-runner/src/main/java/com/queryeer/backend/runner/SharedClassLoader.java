package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.List;

/**
 * ClassLoader for shared libraries ({@code libShared/*.jar}) such as JDBC drivers. Uses the application classloader as parent so that API/contract types ({@code com.queryeer.backend.api.*},
 * {@code com.queryeer.backend.contract.*}) are resolved via parent delegation.
 *
 * <p>
 * This classloader is the parent of all {@code PluginCL} instances, which ensures {@link java.sql.DriverManager#isDriverAllowed} succeeds when a plugin running on its own PluginCL opens a JDBC
 * connection.
 * </p>
 */
final class SharedClassLoader extends URLClassLoader
{
    private Class<?> nativeLibraryLoader;

    SharedClassLoader(List<URL> sharedLibUrls, ClassLoader parent)
    {
        super(sharedLibUrls.toArray(URL[]::new), parent);
    }

    /**
     * This loader's own copy of {@link SharedNativeLibraryLoader}: native libraries loaded through it are bound to this loader, where the drivers that call them live. Defined here directly, not by
     * delegation, which would return the runner's copy from the application class loader.
     */
    synchronized Class<?> nativeLibraryLoader()
    {
        if (nativeLibraryLoader == null)
        {
            String resource = SharedNativeLibraryLoader.class.getSimpleName() + ".class";
            try (InputStream stream = SharedNativeLibraryLoader.class.getResourceAsStream(resource))
            {
                if (stream == null)
                {
                    throw new IllegalStateException("Missing class file " + resource);
                }
                byte[] bytes = stream.readAllBytes();
                nativeLibraryLoader = defineClass(SharedNativeLibraryLoader.class.getName(), bytes, 0, bytes.length);
            }
            catch (IOException e)
            {
                throw new UncheckedIOException(e);
            }
        }
        return nativeLibraryLoader;
    }
}
