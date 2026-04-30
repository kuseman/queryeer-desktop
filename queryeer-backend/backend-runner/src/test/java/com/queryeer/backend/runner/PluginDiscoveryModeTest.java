package com.queryeer.backend.runner;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class PluginDiscoveryModeTest
{
    @Test
    void parsesModesCaseInsensitively()
    {
        Assertions.assertEquals(PluginDiscoveryMode.AUTO, PluginDiscoveryMode.parse("auto"));
        Assertions.assertEquals(PluginDiscoveryMode.BUILTIN, PluginDiscoveryMode.parse("BUILTIN"));
        Assertions.assertEquals(PluginDiscoveryMode.EXTERNAL, PluginDiscoveryMode.parse("External"));
        Assertions.assertEquals(PluginDiscoveryMode.MIXED, PluginDiscoveryMode.parse("mixed"));
    }

    @Test
    void defaultsToAutoWhenUnset()
    {
        Assertions.assertEquals(PluginDiscoveryMode.AUTO, PluginDiscoveryMode.parse(null));
        Assertions.assertEquals(PluginDiscoveryMode.AUTO, PluginDiscoveryMode.parse("  "));
    }

    @Test
    void throwsForUnsupportedMode()
    {
        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> PluginDiscoveryMode.parse("hybrid"));
        Assertions.assertTrue(error.getMessage()
                .contains("Unsupported plugin discovery mode"));
    }
}
