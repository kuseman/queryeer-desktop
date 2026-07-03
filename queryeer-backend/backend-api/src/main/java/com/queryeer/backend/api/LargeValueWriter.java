package com.queryeer.backend.api;

import java.io.IOException;
import java.io.Writer;

public interface LargeValueWriter extends AutoCloseable
{
    Writer writer();

    Object closeToCell() throws IOException;

    default void abort() throws IOException
    {
        close();
    }

    @Override
    default void close() throws IOException
    {
        closeToCell();
    }
}
