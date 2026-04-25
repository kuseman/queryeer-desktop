package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.contract.query.QueryExecuteResult;

public final class QueryExecuteRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final QueryExecutionService queryExecutionService;

    public QueryExecuteRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, QueryExecutionService queryExecutionService)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.queryExecutionService = queryExecutionService;
    }

    @Override
    public String method()
    {
        return "query.execute";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        QueryExecuteParams params = codec.objectMapper()
                .convertValue(envelope.params(), QueryExecuteParams.class);

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, new QueryExecuteResult(true, params.queryExecutionId()), null));

        queryExecutionService.execute(params);
    }
}
