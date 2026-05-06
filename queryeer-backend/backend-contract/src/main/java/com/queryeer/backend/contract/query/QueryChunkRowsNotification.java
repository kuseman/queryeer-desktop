package com.queryeer.backend.contract.query;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

public record QueryChunkRowsNotification(String queryExecutionId, int resultSetIndex, List<List<Object>> rows, @JsonInclude(JsonInclude.Include.NON_NULL) List<MessagePayload> messages)
{

    public QueryChunkRowsNotification(String queryExecutionId, int resultSetIndex, List<List<Object>> rows)
    {
        this(queryExecutionId, resultSetIndex, rows, null);
    }

    public record MessagePayload(String severity, String message, @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> details)
    {
        public MessagePayload(String severity, String message)
        {
            this(severity, message, null);
        }
    }
}
