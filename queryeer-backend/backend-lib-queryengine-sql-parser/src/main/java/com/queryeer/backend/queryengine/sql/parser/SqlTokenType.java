package com.queryeer.backend.queryengine.sql.parser;

enum SqlTokenType
{
    WORD,
    QUOTED_IDENTIFIER,
    STRING,
    LINE_COMMENT,
    BLOCK_COMMENT,
    DOT,
    COMMA,
    SEMICOLON,
    OPEN_PAREN,
    CLOSE_PAREN,
    OPERATOR,
    OTHER
}
