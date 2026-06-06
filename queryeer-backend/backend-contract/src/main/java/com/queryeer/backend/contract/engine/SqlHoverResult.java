package com.queryeer.backend.contract.engine;

import java.util.List;

public record SqlHoverResult(List<SqlHoverMarkdownContent> contents, String context, String token)
{
    public record SqlHoverMarkdownContent(String value, Boolean isTrusted)
    {
    }
}
