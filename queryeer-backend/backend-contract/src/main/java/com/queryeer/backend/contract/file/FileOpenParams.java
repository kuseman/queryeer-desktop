package com.queryeer.backend.contract.file;

public record FileOpenParams(String fileId, String uri, String mimeType, FileEngineBindingParams engineBinding, String initialText)
{
}
