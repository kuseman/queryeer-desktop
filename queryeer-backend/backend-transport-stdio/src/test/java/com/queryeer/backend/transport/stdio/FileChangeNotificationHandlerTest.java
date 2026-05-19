package com.queryeer.backend.transport.stdio;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.core.MapperUtils;

class FileChangeNotificationHandlerTest
{
    @Test
    void upsertsByOpeningFileWhenSessionMissing()
    {
        FileRegistry fileRegistry = Mockito.mock(FileRegistry.class);
        when(fileRegistry.get("f-1")).thenReturn(Optional.empty());
        when(fileRegistry.change("f-1", 2L, "select 2")).thenReturn(Optional.empty());

        FileChangeNotificationHandler handler = new FileChangeNotificationHandler(new EnvelopeCodec(MapperUtils.MAPPER), fileRegistry);

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "file.change", Map.of("fileId", "f-1", "version", 2, "text", "select 2", "uri",
                "file:///tmp/a.sql", "mimeType", "application/sql", "engineBinding", Map.of("engineId", "jdbc", "connectionId", "conn-1")), null, null);

        handler.handle(envelope);

        verify(fileRegistry).open(eq("f-1"), eq(URI.create("file:///tmp/a.sql")), eq("application/sql"), eq("jdbc"), eq("conn-1"), eq("select 2"));
        verify(fileRegistry).change("f-1", 2L, "select 2");
    }

    @Test
    void rebindsWhenIncomingBindingDiffersFromExistingSession()
    {
        FileRegistry fileRegistry = Mockito.mock(FileRegistry.class);
        FileSession existing = new FileSession("f-1", URI.create("file:///tmp/a.sql"), "application/sql", "payloadbuilder", "old-conn", 1L);
        when(fileRegistry.get("f-1")).thenReturn(Optional.of(existing));

        FileChangeNotificationHandler handler = new FileChangeNotificationHandler(new EnvelopeCodec(MapperUtils.MAPPER), fileRegistry);

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "file.change",
                Map.of("fileId", "f-1", "version", 3, "text", "select 3", "engineBinding", Map.of("engineId", "jdbc", "connectionId", "conn-1")), null, null);

        handler.handle(envelope);

        verify(fileRegistry).bind("f-1", "jdbc", "conn-1");
        verify(fileRegistry, never()).open(eq("f-1"), eq(URI.create("file:///tmp/a.sql")), eq("application/sql"), eq("jdbc"), eq("conn-1"), eq("select 3"));
        verify(fileRegistry).change("f-1", 3L, "select 3");
    }
}
