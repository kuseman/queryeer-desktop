package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.contract.query.QueryExecuteResult;
import com.queryeer.backend.core.query.QueryExecutionService;

final class QueryExecuteRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final QueryExecutionService queryExecutionService;
    private final NotificationPublisher notificationPublisher;
    private final LargeValueStore largeValueStore;

    public QueryExecuteRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, QueryExecutionService queryExecutionService, NotificationPublisher notificationPublisher,
            LargeValueStore largeValueStore)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.queryExecutionService = queryExecutionService;
        this.notificationPublisher = notificationPublisher;
        this.largeValueStore = largeValueStore;
    }

    @Override
    public String method()
    {
        return "queryengine.execute";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        QueryExecuteParams params = codec.objectMapper()
                .convertValue(envelope.params(), QueryExecuteParams.class);
        largeValueStore.cleanupFile(params.fileId());
        largeValueStore.registerExecution(params.queryExecutionId(), params.fileId());

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new QueryExecuteResult(true, params.queryExecutionId()), null));

        TransportQueryPublisher publisher = new TransportQueryPublisher(params.queryExecutionId(), notificationPublisher);
        queryExecutionService.execute(params.queryExecutionId(), params.engineId(), params.fileId(), params.text(), params.engineState(), params.options(), publisher);
    }
}
