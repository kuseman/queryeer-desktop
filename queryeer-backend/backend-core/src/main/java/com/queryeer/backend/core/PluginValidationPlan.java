package com.queryeer.backend.core;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.BackendPlugin;

public record PluginValidationPlan(List<BackendPlugin> activationOrder, Map<String, String> skipReasons, Map<String, PluginRuntimeState> preActivationStates)
{
}
