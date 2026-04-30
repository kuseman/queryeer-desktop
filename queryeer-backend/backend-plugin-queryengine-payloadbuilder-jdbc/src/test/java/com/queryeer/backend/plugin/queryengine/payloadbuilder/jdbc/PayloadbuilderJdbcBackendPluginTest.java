package com.queryeer.backend.plugin.queryengine.payloadbuilder.jdbc;

import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class PayloadbuilderJdbcBackendPluginTest
{
    @Test
    void descriptorDeclaresDependenciesAndCapabilities()
    {
        PayloadbuilderJdbcBackendPlugin plugin = new PayloadbuilderJdbcBackendPlugin();

        Assertions.assertEquals("query.payloadbuilder.jdbc", plugin.descriptor()
                .id());
        Assertions.assertEquals(List.of("query.payloadbuilder", "query.jdbc"), plugin.descriptor()
                .dependencies());
        Assertions.assertEquals(List.of("queryengine.payloadbuilder.jdbc.bridge"), plugin.descriptor()
                .providesCapabilities());
        Assertions.assertEquals(List.of("queryengine.payloadbuilder.catalog", "queryengine.jdbc.connection"), plugin.descriptor()
                .requiredCapabilities());
    }
}
