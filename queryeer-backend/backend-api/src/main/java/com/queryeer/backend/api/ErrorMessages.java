package com.queryeer.backend.api;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.LinkedHashMap;
import java.util.Map;

public final class ErrorMessages
{
    private ErrorMessages()
    {
    }

    public static String buildFailureMessage(Throwable error)
    {
        StringBuilder message = new StringBuilder();
        appendError(message, error);

        Throwable cause = error.getCause();
        int depth = 0;
        while (cause != null
                && cause != error
                && depth < 4)
        {
            message.append(" | cause: ");
            appendError(message, cause);
            cause = cause.getCause();
            depth++;
        }

        return message.toString();
    }

    public static Map<String, Object> buildErrorDetails(Throwable error)
    {
        Map<String, Object> details = new LinkedHashMap<>();
        if (error == null)
        {
            return details;
        }
        details.put("errorType", error.getClass()
                .getSimpleName());
        if (error.getMessage() != null
                && !error.getMessage()
                        .isBlank())
        {
            details.put("errorMessage", error.getMessage());
        }
        details.put("stackTrace", stackTrace(error));
        return details;
    }

    private static String stackTrace(Throwable error)
    {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        error.printStackTrace(pw);
        pw.flush();
        return sw.toString();
    }

    private static void appendError(StringBuilder builder, Throwable error)
    {
        builder.append(error.getClass()
                .getSimpleName());
        String detail = error.getMessage();
        if (detail != null
                && !detail.isBlank())
        {
            builder.append(": ")
                    .append(detail);
        }
    }
}
