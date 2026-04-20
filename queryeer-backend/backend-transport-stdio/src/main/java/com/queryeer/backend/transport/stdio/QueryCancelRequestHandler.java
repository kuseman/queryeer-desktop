package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryCancelParams;
import com.queryeer.backend.contract.query.QueryCancelResult;

public final class QueryCancelRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final MockQueryExecutionService queryExecutionService;

    public QueryCancelRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, MockQueryExecutionService queryExecutionService)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.queryExecutionService = queryExecutionService;
    }

    @Override
    public String method()
    {
        return "query.cancel";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        QueryCancelParams params = codec.objectMapper()
                .convertValue(envelope.params(), QueryCancelParams.class);

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, new QueryCancelResult(true, params.queryExecutionId()), null));

        queryExecutionService.cancel(params);
    }
}
