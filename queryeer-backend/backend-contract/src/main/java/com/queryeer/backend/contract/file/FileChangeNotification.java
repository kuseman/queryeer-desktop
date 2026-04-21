package com.queryeer.backend.contract.file;

public record FileChangeNotification(String fileId, long version, String text)
{
}
