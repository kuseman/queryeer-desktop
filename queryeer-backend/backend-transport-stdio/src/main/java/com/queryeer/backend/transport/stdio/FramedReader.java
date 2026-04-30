package com.queryeer.backend.transport.stdio;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

final class FramedReader
{
    private final InputStream input;
    private final Consumer<String> consoleSink;

    public FramedReader(InputStream input, Consumer<String> consoleSink)
    {
        this.input = input;
        this.consoleSink = consoleSink;
    }

    /** Returns the next frame body as a UTF-8 string, or null on EOF. */
    public String readFrame() throws IOException
    {
        int contentLength = -1;
        while (true)
        {
            String line = readLine();
            if (line == null)
            {
                return null;
            }
            if (line.isEmpty())
            {
                if (contentLength >= 0)
                {
                    return readBytes(contentLength);
                }
                // spurious blank line — keep scanning
            }
            else if (line.startsWith("Content-Length: "))
            {
                contentLength = Integer.parseInt(line.substring(16)
                        .trim());
            }
            else
            {
                consoleSink.accept(line);
            }
        }
    }

    private String readLine() throws IOException
    {
        StringBuilder sb = new StringBuilder();
        int b;
        while ((b = input.read()) != -1)
        {
            if (b == '\n')
            {
                int len = sb.length();
                if (len > 0
                        && sb.charAt(len - 1) == '\r')
                {
                    sb.deleteCharAt(len - 1);
                }
                return sb.toString();
            }
            sb.append((char) b);
        }
        return sb.length() > 0 ? sb.toString()
                : null;
    }

    private String readBytes(int count) throws IOException
    {
        byte[] buf = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = input.read(buf, offset, count - offset);
            if (read == -1)
            {
                throw new IOException("Unexpected EOF reading frame body (expected " + count + " bytes, got " + offset + ")");
            }
            offset += read;
        }
        return new String(buf, StandardCharsets.UTF_8);
    }
}
