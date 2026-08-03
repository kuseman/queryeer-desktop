package com.queryeer.backend.contract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.contract.engine.EngineInvokeParams;
import com.queryeer.backend.contract.engine.EngineInvokeResult;
import com.queryeer.backend.contract.file.FileChangeNotification;
import com.queryeer.backend.contract.file.FileCloseParams;
import com.queryeer.backend.contract.file.FileCloseResult;
import com.queryeer.backend.contract.file.FileOpenParams;
import com.queryeer.backend.contract.file.FileOpenResult;
import com.queryeer.backend.contract.handshake.HandshakeResult;
import com.queryeer.backend.contract.health.PingResult;
import com.queryeer.backend.contract.query.QueryCancelResult;
import com.queryeer.backend.contract.query.QueryChunkRowsNotification;
import com.queryeer.backend.contract.query.QueryChunkStartNotification;
import com.queryeer.backend.contract.query.QueryCompletedNotification;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.contract.query.QueryExecuteResult;
import com.queryeer.backend.contract.query.QueryFailedNotification;
import com.queryeer.backend.contract.query.QueryLargeValueReadParams;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;
import com.queryeer.backend.contract.query.QueryProgressNotification;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;

import tools.jackson.databind.ObjectMapper;

class ProtocolFixtureCompatibilityTest
{
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void handshakeFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-handshake.json");
        BackendEnvelope response = readFixture("response-handshake.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("backend.handshake", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        HandshakeResult result = objectMapper.convertValue(response.result(), HandshakeResult.class);
        Assertions.assertEquals("queryeer-java-backend", result.server()
                .name());
        Assertions.assertEquals(ProtocolVersion.V1_0_0, result.selectedProtocolVersion());
        Assertions.assertTrue(result.supportedCapabilities()
                .contains("queryengine.largeValue.read"));
        Assertions.assertFalse(result.supportedCapabilities()
                .contains("file.bind"));
    }

    @Test
    void pingFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-ping.json");
        BackendEnvelope response = readFixture("response-ping.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("health.ping", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        PingResult result = objectMapper.convertValue(response.result(), PingResult.class);
        Assertions.assertEquals("2026-01-01T00:00:00.000Z", result.timestamp());
        Assertions.assertTrue(result.uptimeMs() >= 0);
    }

    @Test
    void runtimeStatusFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-runtime-status.json");
        BackendEnvelope response = readFixture("response-runtime-status.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("backend.runtimeStatus", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        RuntimeStatusResult result = objectMapper.convertValue(response.result(), RuntimeStatusResult.class);
        Assertions.assertNotNull(result.startedAt());
        Assertions.assertFalse(result.pluginStatuses()
                .isEmpty());
    }

    @Test
    void queryExecuteFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-query-execute.json");
        BackendEnvelope response = readFixture("response-query-execute.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("queryengine.execute", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        QueryExecuteParams params = objectMapper.convertValue(request.params(), QueryExecuteParams.class);
        Assertions.assertEquals("file-fixture-1", params.fileId());
        Assertions.assertNotNull(params.engineState());

        QueryExecuteResult result = objectMapper.convertValue(response.result(), QueryExecuteResult.class);
        Assertions.assertTrue(result.accepted());
        Assertions.assertEquals("exec-fixture-1", result.queryExecutionId());

        Assertions.assertThrows(tools.jackson.databind.exc.ValueInstantiationException.class,
                () -> objectMapper.convertValue(Map.of("queryExecutionId", "exec-missing-file", "engineId", "payloadbuilder", "text", "select 1"), QueryExecuteParams.class));
    }

    @Test
    void jdbcEngineStateRoundTrips() throws IOException
    {
        BackendEnvelope request = readFixture("request-query-execute-jdbc.json");

        QueryExecuteParams params = objectMapper.convertValue(request.params(), QueryExecuteParams.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> engineState = objectMapper.convertValue(params.engineState(), Map.class);
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440010", engineState.get("connectionId"));
        Assertions.assertEquals("appdb", engineState.get("database"));

        // Round-trip: serialize back and verify
        BackendEnvelope roundTripped = objectMapper.readValue(objectMapper.writeValueAsString(request), BackendEnvelope.class);
        QueryExecuteParams roundParams = objectMapper.convertValue(roundTripped.params(), QueryExecuteParams.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> roundEngineState = objectMapper.convertValue(roundParams.engineState(), Map.class);
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440010", roundEngineState.get("connectionId"));
        Assertions.assertEquals("appdb", roundEngineState.get("database"));
    }

    @Test
    void payloadbuilderEngineStateRoundTrips() throws IOException
    {
        BackendEnvelope request = readFixture("request-query-execute-payloadbuilder.json");

        QueryExecuteParams params = objectMapper.convertValue(request.params(), QueryExecuteParams.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> engineState = objectMapper.convertValue(params.engineState(), Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> payloadbuilder = (Map<String, Object>) engineState.get("payloadbuilder");
        Assertions.assertNotNull(payloadbuilder);
        Assertions.assertEquals("test", payloadbuilder.get("selectedEnvironmentId"));
        Assertions.assertEquals("es1", payloadbuilder.get("defaultCatalogAlias"));

        @SuppressWarnings("unchecked")
        Map<String, Object> catalogs = (Map<String, Object>) payloadbuilder.get("catalogs");
        Assertions.assertNotNull(catalogs);
        @SuppressWarnings("unchecked")
        Map<String, Object> es1 = (Map<String, Object>) catalogs.get("es1");
        Assertions.assertEquals("elasticsearch", es1.get("catalogId"));
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) es1.get("properties");
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440020", properties.get("connectionId"));
        Assertions.assertEquals("my-idx", properties.get("index"));

        // Round-trip
        BackendEnvelope roundTripped = objectMapper.readValue(objectMapper.writeValueAsString(request), BackendEnvelope.class);
        QueryExecuteParams roundParams = objectMapper.convertValue(roundTripped.params(), QueryExecuteParams.class);
        Assertions.assertNotNull(roundParams.engineState());
    }

    @Test
    void completedNotificationEngineStateRoundTrips() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-completed-payloadbuilder.json");

        QueryCompletedNotification params = objectMapper.convertValue(notification.params(), QueryCompletedNotification.class);
        Assertions.assertEquals("exec-pb-1", params.queryExecutionId());
        Assertions.assertNotNull(params.engineState());

        @SuppressWarnings("unchecked")
        Map<String, Object> engineState = objectMapper.convertValue(params.engineState(), Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> pb = (Map<String, Object>) engineState.get("payloadbuilder");
        @SuppressWarnings("unchecked")
        Map<String, Object> catalogs = (Map<String, Object>) pb.get("catalogs");
        @SuppressWarnings("unchecked")
        Map<String, Object> es1 = (Map<String, Object>) catalogs.get("es1");
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) es1.get("properties");
        Assertions.assertEquals("my-idx-updated", properties.get("index"));

        // Round-trip
        BackendEnvelope roundTripped = objectMapper.readValue(objectMapper.writeValueAsString(notification), BackendEnvelope.class);
        QueryCompletedNotification roundParams = objectMapper.convertValue(roundTripped.params(), QueryCompletedNotification.class);
        Assertions.assertNotNull(roundParams.engineState());
    }

    @Test
    void queryCancelFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-query-cancel.json");
        BackendEnvelope response = readFixture("response-query-cancel.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("queryengine.cancel", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        QueryCancelResult result = objectMapper.convertValue(response.result(), QueryCancelResult.class);
        Assertions.assertTrue(result.accepted());
        Assertions.assertEquals("exec-fixture-1", result.queryExecutionId());
    }

    @Test
    void queryLargeValueReadFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-large-value-read.json");
        BackendEnvelope response = readFixture("response-large-value-read.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("queryengine.largeValue.read", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        QueryLargeValueReadParams params = objectMapper.convertValue(request.params(), QueryLargeValueReadParams.class);
        QueryLargeValueReadResult result = objectMapper.convertValue(response.result(), QueryLargeValueReadResult.class);
        Assertions.assertEquals(params.ref(), result.ref());
        Assertions.assertEquals("json", result.logicalType());
        Assertions.assertEquals("{\"large\":true}", result.content());
    }

    @Test
    void engineInvokeFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-engine-invoke.json");
        BackendEnvelope response = readFixture("response-engine-invoke.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("queryengine.invoke", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        EngineInvokeParams params = objectMapper.convertValue(request.params(), EngineInvokeParams.class);
        Assertions.assertEquals("payloadbuilder", params.engineId());
        Assertions.assertEquals("file-fixture-1", params.fileId());
        Assertions.assertEquals("engine.capabilities", params.action());

        EngineInvokeResult result = objectMapper.convertValue(response.result(), EngineInvokeResult.class);
        Assertions.assertNotNull(result.result());
    }

    @Test
    void queryProgressNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-progress.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("queryengine.progress", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryProgressNotification params = objectMapper.convertValue(notification.params(), QueryProgressNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertEquals(40, params.percent());
    }

    @Test
    void queryChunkStartNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-chunk-start.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("queryengine.chunkStart", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryChunkStartNotification params = objectMapper.convertValue(notification.params(), QueryChunkStartNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertEquals(0, params.resultSetIndex());
        Assertions.assertEquals(2, params.schema()
                .columns()
                .size());
        Assertions.assertEquals("int", params.schema()
                .columns()
                .get(0)
                .type());
        Assertions.assertEquals("json", params.schema()
                .columns()
                .get(1)
                .type());
    }

    @Test
    void queryChunkRowsNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-chunk-rows.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("queryengine.chunkRows", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryChunkRowsNotification params = objectMapper.convertValue(notification.params(), QueryChunkRowsNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertEquals(0, params.resultSetIndex());
        Assertions.assertEquals(2, params.rows()
                .size());
        Assertions.assertTrue(params.rows()
                .get(0)
                .get(1) instanceof Map);
        @SuppressWarnings("unchecked")
        Map<String, Object> largeValue = (Map<String, Object>) params.rows()
                .get(0)
                .get(1);
        Assertions.assertEquals("largeValue", largeValue.get("kind"));
        Assertions.assertEquals("{\"large\":true}", largeValue.get("preview"));
        Assertions.assertNotNull(params.messages());
        Assertions.assertEquals(1, params.messages()
                .size());
        Assertions.assertEquals(2, params.messages()
                .get(0)
                .line());
    }

    @Test
    void queryCompletedNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-completed.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("queryengine.completed", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryCompletedNotification params = objectMapper.convertValue(notification.params(), QueryCompletedNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertNotNull(params.metrics());
        Assertions.assertEquals(2, params.metrics()
                .rowCount());
        Assertions.assertNotNull(params.engineState());
    }

    @Test
    void queryFailedNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-failed.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("queryengine.failed", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryFailedNotification params = objectMapper.convertValue(notification.params(), QueryFailedNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertNotNull(params.error());
        Assertions.assertEquals(BackendErrorCode.INTERNAL, params.error()
                .code());
        Assertions.assertEquals(3, params.error()
                .details()
                .get("line"));
    }

    @Test
    void fileOpenFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-file-open.json");
        BackendEnvelope response = readFixture("response-file-open.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("file.open", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        FileOpenParams params = objectMapper.convertValue(request.params(), FileOpenParams.class);
        Assertions.assertEquals("file-fixture-1", params.fileId());
        Assertions.assertEquals("application/x-payloadbuilder", params.mimeType());
        Assertions.assertNotNull(params.engineBinding());
        Assertions.assertEquals("payloadbuilder", params.engineBinding()
                .engineId());

        FileOpenResult result = objectMapper.convertValue(response.result(), FileOpenResult.class);
        Assertions.assertEquals("file-fixture-1", result.fileId());
        Assertions.assertEquals(0L, result.backendVersion());
    }

    @Test
    void fileCloseFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-file-close.json");
        BackendEnvelope response = readFixture("response-file-close.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("file.close", request.method());
        Assertions.assertEquals(request.id(), response.id());

        FileCloseParams params = objectMapper.convertValue(request.params(), FileCloseParams.class);
        FileCloseResult result = objectMapper.convertValue(response.result(), FileCloseResult.class);
        Assertions.assertEquals(params.fileId(), result.fileId());
        Assertions.assertTrue(result.accepted());
    }

    @Test
    void fileChangeNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-file-change.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("file.change", notification.method());
        Assertions.assertNotNull(notification.params());

        FileChangeNotification params = objectMapper.convertValue(notification.params(), FileChangeNotification.class);
        Assertions.assertEquals("file-fixture-1", params.fileId());
        Assertions.assertEquals(3L, params.version());
        Assertions.assertNotNull(params.text());
    }

    private void assertEnvelopeBase(BackendEnvelope envelope)
    {
        Assertions.assertEquals(ProtocolVersion.V1_0_0, envelope.protocolVersion());
        Assertions.assertNotNull(envelope.type());
    }

    private BackendEnvelope readFixture(String fixtureName) throws IOException
    {
        Path fixturePath = Paths.get("..", "..", "protocol-fixtures", "backend", fixtureName)
                .toAbsolutePath()
                .normalize();
        String json = Files.readString(fixturePath);
        return objectMapper.readValue(json, BackendEnvelope.class);
    }
}
