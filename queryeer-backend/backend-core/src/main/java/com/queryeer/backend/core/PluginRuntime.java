package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;

public final class PluginRuntime
{
    private final List<BackendPlugin> plugins = new ArrayList<>();
    private final List<BackendPlugin> activated = new ArrayList<>();
    private final Map<String, PluginRuntimeStatus> statusByPluginId = new LinkedHashMap<>();
    private Map<String, String> warnings = Map.of();

    public void register(BackendPlugin plugin)
    {
        plugins.add(plugin);
        statusByPluginId.put(plugin.descriptor()
                .id(),
                new PluginRuntimeStatus(plugin.descriptor()
                        .id(), PluginRuntimeState.LOADED, "Registered"));
    }

    public List<BackendPlugin> plugins()
    {
        return Collections.unmodifiableList(plugins);
    }

    public void activateAll(BackendPluginContext context) throws Exception
    {
        PluginValidationPlan plan = PluginValidation.planActivation(plugins);
        warnings = Map.copyOf(plan.warnings());

        for (Map.Entry<String, PluginRuntimeState> entry : plan.preActivationStates()
                .entrySet())
        {
            String reason = plan.skipReasons()
                    .getOrDefault(entry.getKey(), "Ready for activation");
            statusByPluginId.put(entry.getKey(), new PluginRuntimeStatus(entry.getKey(), entry.getValue(), reason));
        }

        for (BackendPlugin plugin : plan.activationOrder())
        {
            String pluginId = plugin.descriptor()
                    .id();
            try
            {
                plugin.activate(context, plugin.descriptor());
                activated.add(plugin);
                String warning = warnings.get(pluginId);
                statusByPluginId.put(pluginId, new PluginRuntimeStatus(pluginId, PluginRuntimeState.ACTIVATED, warning == null ? "Activated"
                        : "Activated. " + warning));
            }
            catch (Throwable t)
            {
                // A plugin loaded despite a version mismatch most likely failed because of it
                String warning = warnings.get(pluginId);
                String message = t.getMessage() != null ? t.getMessage()
                        : t.toString();
                statusByPluginId.put(pluginId, new PluginRuntimeStatus(pluginId, PluginRuntimeState.FAILED, warning == null ? message
                        : message + ". " + warning));
            }
        }
    }

    public void deactivateAll() throws Exception
    {
        List<BackendPlugin> copy = new ArrayList<>(activated);
        Collections.reverse(copy);
        for (BackendPlugin plugin : copy)
        {
            String pluginId = plugin.descriptor()
                    .id();
            try
            {
                plugin.deactivate();
                statusByPluginId.put(pluginId, new PluginRuntimeStatus(pluginId, PluginRuntimeState.DEACTIVATED, "Deactivated"));
            }
            catch (Throwable t)
            {
                statusByPluginId.put(pluginId, new PluginRuntimeStatus(pluginId, PluginRuntimeState.FAILED, t.getMessage()));
            }
        }
        activated.clear();
    }

    public List<PluginRuntimeStatus> statuses()
    {
        return Collections.unmodifiableList(new ArrayList<>(statusByPluginId.values()));
    }

    /** Problems found before activation that didn't stop a plugin, by plugin id (see {@link PluginValidationPlan#warnings()}). */
    public Map<String, String> warnings()
    {
        return warnings;
    }

    public List<String> activatedPluginIds()
    {
        return activated.stream()
                .map(plugin -> plugin.descriptor()
                        .id())
                .toList();
    }
}
