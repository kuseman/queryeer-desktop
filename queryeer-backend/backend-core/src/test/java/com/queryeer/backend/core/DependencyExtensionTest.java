package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.BiFunction;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.DependencyExtension;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.core.dependencyextension.PluginWithOptionalDependency;
import com.queryeer.backend.core.dependencyextension.ThrowingExtension;

class DependencyExtensionTest
{
    private static final String PACKAGE = "com.queryeer.backend.core.dependencyextension.";
    private static final String MISSING_TYPE = PACKAGE + "MissingDependencyType";

    @Test
    void runsTheExtensionWithTheStateWhenTheDependencyIsActive()
    {
        List<String> state = new ArrayList<>();

        assertTrue(new PluginWithOptionalDependency().apply(context("dependency"), state));
        assertEquals(List.of("dependency"), state);
    }

    @Test
    void runsWithAPlainMockThatStubsIsDependencyActive()
    {
        // How a plugin's own tests set it up
        BackendPluginContext context = mock(BackendPluginContext.class);
        when(context.isDependencyActive("dependency")).thenReturn(true);
        List<String> state = new ArrayList<>();

        assertTrue(new PluginWithOptionalDependency().apply(context, state));
        assertEquals(List.of("dependency"), state);
    }

    @Test
    void neverLoadsTheExtensionWhenTheDependencyIsNotInUse() throws Exception
    {
        // As a plugin class loader does when the optional dependency isn't in use: its types aren't visible
        HidingClassLoader loader = new HidingClassLoader(DependencyExtensionTest.class.getClassLoader(), MISSING_TYPE);
        BiFunction<BackendPluginContext, List<String>, Boolean> plugin = pluginLoadedBy(loader);
        List<String> state = new ArrayList<>();

        assertFalse(plugin.apply(context(), state));
        assertEquals(List.of(), state);
        assertTrue(loader.isLoaded(PluginWithOptionalDependency.class.getName()));
        assertFalse(loader.isLoaded(PluginWithOptionalDependency.EXTENSION));
    }

    @Test
    void logsWhatToCheckWhenTheExtensionCantSeeTheDependencysClasses() throws Exception
    {
        // Reported active, but its packages aren't exported to the plugin. Also proves the extension is loaded by the
        // calling plugin's loader: by the test's loader, it would see the type and succeed.
        HidingClassLoader loader = new HidingClassLoader(DependencyExtensionTest.class.getClassLoader(), MISSING_TYPE);
        BiFunction<BackendPluginContext, List<String>, Boolean> plugin = pluginLoadedBy(loader);
        List<Throwable> logged = new ArrayList<>();

        assertFalse(plugin.apply(context(logged, "dependency"), new ArrayList<>()));

        assertEquals(1, logged.size());
        IllegalStateException error = assertInstanceOf(IllegalStateException.class, logged.get(0));
        assertInstanceOf(NoClassDefFoundError.class, error.getCause());
        assertTrue(error.getMessage()
                .contains("uses a class the plugin can't see")
                && error.getMessage()
                        .contains("MissingDependencyType")
                && error.getMessage()
                        .contains("check that dependency exports it"),
                error.getMessage());
    }

    @Test
    void logsWhatTheExtensionThrowsAndThePluginActivatesWithoutIt()
    {
        List<Throwable> logged = new ArrayList<>();

        assertFalse(DependencyExtension.whenDependencyActive(context(logged, "dependency"), "dependency", ThrowingExtension.class.getName(), null));

        assertEquals(List.of(ThrowingExtension.FAILURE), logged);
    }

    @Test
    void aContextWithoutALoggerStillSkipsAFailingExtension()
    {
        // A plain Mockito mock, as in a plugin's own tests, returns no logger
        BackendPluginContext context = mock(BackendPluginContext.class);
        when(context.isDependencyActive("dependency")).thenReturn(true);

        assertFalse(DependencyExtension.whenDependencyActive(context, "dependency", ThrowingExtension.class.getName(), null));
    }

    @Test
    void rejectsAMissingClass()
    {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> DependencyExtension.whenDependencyActive(context("dependency"), "dependency", PACKAGE + "NoSuchExtension", null));

        assertTrue(error.getMessage()
                .contains("not found in the plugin"), error.getMessage());
    }

    @Test
    void rejectsAClassThatIsNotAnExtension()
    {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> DependencyExtension.whenDependencyActive(context("dependency"), "dependency", MISSING_TYPE, null));

        assertTrue(error.getMessage()
                .contains("must implement com.queryeer.backend.api.DependencyExtension"), error.getMessage());
    }

    @Test
    void rejectsAnExtensionWithoutANoArgumentConstructor()
    {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> DependencyExtension.whenDependencyActive(context("dependency"), "dependency", PACKAGE + "ExtensionWithoutDefaultConstructor", null));

        assertTrue(error.getMessage()
                .contains("needs a no-argument constructor"), error.getMessage());
    }

    @Test
    void doesNotLookUpTheClassWhenTheDependencyIsNotActive() throws Exception
    {
        assertFalse(DependencyExtension.whenDependencyActive(context(), "dependency", PACKAGE + "NoSuchExtension", null));
    }

    private static BackendPluginContext context(String... activeDependencies)
    {
        return context(new ArrayList<>(), activeDependencies);
    }

    /** Records what the plugin's logger gets as errors. */
    private static BackendPluginContext context(List<Throwable> loggedErrors, String... activeDependencies)
    {
        LoggerService logger = mock(LoggerService.class);
        doAnswer(invocation -> loggedErrors.add(invocation.getArgument(1))).when(logger)
                .error(anyString(), any());
        BackendPluginContext delegate = mock(BackendPluginContext.class);
        when(delegate.logger()).thenReturn(logger);
        return new PluginScopedContext(delegate, Set.of(activeDependencies));
    }

    @SuppressWarnings("unchecked")
    private static BiFunction<BackendPluginContext, List<String>, Boolean> pluginLoadedBy(ClassLoader loader) throws Exception
    {
        return (BiFunction<BackendPluginContext, List<String>, Boolean>) loader.loadClass(PluginWithOptionalDependency.class.getName())
                .getDeclaredConstructor()
                .newInstance();
    }

    /** Defines the test plugin's classes itself (child-first), and can't see one of them; everything else comes from the parent. */
    private static final class HidingClassLoader extends ClassLoader
    {
        private final String hiddenClass;

        HidingClassLoader(ClassLoader parent, String hiddenClass)
        {
            super(parent);
            this.hiddenClass = hiddenClass;
        }

        boolean isLoaded(String name)
        {
            return findLoadedClass(name) != null;
        }

        @Override
        protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException
        {
            if (name.equals(hiddenClass))
            {
                throw new ClassNotFoundException(name);
            }
            if (!name.startsWith(PACKAGE))
            {
                return super.loadClass(name, resolve);
            }
            synchronized (getClassLoadingLock(name))
            {
                Class<?> type = findLoadedClass(name);
                if (type == null)
                {
                    try (InputStream in = getParent().getResourceAsStream(name.replace('.', '/') + ".class"))
                    {
                        if (in == null)
                        {
                            throw new ClassNotFoundException(name);
                        }
                        byte[] bytes = in.readAllBytes();
                        type = defineClass(name, bytes, 0, bytes.length);
                    }
                    catch (IOException e)
                    {
                        throw new ClassNotFoundException(name, e);
                    }
                }
                return type;
            }
        }
    }
}
