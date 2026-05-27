package com.queryeer.backend.plugin.jdbc.postgres;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.graph.GraphDocument;
import com.queryeer.backend.contract.graph.GraphEdge;
import com.queryeer.backend.contract.graph.GraphEdgeStyle;
import com.queryeer.backend.contract.graph.GraphLayoutOptions;
import com.queryeer.backend.contract.graph.GraphProperty;
import com.queryeer.backend.contract.graph.GraphPropertyGroup;
import com.queryeer.backend.contract.graph.GraphVertex;
import com.queryeer.backend.contract.graph.GraphVertexOverlay;
import com.queryeer.backend.contract.graph.GraphVertexStyle;

final class PostgresExplainJsonConverter
{
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private PostgresExplainJsonConverter()
    {
    }

    static GraphDocument convert(String json, String graphId)
    {
        try
        {
            JsonNode root = MAPPER.readTree(json);
            if (!root.isArray()
                    || root.isEmpty())
            {
                return errorGraph(graphId, "Empty or invalid EXPLAIN JSON");
            }

            List<GraphVertex> vertices = new ArrayList<>();
            List<EdgeDraft> edgeDrafts = new ArrayList<>();

            for (int i = 0; i < root.size(); i++)
            {
                JsonNode planNode = root.get(i)
                        .get("Plan");
                if (planNode != null)
                {
                    double totalCost = planNode.has("Total Cost") ? planNode.get("Total Cost")
                            .asDouble()
                            : 0D;
                    appendPlanNode(planNode, null, i, totalCost, vertices, edgeDrafts);
                }
            }

            List<GraphEdge> edges = buildEdges(edgeDrafts);
            return new GraphDocument(graphId, "PostgreSQL Query Plan", null, new GraphLayoutOptions("right-left", 110, 80), vertices, edges);
        }
        catch (Exception e)
        {
            return errorGraph(graphId, "Unable to parse EXPLAIN JSON: " + e.getMessage());
        }
    }

    private static GraphDocument errorGraph(String graphId, String message)
    {
        return new GraphDocument(graphId, "PostgreSQL Query Plan Error", message, new GraphLayoutOptions("right-left", 110, 80), List.of(), List.of());
    }

    private static String appendPlanNode(JsonNode planNode, String parentId, int stmtIndex, double totalCost, List<GraphVertex> vertices, List<EdgeDraft> edgeDrafts)
    {
        String nodeType = jsonText(planNode, "Node Type");
        boolean parallel = planNode.has("Parallel Aware")
                && planNode.get("Parallel Aware")
                        .asBoolean();
        double nodeTotalCost = planNode.has("Total Cost") ? planNode.get("Total Cost")
                .asDouble()
                : 0D;

        double ownCost = nodeTotalCost;
        JsonNode plans = planNode.get("Plans");
        if (plans != null
                && plans.isArray())
        {
            for (JsonNode child : plans)
            {
                ownCost -= child.has("Total Cost") ? child.get("Total Cost")
                        .asDouble()
                        : 0D;
            }
        }
        ownCost = Math.max(0D, ownCost);
        double costPercent = totalCost > 0D ? (ownCost / totalCost * 100D)
                : 0D;

        double planRows = planNode.has("Plan Rows") ? planNode.get("Plan Rows")
                .asDouble()
                : 0D;
        List<GraphPropertyGroup> groups = new ArrayList<>();
        addGroup(groups, "operator", "Operator", operatorProperties(planNode, nodeType, parallel));
        addGroup(groups, "estimates", "Estimates", estimateProperties(planNode, nodeTotalCost, planRows, costPercent));
        boolean hasActuals = planNode.has("Actual Total Time");
        Double actualRows = hasActuals
                && planNode.has("Actual Rows")
                        ? planNode.get("Actual Rows")
                                .asDouble()
                        : null;
        Double actualTotalTime = hasActuals ? planNode.get("Actual Total Time")
                .asDouble()
                : null;
        if (hasActuals)
        {
            addGroup(groups, "runtime", "Runtime", runtimeProperties(planNode, actualRows, actualTotalTime));
        }
        addGroup(groups, "object", "Object", objectProperties(planNode));
        addGroup(groups, "output", "Output", outputProperties(planNode));
        addGroup(groups, "predicates", "Predicates", predicateProperties(planNode));
        addGroup(groups, "sortKeys", "Sort keys", sortKeyProperties(planNode));
        addGroup(groups, "groupKeys", "Group keys", groupKeyProperties(planNode));

        List<GraphVertexOverlay> overlays = new ArrayList<>();
        List<GraphProperty> warnProps = warningProperties(planNode, nodeType, costPercent);
        if (!warnProps.isEmpty())
        {
            overlays.add(new GraphVertexOverlay("warnings", "warning", "Warnings", null, null));
            addGroup(groups, "warnings", "Warnings", warnProps);
        }
        if (parallel
                || isParallelCoordinator(nodeType))
        {
            overlays.add(new GraphVertexOverlay("parallel", "parallel", "Parallel", "Operator executed in parallel", null));
        }

        String description = costPercent >= 1D ? "Cost: " + formatPercent(costPercent)
                : null;

        String id = "pg-" + stmtIndex
                    + "-"
                    + (nodeType != null ? nodeType.replaceAll("\\s+", "")
                            : "op")
                    + "-"
                    + vertices.size();
        vertices.add(new GraphVertex(id, nodeType != null ? nodeType
                : "Plan", resolveNodeKind(nodeType), description, operatorHeatStyle(costPercent), groups, overlays, List.of()));

        if (parentId != null)
        {
            edgeDrafts.add(new EdgeDraft(id + "-" + parentId, id, parentId, planRows > 0D ? planRows
                    : null, actualRows));
        }

        if (plans != null
                && plans.isArray())
        {
            for (JsonNode child : plans)
            {
                appendPlanNode(child, id, stmtIndex, totalCost, vertices, edgeDrafts);
            }
        }
        return id;
    }

    private static List<GraphProperty> operatorProperties(JsonNode planNode, String nodeType, boolean parallel)
    {
        List<GraphProperty> props = new ArrayList<>();
        addStringProp(props, "nodeType", "Node type", nodeType, true);
        addBoolProp(props, "parallel", "Parallel", parallel);
        addStringProp(props, "joinType", "Join type", jsonText(planNode, "Join Type"), false);
        addStringProp(props, "strategy", "Strategy", jsonText(planNode, "Strategy"), false);
        addStringProp(props, "subplanName", "Subplan name", jsonText(planNode, "Subplan Name"), false);
        addStringProp(props, "partialMode", "Partial mode", jsonText(planNode, "Partial Mode"), false);
        addBoolProp(props, "asyncCapable", "Async capable", planNode.has("Async Capable")
                && planNode.get("Async Capable")
                        .asBoolean());
        return props;
    }

    private static List<GraphProperty> estimateProperties(JsonNode planNode, double nodeTotalCost, double planRows, double costPercent)
    {
        List<GraphProperty> props = new ArrayList<>();
        addNumProp(props, "startupCost", "Startup cost", jsonNum(planNode, "Startup Cost"), null, false);
        addNumProp(props, "totalCost", "Total cost", nodeTotalCost, null, true);
        addNumProp(props, "planRows", "Plan rows", planRows, null, true);
        addNumProp(props, "planWidth", "Plan width", jsonNum(planNode, "Plan Width"), "bytes", false);
        addNumProp(props, "costPercent", "Estimated operator cost", costPercent, "%", true);
        return props;
    }

    private static List<GraphProperty> runtimeProperties(JsonNode planNode, Double actualRows, Double actualTotalTime)
    {
        List<GraphProperty> props = new ArrayList<>();
        addNumProp(props, "actualRows", "Actual rows", actualRows, null, true);
        addNumProp(props, "actualStartup", "Actual startup", jsonNum(planNode, "Actual Startup Time"), "ms", false);
        addNumProp(props, "actualTotal", "Actual total", actualTotalTime, "ms", true);
        addNumProp(props, "actualLoops", "Actual loops", jsonNum(planNode, "Actual Loops"), null, true);
        return props;
    }

    private static List<GraphProperty> objectProperties(JsonNode planNode)
    {
        List<GraphProperty> props = new ArrayList<>();
        addStringProp(props, "relation", "Relation", jsonText(planNode, "Relation Name"), true);
        addStringProp(props, "schema", "Schema", jsonText(planNode, "Schema"), false);
        addStringProp(props, "alias", "Alias", jsonText(planNode, "Alias"), false);
        addStringProp(props, "indexName", "Index", jsonText(planNode, "Index Name"), true);
        addStringProp(props, "functionName", "Function", jsonText(planNode, "Function Name"), true);
        addStringProp(props, "cteName", "CTE", jsonText(planNode, "CTE Name"), true);
        addStringProp(props, "worktableName", "Worktable", jsonText(planNode, "Worktable Name"), false);
        return props;
    }

    private static List<GraphProperty> outputProperties(JsonNode planNode)
    {
        JsonNode output = planNode.get("Output");
        if (output == null
                || !output.isArray()
                || output.isEmpty())
        {
            return List.of();
        }
        List<GraphProperty> props = new ArrayList<>();
        for (int i = 0; i < output.size(); i++)
        {
            addStringProp(props, "outputColumn-" + (i + 1), "Output column " + (i + 1), output.get(i)
                    .asText(), false);
        }
        return props;
    }

    private static List<GraphProperty> predicateProperties(JsonNode planNode)
    {
        List<GraphProperty> props = new ArrayList<>();
        addStringProp(props, "filter", "Filter", jsonText(planNode, "Filter"), true);
        addStringProp(props, "indexCond", "Index condition", jsonText(planNode, "Index Cond"), true);
        addStringProp(props, "hashCond", "Hash condition", jsonText(planNode, "Hash Cond"), true);
        addStringProp(props, "mergeCond", "Merge condition", jsonText(planNode, "Merge Cond"), true);
        addStringProp(props, "joinFilter", "Join filter", jsonText(planNode, "Join Filter"), true);
        addStringProp(props, "recheckCond", "Recheck condition", jsonText(planNode, "Recheck Cond"), true);
        addStringProp(props, "oneTimeFilter", "One-time filter", jsonText(planNode, "One-Time Filter"), true);
        return props;
    }

    private static List<GraphProperty> sortKeyProperties(JsonNode planNode)
    {
        JsonNode sortKeys = planNode.get("Sort Key");
        if (sortKeys == null
                || !sortKeys.isArray()
                || sortKeys.isEmpty())
        {
            return List.of();
        }
        List<GraphProperty> props = new ArrayList<>();
        for (int i = 0; i < sortKeys.size(); i++)
        {
            addStringProp(props, "sortKey-" + (i + 1), "Sort key " + (i + 1), sortKeys.get(i)
                    .asText(), true);
        }
        return props;
    }

    private static List<GraphProperty> groupKeyProperties(JsonNode planNode)
    {
        JsonNode groupKeys = planNode.get("Group Key");
        if (groupKeys == null)
        {
            return List.of();
        }
        List<GraphProperty> props = new ArrayList<>();
        if (groupKeys.isArray())
        {
            for (int i = 0; i < groupKeys.size(); i++)
            {
                addStringProp(props, "groupKey-" + (i + 1), "Group key " + (i + 1), groupKeys.get(i)
                        .asText(), true);
            }
        }
        else
        {
            addStringProp(props, "groupKey", "Group key", groupKeys.asText(), true);
        }
        return props;
    }

    private static List<GraphProperty> warningProperties(JsonNode planNode, String nodeType, double costPercent)
    {
        List<GraphProperty> props = new ArrayList<>();
        if ("Seq Scan".equals(nodeType)
                && costPercent >= 20D)
        {
            addStringProp(props, "seqScan", "Warning", "Sequential scan accounts for " + formatPercent(costPercent) + " of plan cost — verify index coverage", true);
        }
        return props;
    }

    private static String resolveNodeKind(String nodeType)
    {
        if (nodeType == null)
        {
            return "operator";
        }
        // CSOFF
        return switch (nodeType)
        {
            case "Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan", "Bitmap Index Scan", "CTE Scan", "Function Scan", "Subquery Scan", "Sample Scan", "Tid Scan", "Values Scan", "WorkTable Scan" -> "Scan";
            case "Nested Loop", "Hash Join", "Merge Join" -> "Join";
            case "Sort", "Incremental Sort" -> "Sort";
            case "Aggregate", "GroupAggregate", "HashAggregate", "MixedAggregate" -> "Aggregate";
            case "Hash" -> "Hash";
            case "Gather", "Gather Merge" -> "Parallelism";
            case "Result" -> "Result";
            case "Limit" -> "Limit";
            case "Insert", "Insert on" -> "Insert";
            case "Update", "Update on" -> "Update";
            case "Delete", "Delete on" -> "Delete";
            case "Materialize" -> "Spool";
            case "SetOp", "Append" -> "SetOp";
            default -> "operator";
        };
        // CSON
    }

    private static boolean isParallelCoordinator(String nodeType)
    {
        return "Gather".equals(nodeType)
                || "Gather Merge".equals(nodeType);
    }

    private static List<GraphEdge> buildEdges(List<EdgeDraft> drafts)
    {
        double maxActualRows = drafts.stream()
                .map(EdgeDraft::actualRows)
                .filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue)
                .max()
                .orElse(0D);
        List<GraphEdge> edges = new ArrayList<>();
        for (EdgeDraft draft : drafts)
        {
            List<GraphProperty> rows = new ArrayList<>();
            addNumProp(rows, "planRows", "Plan rows", draft.planRows(), null, true);
            addNumProp(rows, "actualRows", "Actual rows", draft.actualRows(), null, draft.actualRows() != null);
            List<GraphPropertyGroup> groups = rows.isEmpty() ? List.of()
                    : List.of(new GraphPropertyGroup("rows", "Rows", rows));
            Double labelRows = draft.actualRows() != null ? draft.actualRows()
                    : draft.planRows();
            edges.add(new GraphEdge(draft.id(), draft.sourceVertexId(), draft.targetVertexId(), labelRows == null ? null
                    : formatRows(labelRows), "input", new GraphEdgeStyle("smoothstep", "#93c5fd", edgeWidth(draft.actualRows(), maxActualRows), false, "arrow"), groups, List.of()));
        }
        return edges;
    }

    private static double edgeWidth(Double actualRows, double maxActualRows)
    {
        if (actualRows == null
                || maxActualRows <= 0D)
        {
            return 2D;
        }
        double ratio = Math.log10(Math.max(0D, actualRows) + 1D) / Math.log10(maxActualRows + 1D);
        return 1.5D + (ratio * 5.5D);
    }

    private static GraphVertexStyle operatorHeatStyle(Double costPercent)
    {
        if (costPercent == null)
        {
            return new GraphVertexStyle("rounded", null, "#1e3a8a", "#60a5fa", null, null, 210, 86);
        }
        if (costPercent >= 50D)
        {
            return new GraphVertexStyle("rounded", null, "#7f1d1d", "#f87171", null, null, 210, 86);
        }
        if (costPercent >= 20D)
        {
            return new GraphVertexStyle("rounded", null, "#7c2d12", "#fb923c", null, null, 210, 86);
        }
        if (costPercent >= 5D)
        {
            return new GraphVertexStyle("rounded", null, "#713f12", "#facc15", null, null, 210, 86);
        }
        return new GraphVertexStyle("rounded", null, "#1e3a8a", "#60a5fa", null, null, 210, 86);
    }

    // -- Helper methods --

    private static void addGroup(List<GraphPropertyGroup> groups, String id, String label, List<GraphProperty> properties)
    {
        if (!properties.isEmpty())
        {
            groups.add(new GraphPropertyGroup(id, label, properties));
        }
    }

    private static void addStringProp(List<GraphProperty> props, String id, String label, String value, boolean important)
    {
        if (value == null
                || value.isBlank())
        {
            return;
        }
        props.add(new GraphProperty(id, label, value, null, important));
    }

    private static void addNumProp(List<GraphProperty> props, String id, String label, Double value, String unit, boolean important)
    {
        if (value == null)
        {
            return;
        }
        props.add(new GraphProperty(id, label, value, unit, important));
    }

    private static void addBoolProp(List<GraphProperty> props, String id, String label, boolean value)
    {
        if (value)
        {
            props.add(new GraphProperty(id, label, "true", null, true));
        }
    }

    private static String jsonText(JsonNode node, String field)
    {
        if (node == null
                || !node.has(field))
        {
            return null;
        }
        JsonNode value = node.get(field);
        return value.isNull() ? null
                : value.asText();
    }

    private static Double jsonNum(JsonNode node, String field)
    {
        if (node == null
                || !node.has(field)
                || node.get(field)
                        .isNull())
        {
            return null;
        }
        double value = node.get(field)
                .asDouble();
        return Double.isNaN(value) ? null
                : value;
    }

    private static String formatRows(Double value)
    {
        if (value == null)
        {
            return "";
        }
        if (value >= 1_000_000D)
        {
            return String.format(Locale.ROOT, "%.1fM rows", value / 1_000_000D);
        }
        if (value >= 1_000D)
        {
            return String.format(Locale.ROOT, "%.1fK rows", value / 1_000D);
        }
        if (Math.rint(value) == value)
        {
            return String.format(Locale.ROOT, "%.0f rows", value);
        }
        return String.format(Locale.ROOT, "%.2f rows", value);
    }

    private static String formatPercent(Double value)
    {
        if (value == null)
        {
            return "";
        }
        if (value >= 10D
                || Math.rint(value) == value)
        {
            return String.format(Locale.ROOT, "%.0f%%", value);
        }
        if (value >= 1D)
        {
            return String.format(Locale.ROOT, "%.1f%%", value);
        }
        return String.format(Locale.ROOT, "%.2f%%", value);
    }

    private record EdgeDraft(String id, String sourceVertexId, String targetVertexId, Double planRows, Double actualRows)
    {
    }
}
