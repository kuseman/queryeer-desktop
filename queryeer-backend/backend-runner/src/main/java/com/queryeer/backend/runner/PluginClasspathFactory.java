package com.queryeer.backend.runner;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

final class PluginClasspathFactory
{
    URLClassLoader createClassLoader(Path source, ClassLoader parent)
    {
        List<URL> urls = new ArrayList<>();
        try
        {
            if (Files.isDirectory(source))
            {
                urls.add(source.toUri()
                        .toURL());
                Path libDir = source.resolve("lib");
                if (Files.exists(libDir)
                        && Files.isDirectory(libDir))
                {
                    try (DirectoryStream<Path> stream = Files.newDirectoryStream(libDir, "*.jar"))
                    {
                        for (Path jar : stream)
                        {
                            urls.add(jar.toUri()
                                    .toURL());
                        }
                    }
                }
            }
            else
            {
                urls.add(source.toUri()
                        .toURL());
            }
        }
        catch (IOException e)
        {
            throw new PluginDiscoveryException("Failed to build classpath for plugin source: " + source, e);
        }

        return new URLClassLoader(urls.toArray(URL[]::new), parent);
    }
}
