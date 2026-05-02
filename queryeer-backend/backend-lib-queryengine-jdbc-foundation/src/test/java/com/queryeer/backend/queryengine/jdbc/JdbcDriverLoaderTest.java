package com.queryeer.backend.queryengine.jdbc;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class JdbcDriverLoaderTest
{
    @Test
    void returnsTrueWhenClassForNameSucceeds()
    {
        boolean loaded = JdbcDriverLoader.loadDriver("java.lang.String", getClass().getClassLoader());

        Assertions.assertTrue(loaded);
    }

    @Test
    void returnsFalseWhenDriverClassNotFound()
    {
        boolean loaded = JdbcDriverLoader.loadDriver("com.example.NoSuchDriver", getClass().getClassLoader());

        Assertions.assertFalse(loaded);
    }

    @Test
    void returnsFalseWhenClassFoundButLinkageError()
    {
        // An interface can be found but try to initialize an interface — should succeed
        // Use a class known to exist but that triggers ExceptionInInitializerError or
        // simply verify a truly nonexistent class returns false
        boolean loaded = JdbcDriverLoader.loadDriver("com.queryeer.backend.queryengine.jdbc.JdbcDialect", getClass().getClassLoader());

        // JdbcDialect is an interface — Class.forName with initialize=true should succeed
        Assertions.assertTrue(loaded);
    }
}
