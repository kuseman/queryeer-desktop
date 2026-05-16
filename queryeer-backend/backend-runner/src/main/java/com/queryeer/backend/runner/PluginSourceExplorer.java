package com.queryeer.backend.runner;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

final class PluginSourceExplorer
{
    List<Path> discoverPluginSources(Path pluginsDirectory)
    {
        if (!Files.exists(pluginsDirectory))
        {
            return List.of();
        }

        List<Path> sources = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(pluginsDirectory))
        {
            for (Path child : stream)
            {
                if (Files.isDirectory(child)
                        || child.getFileName()
                                .toString()
                                .endsWith(".zip"))
                {
                    sources.add(child);
                }
            }
        }
        catch (IOException e)
        {
            throw new PluginDiscoveryException("Failed to list plugin directory: " + pluginsDirectory, e);
        }
        return sources.stream()
                .sorted(Comparator.comparing(path -> path.getFileName()
                        .toString()))
                .toList();
    }
}
