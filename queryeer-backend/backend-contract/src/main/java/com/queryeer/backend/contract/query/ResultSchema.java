package com.queryeer.backend.contract.query;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public record ResultSchema(List<ColumnDefinition> columns, Map<String, String> metadata)
{
    public ResultSchema(List<ColumnDefinition> columns)
    {
        this(columns, Collections.emptyMap());
    }
}
