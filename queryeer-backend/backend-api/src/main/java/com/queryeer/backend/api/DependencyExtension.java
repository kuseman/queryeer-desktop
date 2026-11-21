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
     * binary name ({@code com.example.Outer$Extension}).
     * </p>
     *
     * <p>
     * <b>Failures.</b> What depends on the installed plugins is logged with {@code context.logger()} (the backend log, naming the extension and the dependency), and the plugin activates without the
     * extension: a class the plugin can't see (the dependency doesn't export it, or is a version without it), a class that fails to load, or an exception from the extension's constructor or
     * {@code activate}. What an {@code activate} registered before it threw stays registered, and the plugin's own {@code deactivate} runs as usual, so register last, or undo in {@code activate}
     * before rethrowing. Errors such as {@link OutOfMemoryError} are thrown. A mistake in the plugin itself is thrown too, so the plugin's first test finds it: see {@code @throws}.
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
     * @return whether the extension ran and activated
     * @throws IllegalArgumentException when the class is missing, isn't a {@link DependencyExtension}, or can't be created (abstract, or without a no-argument constructor)
     * @since 0.22.0 failures are logged; until then they were thrown, and the method declared {@code throws Exception}
     */
    @SuppressWarnings("unchecked")
    static <T> boolean whenDependencyActive(BackendPluginContext context, String pluginId, String extensionClassName, T state)
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
            // The constructor threw: as from activate below
            Throwable cause = e.getCause();
            if (cause instanceof Exception
                    || cause instanceof LinkageError)
            {
                return skip(context, pluginId, extensionClassName, cause);
            }
            if (cause instanceof Error error)
            {
                // E.g. OutOfMemoryError or AssertionError: not a missing feature of the installed plugins
                throw error;
            }
            throw new IllegalStateException(cause);
        }
        catch (ReflectiveOperationException e)
        {
            throw new IllegalArgumentException(extensionClassName + " can't be created: " + e, e);
        }
        catch (LinkageError e)
        {
            // A class it needs isn't visible, a static initializer that throws, or a class compiled for a newer Java
            return skip(context, pluginId, extensionClassName, e);
        }
        try
        {
            extension.activate(context, state);
        }
        catch (Exception | LinkageError e)
        {
            return skip(context, pluginId, extensionClassName, e);
        }
        return true;
    }

    /** Logs why the extension didn't run, and returns false. */
    private static boolean skip(BackendPluginContext context, String pluginId, String extensionClassName, Throwable failure)
    {
        if (failure instanceof InterruptedException)
        {
            Thread.currentThread()
                    .interrupt();
        }
        // "Could not initialize class X" is a static initializer that failed earlier, not a visibility problem
        Throwable error = failure instanceof NoClassDefFoundError missing
                && (missing.getMessage() == null
                        || !missing.getMessage()
                                .startsWith("Could not initialize class")) ? classNotVisible(pluginId, extensionClassName, missing)
                                        : failure;
        try
        {
            LoggerService logger = context.logger();
            if (logger != null)
            {
                logger.error("Extension " + extensionClassName + " for dependency " + pluginId + " failed, so the plugin runs without it: " + error, error);
            }
        }
        catch (RuntimeException e)
        {
            // Logging must not turn a skipped extension into a failed plugin
        }
        return false;
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
