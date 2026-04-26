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

import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.es.ESCatalog;

public final class ElasticsearchCatalogProvider implements PayloadbuilderCatalogProvider
{
    private static final String LIST_INDICES_ACTION = "payloadbuilder.es.listIndices";
    private static final Pattern INDEX_JSON_PATTERN = Pattern.compile("\\\"index\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Override
    public String catalogId()
    {
        return "elasticsearch";
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
            throw new IllegalArgumentException("Unsupported payloadbuilder action: " + action);
        }
        return listIndices(payload);
    }

    private Object listIndices(Object payload)
    {
        if (!(payload instanceof Map<?, ?> payloadMap))
        {
            throw new IllegalArgumentException("payloadbuilder.es.listIndices payload must be an object");
        }
        Object propertiesObject = payloadMap.get("properties");
        if (!(propertiesObject instanceof Map<?, ?> properties))
        {
            throw new IllegalArgumentException("payloadbuilder.es.listIndices payload.properties must be an object");
        }

        String endpoint = normalize(properties.get(ESCatalog.ENDPOINT_KEY));
        if (endpoint.isEmpty())
        {
            throw new IllegalArgumentException("endpoint is required for payloadbuilder.es.listIndices");
        }

        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(resolveCatIndicesUri(endpoint))
                .GET()
                .timeout(Duration.ofSeconds(30))
                .header("Accept", "application/json");

        String authType = normalize(properties.get(ESCatalog.AUTH_TYPE_KEY)).toUpperCase();
        if ("BASIC".equals(authType))
        {
            String username = normalize(properties.get(ESCatalog.AUTH_USERNAME_KEY));
            String password = normalize(properties.get(ESCatalog.AUTH_PASSWORD_KEY));
            String token = Base64.getEncoder()
                    .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8));
            requestBuilder.header("Authorization", "Basic " + token);
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
            throw new IllegalArgumentException("Interrupted while listing Elasticsearch indices", e);
        }
        catch (Exception e)
        {
            throw new IllegalArgumentException("Failed to list Elasticsearch indices: " + e.getMessage(), e);
        }

        if (response.statusCode() >= 400)
        {
            throw new IllegalArgumentException("Elasticsearch request failed with status " + response.statusCode());
        }

        LinkedHashSet<String> indices = new LinkedHashSet<>(parseIndices(response.body()));
        return Map.of("indices", List.copyOf(indices));
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
}
