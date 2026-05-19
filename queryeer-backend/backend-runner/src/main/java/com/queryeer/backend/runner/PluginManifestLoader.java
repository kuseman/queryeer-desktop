package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import com.queryeer.backend.core.MapperUtils;

final class PluginManifestLoader
{
    static final String MANIFEST_FILE = "plugin.json";

    private final PluginManifestValidation validator;

    PluginManifestLoader()
    {
        this.validator = new PluginManifestValidation();
    }

    PluginManifest load(Path source)
    {
        if (Files.isDirectory(source))
        {
            return loadFromDirectory(source);
        }
        return loadFromZip(source);
    }

    private PluginManifest loadFromDirectory(Path source)
    {
        Path manifestPath = source.resolve(MANIFEST_FILE);
        if (!Files.exists(manifestPath))
        {
            throw new PluginDiscoveryException("Missing plugin manifest in folder: " + manifestPath);
        }

        try (InputStream input = Files.newInputStream(manifestPath))
        {
            PluginManifest manifest = MapperUtils.MAPPER.readValue(input, PluginManifest.class);
            validator.validate(manifest, manifestPath.toString());
            return manifest;
        }
        catch (IOException e)
        {
            throw new PluginDiscoveryException("Failed to read plugin manifest: " + manifestPath, e);
        }
    }

    private PluginManifest loadFromZip(Path source)
    {
        URI uri = URI.create("jar:" + source.toUri());
        try (FileSystem zipFs = FileSystems.newFileSystem(uri, Map.of()))
        {
            Path manifestPath = zipFs.getPath("/", MANIFEST_FILE);
            if (!Files.exists(manifestPath))
            {
                throw new PluginDiscoveryException("Missing plugin manifest in zip: " + source);
            }

            try (InputStream input = Files.newInputStream(manifestPath))
            {
                PluginManifest manifest = MapperUtils.MAPPER.readValue(input, PluginManifest.class);
                validator.validate(manifest, source.toString());
                return manifest;
            }
        }
        catch (IOException e)
        {
            throw new PluginDiscoveryException("Failed to read plugin zip manifest: " + source, e);
        }
    }
}
