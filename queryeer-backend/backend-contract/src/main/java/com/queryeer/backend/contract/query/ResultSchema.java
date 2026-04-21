package com.queryeer.backend.contract.query;

import java.util.List;

public record ResultSchema(List<ColumnDefinition> columns)
{
}
