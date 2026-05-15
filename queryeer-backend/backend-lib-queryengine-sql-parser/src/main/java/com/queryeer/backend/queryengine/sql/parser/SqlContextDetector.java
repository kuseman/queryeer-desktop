package com.queryeer.backend.queryengine.sql.parser;

import org.treesitter.TSNode;
import org.treesitter.TSPoint;
import org.treesitter.TSQuery;
import org.treesitter.TSQueryCapture;
import org.treesitter.TSQueryCursor;
import org.treesitter.TSQueryMatch;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

/**
 * Detects whether the cursor is in a table-reference context (FROM/JOIN clause), a column-reference context (SELECT expressions, WHERE/ON/HAVING conditions, GROUP BY, ORDER BY), or an other context
 * using tree-sitter queries with a fallback ancestor walk for error-recovery trees.
 *
 * <h2>Why keyword-specific logic is needed</h2> When SQL is incomplete, tree-sitter creates ERROR nodes containing orphaned keywords. These keywords lose their structural context — a
 * {@code keyword_from} orphaned in ERROR should trigger table suggestions, while a {@code keyword_where} orphaned in ERROR should trigger column suggestions. The keyword type IS the context.
 */
public final class SqlContextDetector
{
    /**
     * Single query finding nodes relevant to context detection. Capture names indicate the semantic group:
     * <ul>
     * <li>{@code clause} — cursor inside a FROM/JOIN clause → TABLE_REFERENCE</li>
     * <li>{@code other} — cursor inside WHERE/ON/HAVING/binary_expression → COLUMN_REFERENCE</li>
     * </ul>
     * {@code @other} wins over {@code @clause} when both match the cursor (checked via early-return logic).
     */
    private static final TSQuery CONTEXT_QUERY = new TSQuery(new TreeSitterSql(), "(from) @clause\n(join) @clause\n(keyword_from) @clause\n(keyword_join) @clause\n"
                                                                                  + "(keyword_where) @other\n(keyword_on) @other\n(keyword_having) @other\n(where) @other\n(binary_expression) @other");

    private static final int HASH_CLAUSE = "clause".hashCode();
    private static final int HASH_OTHER = "other".hashCode();

    private SqlContextDetector()
    {
    }

    public static SqlParseContext detectContext(TSTree tree, int line, int column)
    {
        return detectContext(tree, null, line, column);
    }

    public static SqlParseContext detectContext(TSTree tree, String text, int line, int column)
    {
        TSPoint pt = new TSPoint(line - 1, column - 1);

        SqlParseContext scannedContext = SqlClauseClassifier.classify(text, line, column);
        if (scannedContext != null)
        {
            return scannedContext;
        }

        // Phase 1: TSQuery — efficient for well-formed and broken SQL
        SqlParseContext result = queryContext(tree, pt);
        if (result != null)
        {
            return result;
        }

        // Phase 2: Ancestor-walking fallback — handles edge cases where
        // getNamedDescendantForPointRange returns a covering node the query missed,
        // and orphaned keywords inside ERROR nodes.
        TSNode node = tree.getRootNode()
                .getNamedDescendantForPointRange(pt, pt);
        while (node != null
                && !node.isNull())
        {
            String type = node.getType();
            if (isColumnKeyword(type)
                    || "select".equals(type)
                    || "where".equals(type)
                    || "having".equals(type)
                    || "group_by".equals(type)
                    || "order_by".equals(type)
                    || "on".equals(type)
                    || "binary_expression".equals(type))
            {
                return SqlParseContext.COLUMN_REFERENCE;
            }
            if (isTableKeyword(type)
                    || "from".equals(type)
                    || "join".equals(type))
            {
                return SqlParseContext.TABLE_REFERENCE;
            }
            node = node.getParent();
        }
        return SqlParseContext.OTHER;
    }

    /**
     * Iterates context query matches and checks cursor containment. Keyword-type nodes use the same-line heuristic; structural nodes use strict end-inclusive containment. {@code @other} wins
     * immediately over {@code @clause}.
     */
    private static SqlParseContext queryContext(TSTree tree, TSPoint pt)
    {
        try (TSQueryCursor cursor = new TSQueryCursor())
        {
            cursor.exec(CONTEXT_QUERY, tree.getRootNode());
            TSQueryMatch match = new TSQueryMatch();
            boolean inClause = false;
            while (cursor.nextMatch(match))
            {
                for (TSQueryCapture capture : match.getCaptures())
                {
                    TSNode node = capture.getNode();
                    int captureIndex = capture.getIndex();
                    String type = node.getType();
                    int captureNameId = CONTEXT_QUERY.getCaptureNameForId(captureIndex)
                            .hashCode();
                    // Keyword nodes use same-line heuristic; structural nodes use strict containment
                    boolean contained = isKeywordType(type) ? keywordContains(node, pt)
                            : strictContains(node, pt);
                    if (contained)
                    {
                        if (captureNameId == HASH_OTHER)
                        {
                            return SqlParseContext.COLUMN_REFERENCE;
                        }
                        if (captureNameId == HASH_CLAUSE)
                        {
                            inClause = true;
                        }
                    }
                }
            }
            return inClause ? SqlParseContext.TABLE_REFERENCE
                    : null;
        }
    }

    /** Returns true for single-token keyword nodes that need the same-line heuristic. */
    private static boolean isKeywordType(String type)
    {
        return "keyword_from".equals(type)
                || "keyword_join".equals(type)
                || "keyword_where".equals(type)
                || "keyword_on".equals(type)
                || "keyword_having".equals(type);
    }

    /**
     * Same-line heuristic for orphaned keyword nodes. A cursor within or shortly after the keyword on the same line is considered inside. This handles trailing whitespace past the keyword's end (when
     * a user types "FROM " and the cursor is on the trailing space) without bleeding into distant clauses like GROUP BY, ORDER BY, or HAVING.
     */
    private static boolean keywordContains(TSNode node, TSPoint pt)
    {
        TSPoint start = node.getStartPoint();
        TSPoint end = node.getEndPoint();
        int ptRow = pt.getRow();
        int ptCol = pt.getColumn();
        int startRow = start.getRow();
        int startCol = start.getColumn();
        int endRow = end.getRow();

        if (ptRow < startRow
                || ptRow > endRow)
        {
            return false;
        }
        if (ptRow == startRow
                && ptCol < startCol)
        {
            return false;
        }
        // Same-line heuristic: cursor on the same line as the keyword
        // and within a reasonable window (keyword text + 5 chars for trailing space).
        if (ptRow == startRow
                && ptRow == endRow)
        {
            int endCol = end.getColumn();
            // Require cursor to be within or shortly after the keyword (max 5 chars past end)
            return ptCol >= startCol
                    && ptCol <= endCol + 5;
        }
        // Multi-line keywords: end-inclusive
        if (ptRow == endRow
                && ptCol > end.getColumn())
        {
            return false;
        }
        return true;
    }

    /** End-inclusive point containment using the node's structural range. */
    private static boolean strictContains(TSNode node, TSPoint pt)
    {
        TSPoint start = node.getStartPoint();
        TSPoint end = node.getEndPoint();
        int ptRow = pt.getRow();
        if (ptRow < start.getRow()
                || ptRow > end.getRow())
        {
            return false;
        }
        if (ptRow == start.getRow()
                && pt.getColumn() < start.getColumn())
        {
            return false;
        }
        if (ptRow == end.getRow()
                && pt.getColumn() > end.getColumn())
        {
            return false;
        }
        return true;
    }

    // -- Keyword classifiers --

    /** Keywords that indicate a table-reference context. */
    private static boolean isTableKeyword(String type)
    {
        return "keyword_from".equals(type)
                || "keyword_join".equals(type);
    }

    /** Keywords that indicate a column-reference context (WHERE, ON, HAVING). */
    private static boolean isColumnKeyword(String type)
    {
        return "keyword_where".equals(type)
                || "keyword_on".equals(type)
                || "keyword_having".equals(type);
    }
}
