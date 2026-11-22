package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.core.security.SecuritySession;

class PluginActionServiceTest
{
    @Test
    void aPluginsFrontendCallsTheActionsItRegisteredWhileActivating() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("kafka", context -> context.actions()
                .register("topics.list", payload -> Map.of("topics", List.of("orders"), "payload", payload))));

        runtime.activateAll(context());

        assertEquals(Map.of("topics", List.of("orders"), "payload", Map.of("connectionId", "local")), runtime.actions()
                .invoke("kafka", "topics.list", Map.of("connectionId", "local")));
    }

    @Test
    void actionsAreScopedToThePluginThatRegisteredThem() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("kafka", context -> context.actions()
                .register("topics.list", _ -> "kafka")));
        runtime.register(plugin("other", context -> context.actions()
                .register("topics.list", _ -> "other")));

        runtime.activateAll(context());

        assertEquals("kafka", runtime.actions()
                .invoke("kafka", "topics.list", null));
        assertEquals("other", runtime.actions()
                .invoke("other", "topics.list", null));
        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke("unknown", "topics.list", null));
        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke("kafka", "missing", null));
        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke(null, "topics.list", null));
    }

    @Test
    void failuresMapToErrorCodes() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("kafka", context ->
        {
            context.actions()
                    .register("bad", _ ->
                    {
                        throw new IllegalArgumentException("No connection 'x'");
                    });
            context.actions()
                    .register("broken", _ ->
                    {
                        throw new IllegalStateException("Boom");
                    });
        }));

        runtime.activateAll(context());

        PluginActionService.PluginActionException bad = assertCode(BackendErrorCode.VALIDATION, () -> runtime.actions()
                .invoke("kafka", "bad", null));
        assertEquals("No connection 'x'", bad.getMessage());
        assertCode(BackendErrorCode.INTERNAL, () -> runtime.actions()
                .invoke("kafka", "broken", null));
    }

    @Test
    void aPluginThatFailsToActivateOrDeactivatesLeavesNoActions() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("failing", context ->
        {
            context.actions()
                    .register("ping", _ -> "pong");
            throw new IllegalStateException("Activation failed");
        }));
        runtime.register(plugin("kafka", context -> context.actions()
                .register("ping", _ -> "pong")));

        runtime.activateAll(context());

        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke("failing", "ping", null));
        assertEquals("pong", runtime.actions()
                .invoke("kafka", "ping", null));

        runtime.deactivateAll();

        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke("kafka", "ping", null));
    }

    @Test
    void aMissingActionNameIsAValidationError()
    {
        PluginActionService actions = new PluginActionService();
        assertCode(BackendErrorCode.VALIDATION, () -> actions.invoke("kafka", null, null));
        assertCode(BackendErrorCode.VALIDATION, () -> actions.invoke("kafka", " ", null));
    }

    @Test
    void aLinkageErrorInAHandlerIsAnInternalError()
    {
        PluginActionService actions = new PluginActionService();
        actions.forPlugin("kafka")
                .register("ping", _ ->
                {
                    throw new NoClassDefFoundError("se/kuseman/payloadbuilder/api/catalog/Catalog");
                });
        assertCode(BackendErrorCode.INTERNAL, () -> actions.invoke("kafka", "ping", null));
    }

    @Test
    void aRegistryKeptAfterItsPluginIsGoneRefusesRegistrations() throws Exception
    {
        java.util.concurrent.atomic.AtomicReference<com.queryeer.backend.api.PluginActionRegistry> kept = new java.util.concurrent.atomic.AtomicReference<>();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("kafka", context -> kept.set(context.actions())));

        runtime.activateAll(context());
        runtime.deactivateAll();

        assertThrows(IllegalStateException.class, () -> kept.get()
                .register("late", _ -> "too late"));
        assertCode(BackendErrorCode.ACTION_NOT_FOUND, () -> runtime.actions()
                .invoke("kafka", "late", null));
    }

    @Test
    void theSharedContextHasNoActions()
    {
        BackendPluginContext shared = context();
        assertThrows(UnsupportedOperationException.class, shared::actions);
    }

    private static PluginActionService.PluginActionException assertCode(BackendErrorCode code, org.junit.jupiter.api.function.Executable call)
    {
        PluginActionService.PluginActionException e = assertThrows(PluginActionService.PluginActionException.class, call);
        assertEquals(code, e.code());
        return e;
    }

    private static BackendPluginContext context()
    {
        return BackendPlatformServices.fileBased(Map.of(), new SecuritySession())
                .pluginContext();
    }

    private interface Activation
    {
        void activate(BackendPluginContext context) throws Exception;
    }

    private static BackendPlugin plugin(String id, Activation activation)
    {
        PluginDescriptor descriptor = new PluginDescriptor(id, id, "1.0.0", List.of(), List.of(), List.of(), Map.of(), List.of());
        return new BackendPlugin()
        {
            @Override
            public PluginDescriptor descriptor()
            {
                return descriptor;
            }

            @Override
            public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor) throws Exception
            {
                activation.activate(context);
            }
        };
    }
}
