package com.queryeer.backend.runner;

import java.util.Optional;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class PluginDiscoveryPlanTest
{
    @Test
    void autoResolvesToBuiltinWhenPathMissing()
    {
        PluginDiscoveryPlan plan = PluginDiscoveryPlan.of(PluginDiscoveryMode.AUTO, Optional.empty());

        Assertions.assertEquals(PluginDiscoveryMode.BUILTIN, plan.effectiveMode());
    }

    @Test
    void autoResolvesToExternalWhenPathPresent()
    {
        PluginDiscoveryPlan plan = PluginDiscoveryPlan.of(PluginDiscoveryMode.AUTO, Optional.of("plugins"));

        Assertions.assertEquals(PluginDiscoveryMode.EXTERNAL, plan.effectiveMode());
    }

    @Test
    void explicitModeIsPreserved()
    {
        PluginDiscoveryPlan plan = PluginDiscoveryPlan.of(PluginDiscoveryMode.MIXED, Optional.of("plugins"));

        Assertions.assertEquals(PluginDiscoveryMode.MIXED, plan.effectiveMode());
    }

    @Test
    void requiredPathFailsForExternalWhenMissing()
    {
        PluginDiscoveryPlan plan = PluginDiscoveryPlan.of(PluginDiscoveryMode.EXTERNAL, Optional.empty());

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> plan.requiredPathFor(PluginDiscoveryMode.EXTERNAL));
        Assertions.assertTrue(error.getMessage()
                .contains("requires queryeer.plugins.path"));
    }

    @Test
    void requiredPathFailsForMixedWhenMissing()
    {
        PluginDiscoveryPlan plan = PluginDiscoveryPlan.of(PluginDiscoveryMode.MIXED, Optional.empty());

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> plan.requiredPathFor(PluginDiscoveryMode.MIXED));
        Assertions.assertTrue(error.getMessage()
                .contains("requires queryeer.plugins.path"));
    }
}
