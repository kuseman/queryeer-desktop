package com.queryeer.backend.queryengine.jdbc.execute;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.Reader;
import java.io.Writer;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.URL;
import java.sql.Array;
import java.sql.Blob;
import java.sql.Clob;
import java.sql.Ref;
import java.sql.SQLException;
import java.sql.SQLXML;
import java.sql.Struct;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.OffsetTime;
import java.time.ZonedDateTime;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class AbstractJdbcQueryExecutorTest
{
    private final AbstractJdbcQueryExecutor executor = new AbstractJdbcQueryExecutor()
    {
    };

    @Test
    void null_returnsNull()
    {
        assertNull(executor.mapColumnValue(null, "any"));
    }

    @ParameterizedTest
    @MethodSource("jacksonSafeTypes")
    void jacksonSafeTypes_passThroughUnchanged(Object value)
    {
        assertSame(value, executor.mapColumnValue(value, "any"));
    }

    static List<Object> jacksonSafeTypes()
    {
        return List.of("hello", true, false, (byte) 42, (short) 1, 123, 42L, 3.14f, 2.718d, BigDecimal.valueOf(123.45), BigInteger.valueOf(999), new byte[] { 1, 2, 3 }, new Date(), LocalDate.now(),
                LocalTime.now(), LocalDateTime.now(), OffsetDateTime.now(), OffsetTime.now(), Instant.now(), ZonedDateTime.now(), UUID.randomUUID(), URI.create("http://example.com"), safeUrl());
    }

    private static URL safeUrl()
    {
        try
        {
            return URI.create("http://example.com")
                    .toURL();
        }
        catch (Exception e)
        {
            throw new RuntimeException(e);
        }
    }

    @Test
    void list_passThroughUnchanged()
    {
        List<Object> list = List.of("a", 1, true);
        assertSame(list, executor.mapColumnValue(list, "any"));
    }

    @Test
    void map_passThroughUnchanged()
    {
        Map<Object, Object> map = Map.of("key", "value");
        assertSame(map, executor.mapColumnValue(map, "any"));
    }

    @Test
    void array_passThroughUnchanged()
    {
        int[] primitiveArray = new int[] { 1, 2, 3 };
        assertSame(primitiveArray, executor.mapColumnValue(primitiveArray, "any"));
    }

    @Test
    void unknownType_fallsBackToToString()
    {
        Object unknown = new Object()
        {
            @Override
            public String toString()
            {
                return "custom-value";
            }
        };
        assertEquals("custom-value", executor.mapColumnValue(unknown, "any"));
    }

    @Test
    void jdbcArray_unwrapped() throws Exception
    {
        Object[] expected = new Object[] { "a", 42, null };
        assertEquals(Arrays.asList("a", 42, null), executor.mapColumnValue(new StubArray(expected), "any"));
    }

    @Test
    void jdbcArray_primitive_unwrapped() throws Exception
    {
        int[] expected = new int[] { 1, 2, 3 };
        assertArrayEquals(expected, (int[]) executor.mapColumnValue(new StubArray(expected), "any"));
    }

    @Test
    void jdbcStruct_unwrapped() throws Exception
    {
        Struct struct = new Struct()
        {
            @Override
            public String getSQLTypeName()
            {
                return "my_type";
            }

            @Override
            public Object[] getAttributes()
            {
                return new Object[] { "name", 42 };
            }

            @Override
            public Object[] getAttributes(Map<String, Class<?>> map)
            {
                return new Object[0];
            }
        };
        assertEquals(Map.of("sqlType", "my_type", "attributes", List.of("name", 42)), executor.mapColumnValue(struct, "any"));
    }

    @Test
    void jdbcClob_unwrapped() throws Exception
    {
        Clob clob = new Clob()
        {
            @Override
            public long length()
            {
                return 5L;
            }

            @Override
            public String getSubString(long pos, int length)
            {
                return "hello";
            }

            @Override
            public Reader getCharacterStream()
            {
                return null;
            }

            @Override
            public Reader getCharacterStream(long pos, long length)
            {
                return null;
            }

            @Override
            public InputStream getAsciiStream()
            {
                return null;
            }

            @Override
            public long position(String searchstr, long start)
            {
                return 0;
            }

            @Override
            public long position(Clob searchstr, long start)
            {
                return 0;
            }

            @Override
            public int setString(long pos, String str)
            {
                return 0;
            }

            @Override
            public int setString(long pos, String str, int offset, int len)
            {
                return 0;
            }

            @Override
            public OutputStream setAsciiStream(long pos)
            {
                return null;
            }

            @Override
            public Writer setCharacterStream(long pos)
            {
                return null;
            }

            @Override
            public void truncate(long len)
            {
            }

            @Override
            public void free()
            {
            }
        };
        assertEquals("hello", executor.mapColumnValue(clob, "any"));
    }

    @Test
    void jdbcBlob_unwrapped() throws Exception
    {
        Blob blob = new Blob()
        {
            @Override
            public long length()
            {
                return 3L;
            }

            @Override
            public byte[] getBytes(long pos, int length)
            {
                return new byte[] { 1, 2, 3 };
            }

            @Override
            public InputStream getBinaryStream()
            {
                return null;
            }

            @Override
            public InputStream getBinaryStream(long pos, long length)
            {
                return null;
            }

            @Override
            public long position(byte[] pattern, long start)
            {
                return 0;
            }

            @Override
            public long position(Blob pattern, long start)
            {
                return 0;
            }

            @Override
            public int setBytes(long pos, byte[] bytes)
            {
                return 0;
            }

            @Override
            public int setBytes(long pos, byte[] bytes, int offset, int len)
            {
                return 0;
            }

            @Override
            public OutputStream setBinaryStream(long pos)
            {
                return null;
            }

            @Override
            public void truncate(long len)
            {
            }

            @Override
            public void free()
            {
            }
        };
        assertArrayEquals(new byte[] { 1, 2, 3 }, (byte[]) executor.mapColumnValue(blob, "any"));
    }

    @Test
    void jdbcSQLXML_unwrapped() throws Exception
    {
        SQLXML sqlxml = new SQLXML()
        {
            @Override
            public String getString()
            {
                return "<root/>";
            }

            @Override
            public void setString(String value)
            {
            }

            @Override
            public Writer setCharacterStream()
            {
                return null;
            }

            @Override
            public OutputStream setBinaryStream()
            {
                return null;
            }

            @Override
            public Reader getCharacterStream()
            {
                return null;
            }

            @Override
            public InputStream getBinaryStream()
            {
                return null;
            }

            @Override
            public <T extends javax.xml.transform.Source> T getSource(Class<T> sourceClass)
            {
                return null;
            }

            @Override
            public <T extends javax.xml.transform.Result> T setResult(Class<T> resultClass)
            {
                return null;
            }

            @Override
            public void free()
            {
            }
        };
        assertEquals("<root/>", executor.mapColumnValue(sqlxml, "any"));
    }

    @Test
    void jdbcRef_unwrapped() throws Exception
    {
        Ref ref = new Ref()
        {
            @Override
            public String getBaseTypeName()
            {
                return "ref_type";
            }

            @Override
            public Object getObject()
            {
                return "ref-value";
            }

            @Override
            public Object getObject(Map<String, Class<?>> map)
            {
                return null;
            }

            @Override
            public void setObject(Object value)
            {
            }
        };
        assertEquals("ref-value", executor.mapColumnValue(ref, "any"));
    }

    @Test
    void jdbcRef_withNestedArray_unwrapped() throws Exception
    {
        Ref ref = new Ref()
        {
            @Override
            public String getBaseTypeName()
            {
                return "nested";
            }

            @Override
            public Object getObject()
            {
                return new StubArray(new Object[] { "nested-a", "nested-b" });
            }

            @Override
            public Object getObject(Map<String, Class<?>> map)
            {
                return null;
            }

            @Override
            public void setObject(Object value)
            {
            }
        };
        assertEquals(List.of("nested-a", "nested-b"), executor.mapColumnValue(ref, "any"));
    }

    @Test
    void jdbcType_throwsSQLException_fallsBackToToString()
    {
        Array broken = new StubArray(null)
        {
            @Override
            public Object getArray() throws SQLException
            {
                throw new SQLException("broken");
            }
        };
        assertEquals(broken.toString(), executor.mapColumnValue(broken, "any"));
    }

    @Test
    void dialectCanOverride_mapColumnValue()
    {
        AbstractJdbcQueryExecutor custom = new AbstractJdbcQueryExecutor()
        {
            @Override
            protected Object mapColumnValue(Object value, String columnTypeName)
            {
                if ("custom_type".equals(columnTypeName))
                {
                    return "dialect-handled-" + value;
                }
                return super.mapColumnValue(value, columnTypeName);
            }
        };
        assertEquals("dialect-handled-xyz", custom.mapColumnValue("xyz", "custom_type"));
        assertEquals("dialect-handled-null", custom.mapColumnValue("null", "custom_type"));
        assertSame("hello", custom.mapColumnValue("hello", "varchar"));
    }

    private static class StubArray implements Array
    {
        private final Object arrayValue;

        StubArray(Object arrayValue)
        {
            this.arrayValue = arrayValue;
        }

        @Override
        public String getBaseTypeName()
        {
            return null;
        }

        @Override
        public int getBaseType()
        {
            return 0;
        }

        @Override
        public Object getArray() throws SQLException
        {
            return arrayValue;
        }

        @Override
        public Object getArray(Map<String, Class<?>> map)
        {
            return null;
        }

        @Override
        public Object getArray(long index, int count)
        {
            return null;
        }

        @Override
        public Object getArray(long index, int count, Map<String, Class<?>> map)
        {
            return null;
        }

        @Override
        public java.sql.ResultSet getResultSet()
        {
            return null;
        }

        @Override
        public java.sql.ResultSet getResultSet(Map<String, Class<?>> map)
        {
            return null;
        }

        @Override
        public java.sql.ResultSet getResultSet(long index, int count)
        {
            return null;
        }

        @Override
        public java.sql.ResultSet getResultSet(long index, int count, Map<String, Class<?>> map)
        {
            return null;
        }

        @Override
        public void free()
        {
        }
    }
}
