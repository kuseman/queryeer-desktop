package com.queryeer.backend.api;

import java.util.List;

public record PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities)
{
}
