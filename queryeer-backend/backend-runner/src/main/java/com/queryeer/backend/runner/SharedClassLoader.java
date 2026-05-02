package com.queryeer.backend.runner;

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
    SharedClassLoader(List<URL> sharedLibUrls, ClassLoader parent)
    {
        super(sharedLibUrls.toArray(URL[]::new), parent);
    }
}
