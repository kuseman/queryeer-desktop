package com.queryeer.backend.contract.engine;

import java.util.List;
import java.util.Map;

public record SqlCompleteResult(List<SqlCompletionItem> items, boolean isIncomplete, Map<String, Object> context)
{
}
