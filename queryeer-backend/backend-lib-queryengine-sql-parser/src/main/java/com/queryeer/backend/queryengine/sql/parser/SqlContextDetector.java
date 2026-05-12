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
 * Detects whether the cursor is in a table-reference context (FROM/JOIN clause) or an exclude context (WHERE/ON/binary_expression) using tree-sitter queries with a fallback ancestor walk for
 * error-recovery trees.
 *
 * <h2>Why keyword-specific logic is needed</h2> When SQL is incomplete, tree-sitter creates ERROR nodes containing orphaned keywords. These keywords lose their structural context — a
 * {@code keyword_from} orphaned in ERROR should trigger table suggestions, while a {@code keyword_where} orphaned in ERROR should suppress them. The keyword type IS the context.
 */
public final class SqlContextDetector
{
    /**
     * Single query finding all nodes relevant to context detection. Capture names indicate the semantic group:
     * <ul>
     * <li>{@code clause} — cursor inside a FROM/JOIN clause → TABLE_REFERENCE</li>
     * <li>{@code exclude} — cursor inside WHERE/ON/binary_expression → OTHER</li>
     * </ul>
     */
    private static final TSQuery CONTEXT_QUERY = new TSQuery(new TreeSitterSql(),
            "(from) @clause\n(join) @clause\n(keyword_from) @clause\n(keyword_join) @clause\n" + "(where) @exclude\n(keyword_on) @exclude\n(keyword_where) @exclude\n(binary_expression) @exclude");

    private SqlContextDetector()
    {
    }

    public static SqlCompletionContext detectContext(TSTree tree, int line, int column)
    {
        TSPoint pt = new TSPoint(line - 1, column - 1);

        // Phase 1: TSQuery — efficient for most well-formed and broken SQL
        SqlCompletionContext result = queryContext(tree, pt);
        if (result != null)
        {
            return result;
        }

        // Phase 2: Ancestor-walking fallback — catches edge cases where
        // getNamedDescendantForPointRange returns a covering node the query missed
        TSNode node = tree.getRootNode()
                .getNamedDescendantForPointRange(pt, pt);
        while (node != null
                && !node.isNull())
        {
            String type = node.getType();
            if (isExcludeKeyword(type)
                    || "where".equals(type)
                    || "binary_expression".equals(type))
            {
                return SqlCompletionContext.OTHER;
            }
            if (isTableKeyword(type)
                    || "from".equals(type)
                    || "join".equals(type))
            {
                return SqlCompletionContext.TABLE_REFERENCE;
            }
            node = node.getParent();
        }
        return SqlCompletionContext.OTHER;
    }

    /** Iterates context query matches and checks cursor containment. Exclude wins over clause. */
    private static SqlCompletionContext queryContext(TSTree tree, TSPoint pt)
    {
        TSQueryCursor cursor = new TSQueryCursor();
        cursor.exec(CONTEXT_QUERY, tree.getRootNode());
        TSQueryMatch match = new TSQueryMatch();
        boolean inClause = false;
        while (cursor.nextMatch(match))
        {
            for (TSQueryCapture capture : match.getCaptures())
            {
                TSNode node = capture.getNode();
                int captureIndex = capture.getIndex();
                int captureNameId = CONTEXT_QUERY.getCaptureNameForId(captureIndex)
                        .hashCode();
                boolean isExclude = isExcludeCapture(captureNameId);
                if (containsPoint(node, pt, isExclude))
                {
                    if (isExclude)
                    {
                        return SqlCompletionContext.OTHER;
                    }
                    inClause = true;
                }
            }
        }
        return inClause ? SqlCompletionContext.TABLE_REFERENCE
                : null;
    }

    private static boolean isExcludeCapture(int captureNameHash)
    {
        return captureNameHash == "exclude".hashCode();
    }

    /**
     * Single containment check for all node types. Behavior differs subtly between clause and exclude captures:
     * <ul>
     * <li><b>Exclude:</b> end-exclusive ({@code ptCol >= endCol} → outside). Multi-line nodes only apply exclusion on their starting line.</li>
     * <li><b>Clause:</b> end-inclusive ({@code ptCol > endCol} → outside).</li>
     * <li><b>Both:</b> orphaned keywords (FROM/JOIN/WHERE/ON) use same-line heuristic: cursor anywhere at or after the keyword's start column on the same line is considered inside.</li>
     * </ul>
     */
    private static boolean containsPoint(TSNode node, TSPoint pt, boolean exclude)
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
        // Orphaned keywords lose their ERROR node structural context. Use the
        // keyword type to derive meaning: FROM/JOIN keywords → table context,
        // WHERE/ON keywords → exclude context. Same-line heuristic handles
        // trailing whitespace past the keyword's node end boundary.
        String type = node.getType();
        if (isOrphanedKeyword(type)
                && ptRow == startRow
                && ptRow == endRow)
        {
            return ptCol >= startCol;
        }
        // Multi-line exclude nodes (error recovery artifacts) only apply on
        // their starting line to prevent bleeding across statements.
        if (exclude
                && startRow != endRow
                && ptRow != startRow)
        {
            return false;
        }
        int endCol = end.getColumn();
        // Exclude: end-exclusive. Clause: end-inclusive.
        if (ptRow == endRow
                && (exclude ? ptCol >= endCol
                        : ptCol > endCol))
        {
            return false;
        }
        return true;
    }

    // -- Keyword classifier (single source of truth) --

    /** Keywords that indicate a table-reference context. */
    private static boolean isTableKeyword(String type)
    {
        return "keyword_from".equals(type)
                || "keyword_join".equals(type);
    }

    /** Keywords that indicate a non-table context (WHERE, ON). */
    private static boolean isExcludeKeyword(String type)
    {
        return "keyword_where".equals(type)
                || "keyword_on".equals(type);
    }

    /** Any orphaned keyword that needs same-line heuristic. */
    private static boolean isOrphanedKeyword(String type)
    {
        return isTableKeyword(type)
                || isExcludeKeyword(type);
    }
}
