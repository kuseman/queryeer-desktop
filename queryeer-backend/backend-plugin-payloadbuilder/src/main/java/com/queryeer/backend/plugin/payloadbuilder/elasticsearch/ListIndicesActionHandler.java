package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

class ListIndicesActionHandler
{
    private static final String HEADER_ACCEPT = "Accept";
    private static final String HEADER_AUTHORIZATION = "Authorization";
    private static final String CONTENT_TYPE_JSON = "application/json";
    private static final String AUTH_PREFIX_BASIC = "Basic ";
    private static final String AUTH_TYPE_BASIC = "BASIC";
    private static final String ERROR_INTERRUPTED = "Interrupted while listing Elasticsearch indices";
    private static final String ERROR_FAILED = "Failed to list Elasticsearch indices: ";
    private static final String ERROR_STATUS = "Elasticsearch request failed with status ";
    private static final String KEY_INDICES = "indices";
    private static final String KEY_DATA_STREAMS = "data_streams";
    private static final String KEY_NAME = "name";
    private static final Pattern INDEX_JSON_PATTERN = Pattern.compile("\\\"index\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final Pattern ALIAS_JSON_PATTERN = Pattern.compile("\\\"alias\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final String ERROR_PROPERTIES_REQUIRED = "payloadbuilder.es.listIndices payload.properties must be an object";
    private static final String CAT_INDICES_PATH = "/_cat/indices?format=json&h=index";
    private static final String CAT_ALIASES_PATH = "/_cat/aliases?format=json&h=alias";
    private static final String DATA_STREAM_PATH = "/_data_stream";

    private static final HttpClient HTTPCLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final ElasticsearchCatalogProvider provider;

    ListIndicesActionHandler(ElasticsearchCatalogProvider provider)
    {
        this.provider = provider;
    }

    Map<String, Object> listIndices(Object payload)
    {
        EsListIndicesPayload params = provider.payloadMapper.convert(payload, EsListIndicesPayload.class);
        if (params.properties() == null)
        {
            throw new IllegalArgumentException(ERROR_PROPERTIES_REQUIRED);
        }

        String connectionId = stringValue(params.properties(), ElasticsearchCatalogProvider.KEY_CONNECTION_ID);
        ElasticsearchConnection connection = provider.getConnection(connectionId);
        if (connection == null)
        {
            throw new IllegalArgumentException("Connection with id: " + connectionId + " could not be found");
        }

        List<String> indices = fetchCatIndices(connection);
        List<String> aliases = fetchCatAliases(connection);
        List<String> datastreams = fetchDataStreams(connection);

        aliases.sort(String.CASE_INSENSITIVE_ORDER);
        datastreams.sort(String.CASE_INSENSITIVE_ORDER);
        indices.sort(String.CASE_INSENSITIVE_ORDER);

        LinkedHashSet<String> result = new LinkedHashSet<>();
        result.addAll(aliases);
        result.addAll(datastreams);
        result.addAll(indices);

        return Map.of(KEY_INDICES, List.copyOf(result));
    }

    private HttpRequest buildGetRequest(ElasticsearchConnection connection, String path)
    {
        String endpoint = connection.endpoint();
        String normalizedEndpoint = endpoint.endsWith("/") ? endpoint.substring(0, endpoint.length() - 1)
                : endpoint;

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(normalizedEndpoint + path))
                .GET()
                .timeout(Duration.ofSeconds(30))
                .header(HEADER_ACCEPT, CONTENT_TYPE_JSON);

        if (AUTH_TYPE_BASIC.equals(connection.authType()))
        {
            String username = connection.authUsername();
            String password = (String) provider.configService.materializeSecrets(connection.authPassword());
            String token = Base64.getEncoder()
                    .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8));
            builder.header(HEADER_AUTHORIZATION, AUTH_PREFIX_BASIC + token);
        }

        return builder.build();
    }

    private HttpResponse<String> sendRequest(HttpRequest request)
    {
        try
        {
            return HTTPCLIENT.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
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
    }

    private void checkOkStatus(HttpResponse<String> response)
    {
        if (response.statusCode() >= 400)
        {
            throw new IllegalArgumentException(ERROR_STATUS + response.statusCode());
        }
    }

    private List<String> fetchCatIndices(ElasticsearchConnection connection)
    {
        HttpRequest request = buildGetRequest(connection, CAT_INDICES_PATH);
        HttpResponse<String> response = sendRequest(request);
        checkOkStatus(response);
        return parseCatResponse(response.body(), INDEX_JSON_PATTERN);
    }

    private List<String> fetchCatAliases(ElasticsearchConnection connection)
    {
        HttpRequest request = buildGetRequest(connection, CAT_ALIASES_PATH);
        HttpResponse<String> response = sendRequest(request);
        checkOkStatus(response);
        return parseCatResponse(response.body(), ALIAS_JSON_PATTERN);
    }

    private List<String> fetchDataStreams(ElasticsearchConnection connection)
    {
        try
        {
            HttpRequest request = buildGetRequest(connection, DATA_STREAM_PATH);
            HttpResponse<String> response = sendRequest(request);
            if (response.statusCode() >= 400)
            {
                return List.of();
            }
            return parseDataStreams(response.body());
        }
        catch (Exception e)
        {
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private List<String> parseDataStreams(String json)
    {
        List<String> result = new ArrayList<>();
        Map<String, Object> responseMap = provider.payloadMapper.parseJson(json, Map.class);
        Object dataStreamsObj = responseMap.get(KEY_DATA_STREAMS);
        if (dataStreamsObj instanceof List)
        {
            List<Map<String, Object>> streams = (List<Map<String, Object>>) dataStreamsObj;
            for (Map<String, Object> stream : streams)
            {
                String name = (String) stream.get(KEY_NAME);
                if (name != null
                        && !name.isEmpty())
                {
                    result.add(name);
                }
            }
        }
        return result;
    }

    private static List<String> parseCatResponse(String json, Pattern pattern)
    {
        List<String> result = new ArrayList<>();
        Matcher matcher = pattern.matcher(json);
        while (matcher.find())
        {
            String value = matcher.group(1)
                    .trim();
            if (!value.isEmpty())
            {
                result.add(value);
            }
        }
        return result;
    }
}
