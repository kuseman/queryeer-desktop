package com.queryeer.backend.core.dependencyextension;

/** Stands in for an optional dependency's type; {@code DependencyExtensionTest} hides it from the plugin's class loader. */
public final class MissingDependencyType
{
    public static String name()
    {
        return "dependency";
    }
}
