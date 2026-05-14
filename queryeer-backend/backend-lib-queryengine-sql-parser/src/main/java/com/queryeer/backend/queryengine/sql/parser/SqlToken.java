package com.queryeer.backend.queryengine.sql.parser;

record SqlToken(SqlTokenType type, String text, int startOffset, int endOffset, int line, int column)
{
    boolean significant()
    {
        return type != SqlTokenType.STRING
                && type != SqlTokenType.LINE_COMMENT
                && type != SqlTokenType.BLOCK_COMMENT;
    }

    boolean wordEquals(String value)
    {
        return type == SqlTokenType.WORD
                && text.equalsIgnoreCase(value);
    }
}
