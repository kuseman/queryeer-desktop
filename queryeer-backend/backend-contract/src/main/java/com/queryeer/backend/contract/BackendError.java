package com.queryeer.backend.contract;

import java.util.Map;

public record BackendError(BackendErrorCode code, String message, Map<String, Object> details)
{
}
