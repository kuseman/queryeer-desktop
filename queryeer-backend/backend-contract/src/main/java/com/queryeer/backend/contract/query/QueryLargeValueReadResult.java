package com.queryeer.backend.contract.query;

import com.fasterxml.jackson.annotation.JsonInclude;

public record QueryLargeValueReadResult(String ref, String logicalType, long byteLength, String content, @JsonInclude(JsonInclude.Include.NON_NULL) String contentType)
{
}
