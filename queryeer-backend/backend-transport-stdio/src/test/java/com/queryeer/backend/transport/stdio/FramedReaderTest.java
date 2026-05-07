package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class FramedReaderTest
{
    @Test
    void readsSingleFrame() throws IOException
    {
        InputStream input = new ByteArrayInputStream(frame("{\"id\":\"1\"}"));
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertEquals("{\"id\":\"1\"}", reader.readFrame());
        Assertions.assertNull(reader.readFrame());
    }

    @Test
    void readsMultipleFrames() throws IOException
    {
        byte[] data = concat(frame("{\"a\":1}"), frame("{\"b\":2}"));
        InputStream input = new ByteArrayInputStream(data);
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertEquals("{\"a\":1}", reader.readFrame());
        Assertions.assertEquals("{\"b\":2}", reader.readFrame());
        Assertions.assertNull(reader.readFrame());
    }

    @Test
    void routesNonFramingLinesToConsoleSink() throws IOException
    {
        List<String> consoled = new ArrayList<>();
        byte[] data = concat("spurious log line\n".getBytes(StandardCharsets.UTF_8), frame("{\"id\":\"1\"}"));
        InputStream input = new ByteArrayInputStream(data);
        FramedReader reader = new FramedReader(input, consoled::add);

        Assertions.assertEquals("{\"id\":\"1\"}", reader.readFrame());
        Assertions.assertEquals(List.of("spurious log line"), consoled);
    }

    @Test
    void handlesLfOnlyLineSeparator() throws IOException
    {
        String json = "{\"x\":1}";
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        byte[] data = concat(("Content-Length: " + body.length + "\n\n").getBytes(StandardCharsets.US_ASCII), body);
        InputStream input = new ByteArrayInputStream(data);
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertEquals(json, reader.readFrame());
    }

    @Test
    void returnsNullOnEmptyStream() throws IOException
    {
        InputStream input = new ByteArrayInputStream(new byte[0]);
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertNull(reader.readFrame());
    }

    @Test
    void handlesMultibyteUtf8Body() throws IOException
    {
        String json = "{\"msg\":\"héllo\"}";
        InputStream input = new ByteArrayInputStream(frame(json));
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertEquals(json, reader.readFrame());
    }

    @Test
    void ignoresSpuriousBlankLinesBeforeHeader() throws IOException
    {
        byte[] data = concat("\r\n".getBytes(StandardCharsets.US_ASCII), frame("{\"id\":\"1\"}"));
        InputStream input = new ByteArrayInputStream(data);
        FramedReader reader = new FramedReader(input, _ ->
        {
        });

        Assertions.assertEquals("{\"id\":\"1\"}", reader.readFrame());
    }

    // --- helpers ---

    private static byte[] frame(String json)
    {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        byte[] header = ("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
        return concat(header, body);
    }

    private static byte[] concat(byte[]... parts)
    {
        int total = 0;
        for (byte[] p : parts)
        {
            total += p.length;
        }
        byte[] result = new byte[total];
        int offset = 0;
        for (byte[] p : parts)
        {
            System.arraycopy(p, 0, result, offset, p.length);
            offset += p.length;
        }
        return result;
    }
}
