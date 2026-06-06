package com.queryeer.backend.contract.engine;

import java.util.List;
import java.util.Map;

public record SqlCompletionItem(String label, String kind, String detail, String documentation, String sortText, String filterText, String insertText, String insertTextFormat,
        List<String> commitCharacters, Map<String, Integer> replaceRange, String source)
{
}
