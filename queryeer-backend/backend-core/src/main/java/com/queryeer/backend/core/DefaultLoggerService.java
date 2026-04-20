package com.queryeer.backend.core;

import java.io.PrintWriter;
import java.io.StringWriter;

import com.queryeer.backend.api.LoggerService;

final class DefaultLoggerService implements LoggerService
{
    @Override
    public void info(String message)
    {
        System.err.println("[INFO] " + message);
    }

    @Override
    public void warn(String message)
    {
        System.err.println("[WARN] " + message);
    }

    @Override
    public void error(String message, Throwable error)
    {
        if (error == null)
        {
            System.err.println("[ERROR] " + message);
            return;
        }

        StringWriter buffer = new StringWriter();
        PrintWriter writer = new PrintWriter(buffer);
        error.printStackTrace(writer);
        writer.flush();
        System.err.println("[ERROR] " + message + "\n" + buffer);
    }
}
