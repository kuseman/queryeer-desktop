package com.queryeer.backend.contract.engine;

import java.util.Map;

public record SqlSymbolAtPositionResult(String kind, String name, String fullName, String detail, Map<String, Object> attributes)
{
}
