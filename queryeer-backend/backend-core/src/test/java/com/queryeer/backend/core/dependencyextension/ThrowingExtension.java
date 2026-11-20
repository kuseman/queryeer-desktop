package com.queryeer.backend.core.dependencyextension;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.DependencyExtension;

public final class ThrowingExtension implements DependencyExtension<Void>
{
    public static final IllegalStateException FAILURE = new IllegalStateException("registration failed");

    @Override
    public void activate(BackendPluginContext context, Void state)
    {
        throw FAILURE;
    }
}
