package com.queryeer.backend.core;

import static java.util.Objects.requireNonNull;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetEncoder;
import java.nio.charset.CoderResult;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.api.LargeValueWriter;
import com.queryeer.backend.contract.query.QueryLargeValueCell;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;

public final class DefaultLargeValueStore implements LargeValueStore
{
    private static final String APP_DIR_KEY = "queryeer.app.dir";
    private static final String INLINE_MAX_BYTES_KEY = "queryeer.largeValues.inlineMaxBytes";
    private static final String PREVIEW_MAX_CHARS_KEY = "queryeer.largeValues.previewMaxChars";
    private static final int DEFAULT_INLINE_MAX_BYTES = 16 * 1024;
    private static final int DEFAULT_PREVIEW_MAX_CHARS = 16 * 1024;

    private final Path directory;
    private final int inlineMaxBytes;
    private final int previewMaxChars;
    private final Map<String, Entry> entriesByRef = new ConcurrentHashMap<>();
    private final Map<String, String> fileByExecutionId = new ConcurrentHashMap<>();
    private final Set<String> closedExecutionIds = ConcurrentHashMap.newKeySet();

    public DefaultLargeValueStore(Path directory, int inlineMaxBytes, int previewMaxChars)
    {
        this.directory = requireNonNull(directory, "directory");
        this.inlineMaxBytes = Math.max(1, inlineMaxBytes);
        this.previewMaxChars = Math.max(0, previewMaxChars);
        cleanupDirectory(directory);
    }

    public static DefaultLargeValueStore create(ConfigService config)
    {
        String appDir = config != null ? config.get(APP_DIR_KEY)
                : null;
        Path directory = appDir == null
                || appDir.isBlank() ? Path.of(System.getProperty("java.io.tmpdir"), "queryeer-large-values")
                        : Path.of(appDir.trim(), "large-values");
        return new DefaultLargeValueStore(directory, parsePositiveInt(config, INLINE_MAX_BYTES_KEY, DEFAULT_INLINE_MAX_BYTES),
                parsePositiveInt(config, PREVIEW_MAX_CHARS_KEY, DEFAULT_PREVIEW_MAX_CHARS));
    }

    @Override
    public LargeValueWriter create(String queryExecutionId, String logicalType, String contentType) throws IOException
    {
        return new SpillWriter(queryExecutionId, logicalType, contentType);
    }

    @Override
    public QueryLargeValueReadResult read(String ref) throws IOException
    {
        Entry entry = entriesByRef.get(ref);
        if (entry == null)
        {
            return null;
        }
        String content = Files.readString(entry.path(), StandardCharsets.UTF_8);
        return new QueryLargeValueReadResult(ref, entry.logicalType(), entry.byteLength(), content, entry.contentType());
    }

    @Override
    public void registerExecution(String queryExecutionId, String fileId)
    {
        if (queryExecutionId != null
                && fileId != null)
        {
            closedExecutionIds.remove(queryExecutionId);
            fileByExecutionId.put(queryExecutionId, fileId);
        }
    }

    @Override
    public void cleanupFile(String fileId)
    {
        if (fileId == null)
        {
            return;
        }
        for (Map.Entry<String, String> entry : fileByExecutionId.entrySet())
        {
            if (fileId.equals(entry.getValue()))
            {
                closedExecutionIds.add(entry.getKey());
                fileByExecutionId.remove(entry.getKey());
            }
        }
        for (Map.Entry<String, Entry> entry : entriesByRef.entrySet())
        {
            if (fileId.equals(entry.getValue()
                    .fileId()))
            {
                entriesByRef.remove(entry.getKey());
                deleteQuietly(entry.getValue()
                        .path());
            }
        }
    }

    private static int parsePositiveInt(ConfigService config, String key, int defaultValue)
    {
        if (config == null)
        {
            return defaultValue;
        }
        String raw = config.get(key);
        if (raw == null
                || raw.isBlank())
        {
            return defaultValue;
        }
        try
        {
            int parsed = Integer.parseInt(raw.trim());
            return parsed > 0 ? parsed
                    : defaultValue;
        }
        catch (NumberFormatException e)
        {
            return defaultValue;
        }
    }

    private static void deleteQuietly(Path path)
    {
        try
        {
            Files.deleteIfExists(path);
        }
        catch (IOException e)
        {
            // Best-effort cleanup.
        }
    }

    private static void cleanupDirectory(Path directory)
    {
        if (!Files.exists(directory))
        {
            return;
        }
        try (Stream<Path> paths = Files.walk(directory))
        {
            paths.filter(path -> !directory.equals(path))
                    .sorted(Comparator.reverseOrder())
                    .forEach(DefaultLargeValueStore::deleteQuietly);
        }
        catch (IOException e)
        {
            // Refs are process-local; startup cleanup is best effort for stale spill files.
        }
    }

    private final class SpillWriter extends Writer implements LargeValueWriter
    {
        private static final int ENCODE_BUFFER_BYTES = 16 * 1024;
        private static final int SPILL_BUFFER_BYTES = 64 * 1024;

        private final String queryExecutionId;
        private final String logicalType;
        private final String contentType;
        private final String ref = UUID.randomUUID()
                .toString();
        private final StringBuilder preview = new StringBuilder(Math.min(previewMaxChars, 1024));
        private final ByteArrayOutputStream inline = new ByteArrayOutputStream(Math.min(inlineMaxBytes, 8192));

        private OutputStream spillOutput;
        private Path spillPath;
        private CharsetEncoder encoder;
        private ByteBuffer encodeBuffer;
        private long byteLength;
        private boolean closed;
        private Object cell;

        SpillWriter(String queryExecutionId, String logicalType, String contentType)
        {
            this.queryExecutionId = requireNonNull(queryExecutionId, "queryExecutionId");
            this.logicalType = logicalType == null
                    || logicalType.isBlank() ? "text"
                            : logicalType;
            this.contentType = contentType;
        }

        @Override
        public Writer writer()
        {
            return this;
        }

        @Override
        public void write(char[] cbuf, int off, int len) throws IOException
        {
            if (cbuf == null)
            {
                return;
            }
            ensureOpen();
            appendPreview(cbuf, off, len);
            writeEncoded(CharBuffer.wrap(cbuf, off, len));
        }

        @Override
        public void write(String str, int off, int len) throws IOException
        {
            if (str == null
                    || len <= 0)
            {
                return;
            }
            ensureOpen();
            appendPreview(str, off, len);
            writeEncoded(CharBuffer.wrap(str, off, off + len));
        }

        @Override
        public void write(String str) throws IOException
        {
            if (str == null
                    || str.isEmpty())
            {
                return;
            }
            write(str, 0, str.length());
        }

        @Override
        public void flush() throws IOException
        {
            if (spillOutput != null)
            {
                spillOutput.flush();
            }
        }

        @Override
        public void close() throws IOException
        {
            closeToCell();
        }

        @Override
        public Object closeToCell() throws IOException
        {
            if (closed)
            {
                return cell;
            }
            finishEncoding();
            closed = true;
            if (spillOutput != null)
            {
                spillOutput.close();
                String fileId = fileByExecutionId.get(queryExecutionId);
                if (fileId == null
                        || closedExecutionIds.contains(queryExecutionId))
                {
                    closedExecutionIds.remove(queryExecutionId);
                    deleteQuietly(spillPath);
                    cell = preview.toString();
                }
                else
                {
                    entriesByRef.put(ref, new Entry(queryExecutionId, fileId, spillPath, logicalType, contentType, byteLength));
                    cell = new QueryLargeValueCell(logicalType, byteLength, preview.toString(), ref, contentType);
                }
            }
            else
            {
                cell = inline.toString(StandardCharsets.UTF_8);
            }
            return cell;
        }

        @Override
        public void abort() throws IOException
        {
            if (closed)
            {
                return;
            }
            closed = true;
            if (spillOutput != null)
            {
                try
                {
                    spillOutput.close();
                }
                finally
                {
                    deleteQuietly(spillPath);
                }
            }
        }

        private void ensureOpen() throws IOException
        {
            if (closed)
            {
                throw new IOException("large value writer is closed");
            }
        }

        private void appendPreview(CharSequence text, int off, int len)
        {
            if (preview.length() >= previewMaxChars)
            {
                return;
            }
            int remaining = previewMaxChars - preview.length();
            preview.append(text, off, off + Math.min(remaining, len));
        }

        private void appendPreview(char[] text, int off, int len)
        {
            if (preview.length() >= previewMaxChars)
            {
                return;
            }
            int remaining = previewMaxChars - preview.length();
            preview.append(text, off, Math.min(remaining, len));
        }

        private void writeEncoded(CharBuffer chars) throws IOException
        {
            if (!chars.hasRemaining())
            {
                return;
            }
            CharsetEncoder currentEncoder = encoder();
            ByteBuffer buffer = encodeBuffer();
            while (true)
            {
                CoderResult result = currentEncoder.encode(chars, buffer, false);
                flushEncodeBuffer();
                if (result.isOverflow())
                {
                    continue;
                }
                if (result.isUnderflow())
                {
                    return;
                }
                result.throwException();
            }
        }

        private void finishEncoding() throws IOException
        {
            if (encoder == null)
            {
                return;
            }
            ByteBuffer buffer = encodeBuffer();
            CharBuffer empty = CharBuffer.wrap("");
            while (true)
            {
                CoderResult result = encoder.encode(empty, buffer, true);
                flushEncodeBuffer();
                if (result.isOverflow())
                {
                    continue;
                }
                if (result.isUnderflow())
                {
                    break;
                }
                result.throwException();
            }
            while (true)
            {
                CoderResult result = encoder.flush(buffer);
                flushEncodeBuffer();
                if (result.isOverflow())
                {
                    continue;
                }
                if (result.isUnderflow())
                {
                    return;
                }
                result.throwException();
            }
        }

        private CharsetEncoder encoder()
        {
            if (encoder == null)
            {
                encoder = StandardCharsets.UTF_8.newEncoder()
                        .onMalformedInput(CodingErrorAction.REPLACE)
                        .onUnmappableCharacter(CodingErrorAction.REPLACE);
            }
            return encoder;
        }

        private ByteBuffer encodeBuffer()
        {
            if (encodeBuffer == null)
            {
                encodeBuffer = ByteBuffer.allocate(ENCODE_BUFFER_BYTES);
            }
            return encodeBuffer;
        }

        private void flushEncodeBuffer() throws IOException
        {
            if (encodeBuffer == null)
            {
                return;
            }
            encodeBuffer.flip();
            int length = encodeBuffer.remaining();
            if (length > 0)
            {
                writeBytes(encodeBuffer.array(), encodeBuffer.arrayOffset() + encodeBuffer.position(), length);
            }
            encodeBuffer.clear();
        }

        private void writeBytes(byte[] bytes, int off, int len) throws IOException
        {
            byteLength += len;
            if (spillOutput == null
                    && inline.size() + len <= inlineMaxBytes)
            {
                inline.write(bytes, off, len);
                return;
            }
            ensureSpillOutput();
            spillOutput.write(bytes, off, len);
        }

        private void ensureSpillOutput() throws IOException
        {
            if (spillOutput != null)
            {
                return;
            }
            Files.createDirectories(directory);
            spillPath = Files.createTempFile(directory, "large-value-", ".txt");
            spillOutput = new BufferedOutputStream(Files.newOutputStream(spillPath), SPILL_BUFFER_BYTES);
            inline.writeTo(spillOutput);
            inline.reset();
        }
    }

    private record Entry(String queryExecutionId, String fileId, Path path, String logicalType, String contentType, long byteLength)
    {
    }
}
