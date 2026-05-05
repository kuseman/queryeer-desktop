package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.contract.payloadbuilder.EsListIndicesPayload;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.es.ESCatalog;

public final class ElasticsearchCatalogProvider implements PayloadbuilderCatalogProvider
{
    private static final String LIST_INDICES_ACTION = "payloadbuilder.es.listIndices";
    private static final String ES_MODULE_ID = "core.queryengine.payloadbuilder.elasticsearch";
    private static final String ES_CONNECTIONS_SETTING_ID = "core.queryengine.payloadbuilder.elasticsearch.connections";
    private static final Pattern INDEX_JSON_PATTERN = Pattern.compile("\\\"index\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_INDICES = "indices";
    private static final String ERROR_UNSUPPORTED_ACTION = "Unsupported payloadbuilder action: ";
    private static final String ERROR_PROPERTIES_REQUIRED = "payloadbuilder.es.listIndices payload.properties must be an object";
    private static final String ERROR_ENDPOINT_REQUIRED = "endpoint is required for payloadbuilder.es.listIndices";
    private static final String ERROR_INTERRUPTED = "Interrupted while listing Elasticsearch indices";
    private static final String ERROR_FAILED = "Failed to list Elasticsearch indices: ";
    private static final String ERROR_STATUS = "Elasticsearch request failed with status ";
    private static final String CATALOG_ID = "elasticsearch";

    private static final String HEADER_ACCEPT = "Accept";
    private static final String HEADER_AUTHORIZATION = "Authorization";
    private static final String CONTENT_TYPE_JSON = "application/json";
    private static final String AUTH_PREFIX_BASIC = "Basic ";
    private static final String AUTH_TYPE_BASIC = "BASIC";

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ConfigService configService;
    private final PayloadMapper payloadMapper;

    public ElasticsearchCatalogProvider(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.configService = configService;
        this.payloadMapper = payloadMapper;
    }

    /** Resolves connection properties from settings by connectionId and merges into the given properties map. */
    @SuppressWarnings("unchecked")
    @Override
    public Map<String, Object> resolveConnection(String connectionId)
    {
        SettingsModule module = configService.getModule(ES_MODULE_ID);
        if (module == null)
        {
            return Map.of();
        }
        Object conns = module.values()
                .get(ES_CONNECTIONS_SETTING_ID);
        if (!(conns instanceof List<?> list))
        {
            return Map.of();
        }
        for (Object item : list)
        {
            if (!(item instanceof Map<?, ?> entry))
            {
                continue;
            }
            if (!connectionId.equals(entry.get(KEY_CONNECTION_ID) instanceof String s ? trimToNull(s)
                    : null))
            {
                continue;
            }
            return (Map<String, Object>) entry;
        }
        return Map.of();
    }

    @Override
    public String catalogId()
    {
        return CATALOG_ID;
    }

    @Override
    public Catalog createCatalog()
    {
        return new ESCatalog();
    }

    @Override
    public Set<String> actions()
    {
        return Set.of(LIST_INDICES_ACTION);
    }

    @Override
    public Object invoke(String action, Object payload)
    {
        if (!LIST_INDICES_ACTION.equals(action))
        {
            throw new IllegalArgumentException(ERROR_UNSUPPORTED_ACTION + action);
        }
        return listIndices(payload);
    }

    private Object listIndices(Object payload)
    {
        EsListIndicesPayload params = payloadMapper.convert(payload, EsListIndicesPayload.class);
        if (params.properties() == null)
        {
            throw new IllegalArgumentException(ERROR_PROPERTIES_REQUIRED);
        }

        // Resolve connection from settings by connectionId if present
        String connectionId = trimToNull((String) params.properties()
                .get(KEY_CONNECTION_ID));
        Map<String, Object> effectiveProperties = connectionId != null ? resolveConnection(connectionId)
                : params.properties();

        String endpoint = normalize(effectiveProperties.get(ESCatalog.ENDPOINT_KEY));
        if (endpoint.isEmpty())
        {
            throw new IllegalArgumentException(ERROR_ENDPOINT_REQUIRED);
        }

        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(resolveCatIndicesUri(endpoint))
                .GET()
                .timeout(Duration.ofSeconds(30))
                .header(HEADER_ACCEPT, CONTENT_TYPE_JSON);

        String authType = normalize(effectiveProperties.get(ESCatalog.AUTH_TYPE_KEY)).toUpperCase();
        if (AUTH_TYPE_BASIC.equals(authType))
        {
            String username = normalize(effectiveProperties.get(ESCatalog.AUTH_USERNAME_KEY));
            String password = normalize(effectiveProperties.get(ESCatalog.AUTH_PASSWORD_KEY));
            String token = Base64.getEncoder()
                    .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8));
            requestBuilder.header(HEADER_AUTHORIZATION, AUTH_PREFIX_BASIC + token);
        }

        HttpResponse<String> response;
        try
        {
            response = httpClient.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        }
        catch (InterruptedException e)
        {
            Thread.currentThread()
                    .interrupt();
            throw new IllegalArgumentException(ERROR_INTERRUPTED, e);
        }
        catch (Exception e)
        {
            throw new IllegalArgumentException(ERROR_FAILED + e.getMessage(), e);
        }

        if (response.statusCode() >= 400)
        {
            throw new IllegalArgumentException(ERROR_STATUS + response.statusCode());
        }

        LinkedHashSet<String> indices = new LinkedHashSet<>(parseIndices(response.body()));
        return Map.of(KEY_INDICES, List.copyOf(indices));
    }

    private static URI resolveCatIndicesUri(String endpoint)
    {
        String normalizedEndpoint = endpoint.endsWith("/") ? endpoint.substring(0, endpoint.length() - 1)
                : endpoint;
        return URI.create(normalizedEndpoint + "/_cat/indices?format=json&h=index");
    }

    private static List<String> parseIndices(String json)
    {
        List<String> result = new ArrayList<>();
        Matcher matcher = INDEX_JSON_PATTERN.matcher(json);
        while (matcher.find())
        {
            String index = matcher.group(1)
                    .trim();
            if (!index.isEmpty())
            {
                result.add(index);
            }
        }
        return result;
    }

    private static String normalize(Object value)
    {
        return value instanceof String text ? text.trim()
                : "";
    }

    private static String trimToNull(String value)
    {
        if (value == null)
        {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }
}
