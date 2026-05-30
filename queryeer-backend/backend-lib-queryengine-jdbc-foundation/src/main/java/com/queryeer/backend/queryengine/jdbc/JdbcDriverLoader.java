package com.queryeer.backend.queryengine.jdbc;

import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.SQLException;

/**
 * Fail-safe JDBC driver loading helper. Dialects call this during activation to ensure their JDBC driver is registered with {@link DriverManager}.
 *
 * <p>
 * Two-phase loading:
 * <ol>
 * <li>Try {@link Class#forName(String, boolean, ClassLoader)} with {@code initialize=true} — triggers the driver's static initializer which typically calls
 * {@code DriverManager.registerDriver()}.</li>
 * <li>If the static initializer throws, fall back to reflective {@code Driver} instantiation and explicit {@code DriverManager.registerDriver(driver)}.</li>
 * </ol>
 *
 * <p>
 * Returns {@code false} if the driver class is not found, which is normal when the user has not placed the driver JAR in {@code libShared/}.
 * </p>
 */
public final class JdbcDriverLoader
{
    private JdbcDriverLoader()
    {
    }

    /**
     * Loads and registers a JDBC driver using the given classloader.
     *
     * @param driverClassName fully qualified driver class name (e.g. {@code com.microsoft.sqlserver.jdbc.SQLServerDriver})
     * @param classLoader classloader that can resolve the driver class (typically the dialect's own PluginCL)
     * @return {@code true} if the driver was loaded and registered, {@code false} if the driver class was not found
     */
    public static boolean loadDriver(String driverClassName, ClassLoader classLoader)
    {
        try
        {
            Class.forName(driverClassName, true, classLoader);
            return true;
        }
        catch (ClassNotFoundException e)
        {
            return false;
        }
        catch (ExceptionInInitializerError e)
        {
            // static initializer threw — try fallback
        }
        catch (LinkageError e)
        {
            return false;
        }

        try
        {
            Class<?> driverClass = Class.forName(driverClassName, false, classLoader);
            Driver driver = (Driver) driverClass.getDeclaredConstructor()
                    .newInstance();
            DriverManager.registerDriver(driver);
            return true;
        }
        catch (ReflectiveOperationException | SQLException e)
        {
            return false;
        }
    }
}
