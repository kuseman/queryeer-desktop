package com.queryeer.backend.contract.file;

public record FileBindParams(String fileId, String engineId, String connectionId, String uri, String mimeType)
{
}
