package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.core.security.SecuritySession;

class BackendPlatformServicesTest
{
    @Test
    void defaultServicesReturnsInMemoryConfigService()
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices();

        ConfigService config = services.config();
        assertNotNull(config);
        assertInstanceOf(InMemoryConfigService.class, config);
        assertNull(config.getModule("anything"));
    }

    @Test
    void defaultServicesWithMapReturnsInMemoryConfigService()
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices(Map.of("key", "val"));

        ConfigService config = services.config();
        assertNotNull(config);
        assertInstanceOf(InMemoryConfigService.class, config);
    }

    @Test
    void fileBasedReturnsFileBasedConfigService()
    {
        SecuritySession session = new SecuritySession();
        BackendPlatformServices services = BackendPlatformServices.fileBased(Map.of("queryeer.settings.dir", "/tmp/fake"), session);

        ConfigService config = services.config();
        assertNotNull(config);
        assertInstanceOf(FileBasedConfigService.class, config);
    }

    @Test
    void pluginContextReturnsNonNull()
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices();

        assertNotNull(services.pluginContext());
        assertNotNull(services.pluginContext()
                .config());
        assertNotNull(services.pluginContext()
                .logger());
        assertNotNull(services.pluginContext()
                .queryEngines());
        assertNotNull(services.pluginContext()
                .fileSessions());
        assertNotNull(services.pluginContext()
                .events());
        assertNotNull(services.pluginContext()
                .scheduler());
        assertNotNull(services.pluginContext()
                .payloadMapper());
    }
}
