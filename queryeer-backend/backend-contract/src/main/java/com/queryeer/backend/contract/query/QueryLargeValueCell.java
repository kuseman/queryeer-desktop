package com.queryeer.backend.contract.query;

import com.fasterxml.jackson.annotation.JsonInclude;

public record QueryLargeValueCell(String kind, String logicalType, long byteLength, String preview, String ref, @JsonInclude(JsonInclude.Include.NON_NULL) String contentType)
{
    public QueryLargeValueCell(String logicalType, long byteLength, String preview, String ref, String contentType)
    {
        this("largeValue", logicalType, byteLength, preview, ref, contentType);
    }
}
