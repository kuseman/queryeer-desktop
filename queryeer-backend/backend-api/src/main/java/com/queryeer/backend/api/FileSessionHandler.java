package com.queryeer.backend.api;

public interface FileSessionHandler
{
    String engineId();

    default void onOpen(FileSession session, String initialText)
    {
    }

    default void onChange(FileSession session, long version, String text)
    {
    }

    default void onClose(FileSession session)
    {
    }
}
