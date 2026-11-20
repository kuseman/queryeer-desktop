package com.queryeer.backend.core.dependencyextension;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.DependencyExtension;

public final class ExtensionWithoutDefaultConstructor implements DependencyExtension<Void>
{
    public ExtensionWithoutDefaultConstructor(String name)
    {
    }

    @Override
    public void activate(BackendPluginContext context, Void state)
    {
    }
}
