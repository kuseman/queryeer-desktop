package com.queryeer.backend.api;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;

/**
 * The part of a plugin that uses an optional dependency's classes. {@link #whenDependencyActive(BackendPluginContext, String, String, Object)} loads it by name and runs it only when the dependency is
 * in use, so the plugin's other classes never refer to it, and never to the dependency's types:
 *
 * <pre>{@code
 * DependencyExtension.whenDependencyActive(context, "queryengine.payloadbuilder", "com.example.mongo.MongoPayloadbuilderCatalog", connections);
 * }</pre>
 *
 * <p>
 * An implementation needs a no-argument constructor (it may be package-private). Needs Queryeer 0.21 or later.
 * </p>
 *
 * @param <T> what the plugin hands over from its own activation, such as its connections; {@link Void} for nothing
 */
@FunctionalInterface
public interface DependencyExtension<T>
{
    /** Called during the plugin's {@code activate}, after the dependency activated: register with the dependency here. */
    void activate(BackendPluginContext context, T state) throws Exception;

    /**
     * Runs the plugin's extension {@code extensionClassName} when {@code context.isDependencyActive(pluginId)}, and does nothing otherwise. The extension is named, not referenced, so the class that
     * calls this never refers to it or to the dependency's types, and loads whether the dependency is there or not.
     *
     * <p>
     * The class is loaded through the class loader of the class that calls this method, so call it from the plugin's own code. It needs a no-argument constructor, and a nested class is named by its
     * binary name ({@code com.example.Outer$Extension}). An exception from the extension is thrown from here, so it fails the plugin's activation unless the plugin catches it.
     * </p>
     *
     * <p>
     * In a test, a context whose {@code isDependencyActive} returns true (for example a Mockito mock that stubs it) runs the extension; one that returns false doesn't.
     * </p>
     *
     * @param context the plugin's context
     * @param pluginId the optional (or required) dependency the extension uses
     * @param extensionClassName the extension's fully qualified binary class name
     * @param state handed to the extension's {@code activate}
     * @return whether the extension ran
     * @throws IllegalArgumentException when the class is missing, isn't a {@link DependencyExtension}, or can't be created
     * @throws IllegalStateException when the extension uses a class the plugin can't see, or fails to load
     */
    @SuppressWarnings("unchecked")
    static <T> boolean whenDependencyActive(BackendPluginContext context, String pluginId, String extensionClassName, T state) throws Exception
    {
        if (!context.isDependencyActive(pluginId))
        {
            return false;
        }
        // The plugin's class loader: the one that sees the plugin's classes and its dependencies' exports. A static
        // method can't be mocked or wrapped, so the caller is always the plugin's own code.
        ClassLoader loader = StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE)
                .getCallerClass()
                .getClassLoader();
        DependencyExtension<T> extension;
        try
        {
            Class<?> type = Class.forName(extensionClassName, false, loader);
            if (!DependencyExtension.class.isAssignableFrom(type))
            {
                throw new IllegalArgumentException(extensionClassName + " must implement " + DependencyExtension.class.getName());
            }
            Constructor<?> constructor = type.getDeclaredConstructor();
            constructor.setAccessible(true);
            extension = (DependencyExtension<T>) constructor.newInstance();
        }
        catch (ClassNotFoundException e)
        {
            throw new IllegalArgumentException("Extension " + extensionClassName + " for dependency " + pluginId + " not found in the plugin", e);
        }
        catch (NoSuchMethodException e)
        {
            throw new IllegalArgumentException(extensionClassName + " needs a no-argument constructor", e);
        }
        catch (InvocationTargetException e)
        {
            // The constructor threw: pass it on as is
            Throwable cause = e.getCause();
            if (cause instanceof NoClassDefFoundError missing)
            {
                throw classNotVisible(pluginId, extensionClassName, missing);
            }
            if (cause instanceof Exception exception)
            {
                throw exception;
            }
            if (cause instanceof Error error)
            {
                throw error;
            }
            throw e;
        }
        catch (ReflectiveOperationException e)
        {
            throw new IllegalArgumentException(extensionClassName + " can't be created: " + e, e);
        }
        catch (NoClassDefFoundError e)
        {
            throw classNotVisible(pluginId, extensionClassName, e);
        }
        catch (LinkageError e)
        {
            // E.g. a static initializer that throws, or a class compiled for a newer Java
            throw new IllegalStateException("Extension " + extensionClassName + " for dependency " + pluginId + " failed to load: " + e, e);
        }
        try
        {
            extension.activate(context, state);
        }
        catch (NoClassDefFoundError e)
        {
            throw classNotVisible(pluginId, extensionClassName, e);
        }
        return true;
    }

    private static IllegalStateException classNotVisible(String pluginId, String extensionClassName, NoClassDefFoundError e)
    {
        String detail = e.getCause() != null
                && e.getCause()
                        .getMessage() != null ? e.getCause()
                                .getMessage()
                                : e.getMessage();
        return new IllegalStateException(extensionClassName + ", or code it calls, uses a class the plugin can't see ("
                                         + detail
                                         + "). A plugin sees another plugin's classes only when that plugin is a dependency in its plugin.json and exports their package: check that "
                                         + pluginId
                                         + " exports it, and that the plugin doesn't bundle its own copy",
                e);
    }
}
