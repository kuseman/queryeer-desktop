package com.queryeer.backend.api;

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
