package com.queryeer.backend.core;

import java.util.List;
import java.util.Map;
import java.util.Set;

import com.queryeer.backend.api.BackendPlugin;

/**
 * @param warnings problems that don't stop a plugin, by plugin id: a version range not enforced against a development build, an optional dependency not used because it is out of range
 * @param activeOptionalDependencies the optional dependencies each plugin that isn't skipped uses, by plugin id
 */
public record PluginValidationPlan(List<BackendPlugin> activationOrder, Map<String, String> skipReasons, Map<String, PluginRuntimeState> preActivationStates, Map<String, String> warnings,
        Map<String, Set<String>> activeOptionalDependencies)
{
}
