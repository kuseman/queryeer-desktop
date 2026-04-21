package com.queryeer.backend.contract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.connection.ConnectionUpsertResult;
import com.queryeer.backend.contract.credential.CredentialStoreResult;
import com.queryeer.backend.contract.file.FileBindParams;
import com.queryeer.backend.contract.file.FileBindResult;
import com.queryeer.backend.contract.file.FileChangeNotification;
import com.queryeer.backend.contract.file.FileCloseParams;
import com.queryeer.backend.contract.file.FileCloseResult;
import com.queryeer.backend.contract.file.FileOpenParams;
import com.queryeer.backend.contract.file.FileOpenResult;
import com.queryeer.backend.contract.handshake.HandshakeResult;
import com.queryeer.backend.contract.health.PingResult;
import com.queryeer.backend.contract.query.QueryCancelResult;
import com.queryeer.backend.contract.query.QueryCompletedNotification;
import com.queryeer.backend.contract.query.QueryExecuteResult;
import com.queryeer.backend.contract.query.QueryFailedNotification;
import com.queryeer.backend.contract.query.QueryProgressNotification;
import com.queryeer.backend.contract.query.QueryResultChunkNotification;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;

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
        Assertions.assertEquals("query.execute", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        QueryExecuteResult result = objectMapper.convertValue(response.result(), QueryExecuteResult.class);
        Assertions.assertTrue(result.accepted());
        Assertions.assertEquals("exec-fixture-1", result.queryExecutionId());
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
        Assertions.assertEquals("query.cancel", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        QueryCancelResult result = objectMapper.convertValue(response.result(), QueryCancelResult.class);
        Assertions.assertTrue(result.accepted());
        Assertions.assertEquals("exec-fixture-1", result.queryExecutionId());
    }

    @Test
    void connectionUpsertFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-connection-upsert.json");
        BackendEnvelope response = readFixture("response-connection-upsert.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("connection.upsert", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        ConnectionUpsertResult result = objectMapper.convertValue(response.result(), ConnectionUpsertResult.class);
        Assertions.assertEquals("conn-fixture-1", result.connectionId());
        Assertions.assertEquals(1L, result.version());
    }

    @Test
    void credentialStoreFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-credential-store.json");
        BackendEnvelope response = readFixture("response-credential-store.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("credential.store", request.method());
        Assertions.assertEquals(request.id(), response.id());
        Assertions.assertNotNull(response.result());

        CredentialStoreResult result = objectMapper.convertValue(response.result(), CredentialStoreResult.class);
        Assertions.assertEquals("conn-fixture-1", result.connectionId());
        Assertions.assertEquals("cred-fixture-1", result.credentialId());
        Assertions.assertEquals(1L, result.version());
    }

    @Test
    void queryProgressNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-progress.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("query.progress", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryProgressNotification params = objectMapper.convertValue(notification.params(), QueryProgressNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertEquals(40, params.percent());
    }

    @Test
    void queryResultChunkNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-result-chunk.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("query.resultChunk", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryResultChunkNotification params = objectMapper.convertValue(notification.params(), QueryResultChunkNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertEquals(0, params.chunkIndex());
        Assertions.assertEquals(2, params.rows()
                .size());
    }

    @Test
    void queryCompletedNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-completed.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("query.completed", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryCompletedNotification params = objectMapper.convertValue(notification.params(), QueryCompletedNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertNotNull(params.metrics());
        Assertions.assertEquals(2, params.metrics()
                .rowCount());
    }

    @Test
    void queryFailedNotificationFixtureIsCompatible() throws IOException
    {
        BackendEnvelope notification = readFixture("notification-query-failed.json");

        assertEnvelopeBase(notification);
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, notification.type());
        Assertions.assertEquals("query.failed", notification.method());
        Assertions.assertNotNull(notification.params());

        QueryFailedNotification params = objectMapper.convertValue(notification.params(), QueryFailedNotification.class);
        Assertions.assertEquals("exec-fixture-1", params.queryExecutionId());
        Assertions.assertNotNull(params.error());
        Assertions.assertEquals(BackendErrorCode.INTERNAL, params.error()
                .code());
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
    void fileBindFixturesAreCompatible() throws IOException
    {
        BackendEnvelope request = readFixture("request-file-bind.json");
        BackendEnvelope response = readFixture("response-file-bind.json");

        assertEnvelopeBase(request);
        assertEnvelopeBase(response);
        Assertions.assertEquals(EnvelopeType.REQUEST, request.type());
        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("file.bind", request.method());
        Assertions.assertEquals(request.id(), response.id());

        FileBindParams params = objectMapper.convertValue(request.params(), FileBindParams.class);
        FileBindResult result = objectMapper.convertValue(response.result(), FileBindResult.class);
        Assertions.assertEquals(params.fileId(), result.fileId());
        Assertions.assertEquals(params.engineId(), result.engineId());
        Assertions.assertTrue(result.backendVersion() >= 0L);
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
