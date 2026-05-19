package com.queryeer.backend.plugin.jdbc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.mockito.Mockito;
import org.mockito.invocation.InvocationOnMock;
import org.mockito.stubbing.Answer;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.MapperUtils;

public class TestUtils
{
    public static ConfigService mockConnections(String connections) throws Exception
    {
        ConfigService configService = Mockito.mock(ConfigService.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> value = MapperUtils.MAPPER.readValue(connections, Map.class);
        when(configService.getModule(DefaultJdbcConnections.MODULE_ID)).thenReturn(new SettingsModule(DefaultJdbcConnections.MODULE_ID, 0L, "2010-10-10T10:10:10Z", value));
        when(configService.materializeSecrets(any())).thenAnswer(new Answer<Object>()
        {
            @Override
            public Object answer(InvocationOnMock invocation) throws Throwable
            {
                Object payload = invocation.getArgument(0);
                if (payload instanceof Map<?, ?> map
                        && map.get("secretRef") instanceof String ref)
                {
                    return "materialized-" + ref;
                }
                return payload;
            }
        });
        return configService;
    }
}
