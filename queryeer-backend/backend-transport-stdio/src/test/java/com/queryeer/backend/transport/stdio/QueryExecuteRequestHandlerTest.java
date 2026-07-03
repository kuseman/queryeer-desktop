package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.api.LargeValueWriter;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;
import com.queryeer.backend.core.MapperUtils;
import com.queryeer.backend.core.query.QueryExecutionService;

class QueryExecuteRequestHandlerTest
{
    @Test
    void cleansPreviousLargeValuesBeforeRegisteringNewExecution()
    {
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        RecordingLargeValueStore largeValueStore = new RecordingLargeValueStore();
        QueryExecuteRequestHandler handler = new QueryExecuteRequestHandler(new ResponseWriter(output, codec), codec, new QueryExecutionService(new SingleProviderRegistry(new NoopQueryProvider())),
                new NotificationPublisher(new ResponseWriter(output, codec)), largeValueStore);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "queryengine.execute",
                Map.of("queryExecutionId", "exec-1", "engineId", "fake", "fileId", "file-1", "text", "select 1", "engineState", Map.of()), null, null));

        Assertions.assertEquals(List.of("cleanup:file-1", "register:exec-1:file-1"), largeValueStore.operations);
    }

    private static final class RecordingLargeValueStore implements LargeValueStore
    {
        private final List<String> operations = new ArrayList<>();

        @Override
        public LargeValueWriter create(String queryExecutionId, String logicalType, String contentType)
        {
            StringWriter writer = new StringWriter();
            return new LargeValueWriter()
            {
                @Override
                public Writer writer()
                {
                    return writer;
                }

                @Override
                public Object closeToCell()
                {
                    return writer.toString();
                }
            };
        }

        @Override
        public QueryLargeValueReadResult read(String ref) throws IOException
        {
            return null;
        }

        @Override
        public void registerExecution(String queryExecutionId, String fileId)
        {
            operations.add("register:" + queryExecutionId + ":" + fileId);
        }

        @Override
        public void cleanupFile(String fileId)
        {
            operations.add("cleanup:" + fileId);
        }
    }

    private static final class NoopQueryProvider implements QueryEngineProvider
    {
        @Override
        public String engineId()
        {
            return "fake";
        }

        @Override
        public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
        {
        }

        @Override
        public void cancel(String queryExecutionId)
        {
        }
    }

    private static final class SingleProviderRegistry implements QueryEngineRegistry
    {
        private final QueryEngineProvider provider;

        private SingleProviderRegistry(QueryEngineProvider provider)
        {
            this.provider = provider;
        }

        @Override
        public void register(QueryEngineProvider provider)
        {
        }

        @Override
        public QueryEngineProvider getProvider(String engineId)
        {
            return provider.engineId()
                    .equals(engineId) ? provider
                            : null;
        }
    }
}
