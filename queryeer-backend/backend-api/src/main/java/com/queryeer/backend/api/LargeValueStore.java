package com.queryeer.backend.api;

import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;

import com.queryeer.backend.contract.query.QueryLargeValueReadResult;

public interface LargeValueStore
{
    LargeValueWriter create(String queryExecutionId, String logicalType, String contentType) throws IOException;

    default Object storeText(String queryExecutionId, String logicalType, String contentType, String text)
    {
        LargeValueWriter largeValueWriter = null;
        try
        {
            largeValueWriter = create(queryExecutionId, logicalType, contentType);
            largeValueWriter.writer()
                    .write(text == null ? ""
                            : text);
            return largeValueWriter.closeToCell();
        }
        catch (IOException e)
        {
            abortQuietly(largeValueWriter);
            throw new IllegalStateException("Could not store large value", e);
        }
    }

    private static void abortQuietly(LargeValueWriter largeValueWriter)
    {
        if (largeValueWriter == null)
        {
            return;
        }
        try
        {
            largeValueWriter.abort();
        }
        catch (IOException e)
        {
            // Best-effort cleanup after the original write failure.
        }
    }

    QueryLargeValueReadResult read(String ref) throws IOException;

    void registerExecution(String queryExecutionId, String fileId);

    void cleanupFile(String fileId);

    static LargeValueStore inlineOnly()
    {
        return new LargeValueStore()
        {
            @Override
            public LargeValueWriter create(String queryExecutionId, String logicalType, String contentType)
            {
                StringWriter writer = new StringWriter();
                return new LargeValueWriter()
                {
                    private boolean closed;

                    @Override
                    public Writer writer()
                    {
                        return writer;
                    }

                    @Override
                    public Object closeToCell()
                    {
                        closed = true;
                        return writer.toString();
                    }

                    @Override
                    public void abort()
                    {
                        closed = true;
                    }

                    @Override
                    public void close() throws IOException
                    {
                        if (!closed)
                        {
                            closeToCell();
                        }
                    }
                };
            }

            @Override
            public QueryLargeValueReadResult read(String ref)
            {
                return null;
            }

            @Override
            public void registerExecution(String queryExecutionId, String fileId)
            {
            }

            @Override
            public void cleanupFile(String fileId)
            {
            }
        };
    }
}
