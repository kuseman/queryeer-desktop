package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
        activateAll(context, PluginValidation.planActivation(plugins));
    }

    /** Activates by a plan made beforehand from {@link #plugins()}, so the caller can prepare for it first (e.g. which exports each plugin sees). */
    public void activateAll(BackendPluginContext context, PluginValidationPlan plan) throws Exception
    {
        warnings = Map.copyOf(plan.warnings());
        Set<String> activatedIds = new HashSet<>();

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
                Set<String> dependencies = new HashSet<>(plugin.descriptor()
                        .dependencies());
                dependencies.addAll(plan.activeOptionalDependencies()
                        .getOrDefault(pluginId, Set.of()));
                // A dependency counts as active only once it activated: a failed one doesn't
                dependencies.retainAll(activatedIds);
                PluginScopedContext scopedContext = new PluginScopedContext(context, Set.copyOf(dependencies));
                List<String> activationErrors;
                try
                {
                    plugin.activate(scopedContext, plugin.descriptor());
                }
                finally
                {
                    activationErrors = scopedContext.activationErrors()
                            .close();
                }
                activated.add(plugin);
                activatedIds.add(pluginId);
                statusByPluginId.put(pluginId, new PluginRuntimeStatus(pluginId, PluginRuntimeState.ACTIVATED, activatedMessage(activationErrors, warnings.get(pluginId))));
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

    /** "Activated", with what the plugin logged as errors while activating (e.g. a skipped optional feature) and the plan's warning. */
    private static String activatedMessage(List<String> activationErrors, String warning)
    {
        StringBuilder message = new StringBuilder("Activated");
        if (activationErrors.size() == 1)
        {
            message.append(", with an error: ")
                    .append(activationErrors.get(0));
        }
        else if (activationErrors.size() > 1)
        {
            message.append(", with ")
                    .append(activationErrors.size())
                    .append(" errors, the first: ")
                    .append(activationErrors.get(0));
        }
        if (warning != null)
        {
            message.append(". ")
                    .append(warning);
        }
        return message.toString();
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
