package com.queryeer.backend.queryengine.sql.parser;

import java.util.Map;

import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.ParseResult;

public final class TreeSitterSqlParseFunction implements IncrementalParseFunction
{
    public static final String LANGUAGE_SQL = "sql";

    @Override
    public ParseResult parse(String languageId, String text, Object previousState)
    {
        try (TSParser parser = new TSParser())
        {
            parser.setLanguage(new TreeSitterSql());
            TSTree oldTree = previousState instanceof TSTree tree ? tree
                    : null;
            TSTree tree = parser.parseString(oldTree, text == null ? ""
                    : text);
            TSNode root = tree.getRootNode();
            boolean hasErrors = root != null
                    && root.hasError();
            Map<String, Object> attributes = Map.of("rootType", root == null ? ""
                    : root.getType());
            return new ParseResult(hasErrors, tree, attributes);
        }
    }
}
