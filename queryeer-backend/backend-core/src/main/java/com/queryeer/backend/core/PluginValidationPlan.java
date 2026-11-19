package com.queryeer.backend.core;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.BackendPlugin;

/** {@code warnings} are problems that don't stop a plugin, by plugin id: a version range not enforced against a development build. */
public record PluginValidationPlan(List<BackendPlugin> activationOrder, Map<String, String> skipReasons, Map<String, PluginRuntimeState> preActivationStates, Map<String, String> warnings)
{
}
