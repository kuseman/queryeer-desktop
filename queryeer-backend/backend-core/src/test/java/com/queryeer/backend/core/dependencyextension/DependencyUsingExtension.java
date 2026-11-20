package com.queryeer.backend.core.dependencyextension;

import java.util.List;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.DependencyExtension;

/** The only class that refers to the dependency's type. */
final class DependencyUsingExtension implements DependencyExtension<List<String>>
{
    @Override
    public void activate(BackendPluginContext context, List<String> state)
    {
        state.add(MissingDependencyType.name());
    }
}
