package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class InMemoryPluginServiceRegistryTest
{
    interface Greeter
    {
        String greet();
    }

    @Test
    void requireReturnsARegisteredService()
    {
        InMemoryPluginServiceRegistry registry = new InMemoryPluginServiceRegistry();
        Greeter greeter = () -> "hello";
        registry.register(Greeter.class, greeter);

        assertSame(greeter, registry.require(Greeter.class));
    }

    @Test
    void requireSaysWhatToCheckWhenAServiceIsMissing()
    {
        InMemoryPluginServiceRegistry registry = new InMemoryPluginServiceRegistry();

        assertNull(registry.get(Greeter.class));
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> registry.require(Greeter.class));
        assertTrue(error.getMessage()
                .startsWith(Greeter.class.getName() + " is not registered."), error.getMessage());
        assertEquals(true, error.getMessage()
                .contains("must be a dependency in plugin.json"));
    }
}
