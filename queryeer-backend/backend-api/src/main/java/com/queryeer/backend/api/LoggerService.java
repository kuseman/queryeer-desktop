package com.queryeer.backend.api;

public interface LoggerService
{
    void info(String message);

    void warn(String message);

    void error(String message, Throwable error);
}
