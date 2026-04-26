package com.queryeer.backend.contract.engine;

public record EngineInvokeParams(String engineId, String fileId, String action, Object payload)
{
}
