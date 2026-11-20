package com.queryeer.backend.core.dependencyextension;

import java.util.List;
import java.util.function.BiFunction;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.DependencyExtension;

/** A plugin's activation: names its extension, never refers to it. */
public final class PluginWithOptionalDependency implements BiFunction<BackendPluginContext, List<String>, Boolean>
{
    public static final String EXTENSION = "com.queryeer.backend.core.dependencyextension.DependencyUsingExtension";

    @Override
    public Boolean apply(BackendPluginContext context, List<String> state)
    {
        try
        {
            return DependencyExtension.whenDependencyActive(context, "dependency", EXTENSION, state);
        }
        catch (RuntimeException e)
        {
            throw e;
        }
        catch (Exception e)
        {
            throw new IllegalStateException(e);
        }
    }
}
