package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.io.StringReader;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import com.queryeer.backend.contract.graph.GraphDocument;
import com.queryeer.backend.contract.graph.GraphEdge;
import com.queryeer.backend.contract.graph.GraphEdgeStyle;
import com.queryeer.backend.contract.graph.GraphLayoutOptions;
import com.queryeer.backend.contract.graph.GraphProperty;
import com.queryeer.backend.contract.graph.GraphPropertyGroup;
import com.queryeer.backend.contract.graph.GraphVertex;
import com.queryeer.backend.contract.graph.GraphVertexOverlay;
import com.queryeer.backend.contract.graph.GraphVertexStyle;

final class SqlServerShowPlanGraphConverter
{
    private static final String SHOWPLAN_NAMESPACE = "http://schemas.microsoft.com/sqlserver/2004/07/showplan";

    private SqlServerShowPlanGraphConverter()
    {
    }

    static boolean isShowPlanXml(String value)
    {
        return value != null
                && value.contains("<ShowPlanXML")
                && value.contains(SHOWPLAN_NAMESPACE);
    }

    static GraphDocument convert(String xml, String graphId)
    {
        try
        {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            Document document = factory.newDocumentBuilder()
                    .parse(new InputSource(new StringReader(xml)));
            List<GraphVertex> vertices = new ArrayList<>();
            List<EdgeDraft> edgeDrafts = new ArrayList<>();
            List<SpoolTargetDraft> spoolTargetDrafts = new ArrayList<>();
            Element rootRelOp = firstElement(document.getDocumentElement(), "RelOp");
            if (rootRelOp != null)
            {
                appendRelOp(rootRelOp, null, true, numberAttr(rootRelOp, "EstimatedTotalSubtreeCost"), missingIndexProperties(document), vertices, edgeDrafts, spoolTargetDrafts);
            }
            List<GraphEdge> edges = buildEdges(edgeDrafts);
            edges.addAll(buildSpoolTargetEdges(spoolTargetDrafts, vertices));
            return new GraphDocument(graphId, "SQL Server Query Plan", null, new GraphLayoutOptions("right-left", 110, 80), vertices, edges);
        }
        catch (Exception e)
        {
            return new GraphDocument(graphId, "SQL Server Query Plan", "Unable to parse ShowPlan XML: " + e.getMessage(), new GraphLayoutOptions("right-left", 110, 80), List.of(), List.of());
        }
    }

    private static String appendRelOp(Element relOp, String parentId, boolean root, Double planCost, List<GraphProperty> missingIndexProperties, List<GraphVertex> vertices, List<EdgeDraft> edges,
            List<SpoolTargetDraft> spoolTargets)
    {
        final String nodeId = attr(relOp, "NodeId");
        final String id = nodeId.isBlank() ? "relop-" + vertices.size()
                : "relop-" + nodeId;
        final String physicalOp = attr(relOp, "PhysicalOp");
        final String logicalOp = attr(relOp, "LogicalOp");
        final Double estimateRows = numberAttr(relOp, "EstimateRows");
        final Double estimatedCost = numberAttr(relOp, "EstimatedTotalSubtreeCost");
        final Double estimatedCostPercent = estimatedCostPercent(estimatedOperatorCost(relOp, estimatedCost), planCost);
        final Double actualRows = runtimeCounterSum(relOp, "ActualRows");
        final boolean parallel = booleanAttr(relOp, "Parallel");
        final String targetNodeId = firstAttributeWithinRelOp(relOp, List.of("TargetNodeId", "TargetNodeID", "PrimaryNodeId", "PrimaryNodeID"));
        final List<String> warnings = warningSummaries(relOp);
        if (root
                && !missingIndexProperties.isEmpty())
        {
            warnings.add("Missing index recommendation");
        }

        List<GraphPropertyGroup> groups = new ArrayList<>();
        addGroup(groups, "operator", "Operator", operatorProperties(relOp, physicalOp, logicalOp, parallel, targetNodeId));
        addGroup(groups, "estimates", "Estimates", estimateProperties(relOp, estimateRows, estimatedCost, estimatedCostPercent));
        addGroup(groups, "runtime", "Runtime", runtimeProperties(relOp, actualRows));
        addGroup(groups, "object", "Object", objectProperties(relOp));
        addGroup(groups, "columns", "Columns", columnProperties(relOp));
        addGroup(groups, "predicates", "Predicates", predicateProperties(relOp));
        if (root)
        {
            addGroup(groups, "missingIndexes", "Missing indexes", missingIndexProperties);
        }
        addGroup(groups, "warnings", "Warnings", warningProperties(warnings));

        List<GraphVertexOverlay> overlays = new ArrayList<>();
        if (parallel)
        {
            overlays.add(new GraphVertexOverlay("parallel", "parallel", "Parallel", "Operator executed in parallel", null));
        }
        if (!warnings.isEmpty())
        {
            overlays.add(new GraphVertexOverlay("warnings", "warning", "Warnings", String.join("; ", warnings), null));
        }

        vertices.add(new GraphVertex(id, physicalOp.isBlank() ? "RelOp"
                : physicalOp,
                logicalOp.isBlank() ? "operator"
                        : logicalOp,
                estimatedCostPercent == null ? null
                        : "Cost: " + formatPercent(estimatedCostPercent),
                operatorHeatStyle(estimatedCostPercent), groups, overlays, List.of()));
        if (parentId != null)
        {
            edges.add(new EdgeDraft(id + "-" + parentId, id, parentId, estimateRows, actualRows));
        }
        if (!targetNodeId.isBlank())
        {
            spoolTargets.add(new SpoolTargetDraft("spool-target-" + id + "-relop-" + targetNodeId, id, "relop-" + targetNodeId, targetNodeId));
        }

        for (Element child : directChildRelOps(relOp))
        {
            appendRelOp(child, id, false, planCost, List.of(), vertices, edges, spoolTargets);
        }
        return id;
    }

    private static Double estimatedOperatorCost(Element relOp, Double estimatedCost)
    {
        if (estimatedCost == null)
        {
            return null;
        }
        double childCost = directChildRelOps(relOp).stream()
                .map(child -> numberAttr(child, "EstimatedTotalSubtreeCost"))
                .filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue)
                .sum();
        return Math.max(0D, estimatedCost - childCost);
    }

    private static Double estimatedCostPercent(Double operatorCost, Double planCost)
    {
        if (operatorCost == null
                || planCost == null
                || planCost <= 0D)
        {
            return null;
        }
        return operatorCost / planCost * 100D;
    }

    private static GraphVertexStyle operatorHeatStyle(Double estimatedCostPercent)
    {
        if (estimatedCostPercent == null)
        {
            return new GraphVertexStyle("rounded", null, "#1e3a8a", "#60a5fa", null, null, 210, 86);
        }
        if (estimatedCostPercent >= 50D)
        {
            return new GraphVertexStyle("rounded", null, "#7f1d1d", "#f87171", null, null, 210, 86);
        }
        if (estimatedCostPercent >= 20D)
        {
            return new GraphVertexStyle("rounded", null, "#7c2d12", "#fb923c", null, null, 210, 86);
        }
        if (estimatedCostPercent >= 5D)
        {
            return new GraphVertexStyle("rounded", null, "#713f12", "#facc15", null, null, 210, 86);
        }
        return new GraphVertexStyle("rounded", null, "#1e3a8a", "#60a5fa", null, null, 210, 86);
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
            addNumberProperty(rows, "estimatedRows", "Estimated rows", draft.estimatedRows(), null, true);
            addNumberProperty(rows, "actualRows", "Actual rows", draft.actualRows(), null, draft.actualRows() != null);
            List<GraphPropertyGroup> groups = rows.isEmpty() ? List.of()
                    : List.of(new GraphPropertyGroup("rows", "Rows", rows));
            Double labelRows = draft.actualRows() != null ? draft.actualRows()
                    : draft.estimatedRows();
            edges.add(new GraphEdge(draft.id(), draft.sourceVertexId(), draft.targetVertexId(), labelRows == null ? null
                    : formatRows(labelRows), "input", new GraphEdgeStyle("smoothstep", "#93c5fd", edgeWidth(draft.actualRows(), maxActualRows), false, "arrow"), groups, List.of()));
        }
        return edges;
    }

    private static List<GraphEdge> buildSpoolTargetEdges(List<SpoolTargetDraft> drafts, List<GraphVertex> vertices)
    {
        Set<String> vertexIds = new HashSet<>();
        for (GraphVertex vertex : vertices)
        {
            vertexIds.add(vertex.id());
        }
        List<GraphEdge> edges = new ArrayList<>();
        for (SpoolTargetDraft draft : drafts)
        {
            if (!vertexIds.contains(draft.sourceVertexId())
                    || !vertexIds.contains(draft.targetVertexId()))
            {
                continue;
            }
            List<GraphPropertyGroup> groups = List.of(new GraphPropertyGroup("spool", "Spool", List.of(new GraphProperty("targetNodeId", "Target node ID", draft.targetNodeId(), null, true))));
            edges.add(new GraphEdge(draft.id(), draft.sourceVertexId(), draft.targetVertexId(), "spool target", "spool target", new GraphEdgeStyle("smoothstep", "#f59e0b", 2D, true, "arrow"), groups,
                    List.of()));
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

    private static List<GraphProperty> operatorProperties(Element relOp, String physicalOp, String logicalOp, boolean parallel, String targetNodeId)
    {
        List<GraphProperty> properties = new ArrayList<>();
        addStringProperty(properties, "nodeId", "Node ID", attr(relOp, "NodeId"), null, false);
        addStringProperty(properties, "targetNodeId", "Target node ID", targetNodeId, null, true);
        addStringProperty(properties, "physical", "Physical", physicalOp, null, true);
        addStringProperty(properties, "logical", "Logical", logicalOp, null, true);
        addStringProperty(properties, "parallel", "Parallel", Boolean.toString(parallel), null, parallel);
        return properties;
    }

    private static List<GraphProperty> estimateProperties(Element relOp, Double estimateRows, Double estimatedCost, Double estimatedCostPercent)
    {
        List<GraphProperty> properties = new ArrayList<>();
        addNumberProperty(properties, "estimatedRows", "Estimated rows", estimateRows, null, true);
        addNumberProperty(properties, "estimatedExecutions", "Estimated executions", numberAttr(relOp, "EstimateExecutions"), null, false);
        addNumberProperty(properties, "estimatedCost", "Estimated subtree cost", estimatedCost, null, true);
        addNumberProperty(properties, "estimatedCostPercent", "Estimated operator cost", estimatedCostPercent, "%", true);
        addNumberProperty(properties, "estimatedCpu", "Estimated CPU", numberAttr(relOp, "EstimateCPU"), null, false);
        addNumberProperty(properties, "estimatedIo", "Estimated IO", numberAttr(relOp, "EstimateIO"), null, false);
        addNumberProperty(properties, "avgRowSize", "Average row size", numberAttr(relOp, "AvgRowSize"), "bytes", false);
        return properties;
    }

    private static List<GraphProperty> runtimeProperties(Element relOp, Double actualRows)
    {
        List<GraphProperty> properties = new ArrayList<>();
        final List<Element> counters = runtimeCounters(relOp);
        addNumberProperty(properties, "actualRows", "Actual rows", actualRows, null, actualRows != null);
        addNumberProperty(properties, "actualExecutions", "Actual executions", runtimeCounterSum(relOp, "ActualExecutions"), null, false);
        addNumberProperty(properties, "actualRowsRead", "Actual rows read", runtimeCounterSum(relOp, "ActualRowsRead"), null, false);
        addNumberProperty(properties, "actualEndOfScans", "Actual end of scans", runtimeCounterSum(relOp, "ActualEndOfScans"), null, false);
        addNumberProperty(properties, "actualRebinds", "Actual rebinds", runtimeCounterSum(relOp, "ActualRebinds"), null, false);
        addNumberProperty(properties, "actualRewinds", "Actual rewinds", runtimeCounterSum(relOp, "ActualRewinds"), null, false);
        addNumberProperty(properties, "actualElapsedMs", "Actual elapsed", runtimeCounterSum(relOp, "ActualElapsedms"), "ms", false);
        addNumberProperty(properties, "actualCpuMs", "Actual CPU", runtimeCounterSum(relOp, "ActualCPUms"), "ms", false);
        addNumberProperty(properties, "runtimeThreadCount", "Runtime threads", counters.isEmpty() ? null
                : (double) counters.size(), null, counters.size() > 1);
        for (Element counter : counters)
        {
            addRuntimeCounterProperties(properties, counter);
        }
        return properties;
    }

    private static void addRuntimeCounterProperties(List<GraphProperty> properties, Element counter)
    {
        String thread = attr(counter, "Thread");
        String threadId = thread.isBlank() ? Integer.toString(properties.size())
                : thread;
        String labelPrefix = thread.isBlank() ? "Runtime counter"
                : "Runtime thread " + thread;
        NamedNodeMap attributes = counter.getAttributes();
        for (int i = 0; i < attributes.getLength(); i++)
        {
            Node attribute = attributes.item(i);
            String name = attribute.getNodeName();
            if ("Thread".equals(name))
            {
                continue;
            }
            String id = "runtimeThread-" + threadId + "-" + name;
            String label = labelPrefix + " " + runtimeCounterAttributeLabel(name);
            String unit = name.endsWith("ms") ? "ms"
                    : null;
            Double number = parseDouble(attribute.getNodeValue());
            if (number != null)
            {
                addNumberProperty(properties, id, label, number, unit, false);
            }
            else
            {
                addStringProperty(properties, id, label, attribute.getNodeValue(), unit, false);
            }
        }
    }

    private static String runtimeCounterAttributeLabel(String name)
    {
        return switch (name)
        {
            case "ActualRows" -> "actual rows";
            case "ActualExecutions" -> "actual executions";
            case "ActualRowsRead" -> "actual rows read";
            case "ActualEndOfScans" -> "actual end of scans";
            case "ActualRebinds" -> "actual rebinds";
            case "ActualRewinds" -> "actual rewinds";
            case "ActualElapsedms" -> "actual elapsed";
            case "ActualCPUms" -> "actual CPU";
            default -> name;
        };
    }

    private static List<GraphProperty> objectProperties(Element relOp)
    {
        Element object = firstDescendant(relOp, "Object");
        if (object == null)
        {
            return List.of();
        }
        List<GraphProperty> properties = new ArrayList<>();
        addStringProperty(properties, "database", "Database", trimBrackets(attr(object, "Database")), null, false);
        addStringProperty(properties, "schema", "Schema", trimBrackets(attr(object, "Schema")), null, false);
        addStringProperty(properties, "table", "Table", trimBrackets(attr(object, "Table")), null, true);
        addStringProperty(properties, "index", "Index", trimBrackets(attr(object, "Index")), null, true);
        addStringProperty(properties, "alias", "Alias", attr(object, "Alias"), null, false);
        return properties;
    }

    private static List<GraphProperty> predicateProperties(Element relOp)
    {
        List<GraphProperty> properties = new ArrayList<>();
        addElementText(properties, "predicate", "Predicate", firstDescendantWithinRelOp(relOp, "Predicate"));
        addElementText(properties, "seekPredicates", "Seek predicates", firstDescendantWithinRelOp(relOp, "SeekPredicates"));
        addElementText(properties, "probeColumn", "Probe column", firstDescendantWithinRelOp(relOp, "ProbeColumn"));
        return properties;
    }

    private static List<GraphProperty> columnProperties(Element relOp)
    {
        List<GraphProperty> properties = new ArrayList<>();
        Element outputList = firstDescendantWithinRelOp(relOp, "OutputList");
        if (outputList != null)
        {
            addStringProperties(properties, "outputColumn", "Output column", columnReferences(outputList), false);
        }

        List<String> definedValues = new ArrayList<>();
        for (Element definedValue : descendantsWithinRelOp(relOp, "DefinedValue"))
        {
            String value = definedValueSummary(definedValue);
            if (!value.isBlank())
            {
                definedValues.add(value);
            }
        }
        addStringProperties(properties, "definedValue", "Defined value", definedValues, false);
        return properties;
    }

    private static String definedValueSummary(Element definedValue)
    {
        List<String> columns = columnReferences(definedValue);
        String target = columns.isEmpty() ? ""
                : columns.getFirst();
        Element scalar = firstDescendant(definedValue, "ScalarOperator");
        String expression = scalar == null ? compactText(definedValue.getTextContent())
                : attr(scalar, "ScalarString");
        if (target.isBlank())
        {
            return expression;
        }
        if (expression.isBlank())
        {
            return target;
        }
        return target + " = " + expression;
    }

    private static List<String> columnReferences(Element root)
    {
        List<String> columns = new ArrayList<>();
        NodeList nodes = root.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, "ColumnReference");
        for (int i = 0; i < nodes.getLength(); i++)
        {
            String column = columnReference((Element) nodes.item(i));
            if (!column.isBlank())
            {
                columns.add(column);
            }
        }
        return columns;
    }

    private static String columnReference(Element column)
    {
        List<String> parts = new ArrayList<>();
        for (String attribute : List.of("Database", "Schema", "Table", "Column"))
        {
            String value = trimBrackets(attr(column, attribute));
            if (!value.isBlank())
            {
                parts.add(value);
            }
        }
        return String.join(".", parts);
    }

    private static List<GraphProperty> warningProperties(List<String> warnings)
    {
        List<GraphProperty> properties = new ArrayList<>();
        for (int i = 0; i < warnings.size(); i++)
        {
            addStringProperty(properties, "warning-" + i, "Warning", warnings.get(i), null, true);
        }
        return properties;
    }

    private static List<Element> directChildRelOps(Element relOp)
    {
        List<Element> result = new ArrayList<>();
        NodeList children = relOp.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element element)
            {
                collectImmediateNestedRelOps(element, result);
            }
        }
        return result;
    }

    private static void collectImmediateNestedRelOps(Element element, List<Element> result)
    {
        NodeList children = element.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element childElement)
            {
                if ("RelOp".equals(childElement.getLocalName()))
                {
                    result.add(childElement);
                }
                else
                {
                    collectImmediateNestedRelOps(childElement, result);
                }
            }
        }
    }

    private static Element firstElement(Element root, String localName)
    {
        if (root == null)
        {
            return null;
        }
        if (localName.equals(root.getLocalName()))
        {
            return root;
        }
        NodeList matches = root.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, localName);
        return matches.getLength() == 0 ? null
                : (Element) matches.item(0);
    }

    private static Double runtimeCounterSum(Element relOp, String name)
    {
        List<Element> counters = runtimeCounters(relOp);
        Double sum = null;
        for (Element counter : counters)
        {
            Double value = parseDouble(attr(counter, name));
            if (value != null)
            {
                sum = (sum == null ? 0D
                        : sum) + value;
            }
        }
        return sum;
    }

    private static List<Element> runtimeCounters(Element relOp)
    {
        List<Element> counters = new ArrayList<>();
        for (Element runtimeInfo : directChildElements(relOp, "RunTimeInformation"))
        {
            counters.addAll(directChildElements(runtimeInfo, "RunTimeCountersPerThread"));
        }
        return counters;
    }

    private static List<GraphProperty> missingIndexProperties(Document document)
    {
        List<GraphProperty> properties = new ArrayList<>();
        NodeList groups = document.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, "MissingIndexGroup");
        for (int i = 0; i < groups.getLength(); i++)
        {
            Element group = (Element) groups.item(i);
            Element index = firstDirectOrDescendant(group, "MissingIndex");
            String prefix = "missingIndex-" + (i + 1);
            addStringProperty(properties, prefix + "-summary", "Recommendation " + (i + 1), missingIndexSummary(group, index), null, true);
            addNumberProperty(properties, prefix + "-impact", "Impact " + (i + 1), numberAttr(group, "Impact"), "%", true);
            if (index != null)
            {
                addStringProperty(properties, prefix + "-database", "Database " + (i + 1), trimBrackets(attr(index, "Database")), null, false);
                addStringProperty(properties, prefix + "-schema", "Schema " + (i + 1), trimBrackets(attr(index, "Schema")), null, false);
                addStringProperty(properties, prefix + "-table", "Table " + (i + 1), trimBrackets(attr(index, "Table")), null, true);
                addStringProperties(properties, prefix + "-equality", "Equality column " + (i + 1), columnGroupColumns(index, "EQUALITY"), true);
                addStringProperties(properties, prefix + "-inequality", "Inequality column " + (i + 1), columnGroupColumns(index, "INEQUALITY"), false);
                addStringProperties(properties, prefix + "-include", "Include column " + (i + 1), columnGroupColumns(index, "INCLUDE"), false);
            }
        }
        return properties;
    }

    private static String missingIndexSummary(Element group, Element index)
    {
        if (index == null)
        {
            return "Missing index recommendation";
        }
        final String table = trimBrackets(attr(index, "Table"));
        final String equality = columnGroup(index, "EQUALITY");
        final String inequality = columnGroup(index, "INEQUALITY");
        final String include = columnGroup(index, "INCLUDE");
        StringBuilder builder = new StringBuilder("Missing index");
        if (!table.isBlank())
        {
            builder.append(" on ")
                    .append(table);
        }
        String impact = attr(group, "Impact");
        if (!impact.isBlank())
        {
            builder.append(" (impact ")
                    .append(impact)
                    .append("%)");
        }
        if (!equality.isBlank())
        {
            builder.append(" equality: ")
                    .append(equality);
        }
        if (!inequality.isBlank())
        {
            builder.append(" inequality: ")
                    .append(inequality);
        }
        if (!include.isBlank())
        {
            builder.append(" include: ")
                    .append(include);
        }
        return builder.toString();
    }

    private static String columnGroup(Element missingIndex, String usage)
    {
        return String.join(", ", columnGroupColumns(missingIndex, usage));
    }

    private static List<String> columnGroupColumns(Element missingIndex, String usage)
    {
        List<String> columns = new ArrayList<>();
        NodeList groups = missingIndex.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, "ColumnGroup");
        for (int i = 0; i < groups.getLength(); i++)
        {
            Element group = (Element) groups.item(i);
            if (!usage.equalsIgnoreCase(attr(group, "Usage")))
            {
                continue;
            }
            NodeList columnNodes = group.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, "Column");
            for (int j = 0; j < columnNodes.getLength(); j++)
            {
                String name = trimBrackets(attr((Element) columnNodes.item(j), "Name"));
                if (!name.isBlank())
                {
                    columns.add(name);
                }
            }
        }
        return columns;
    }

    private static Element firstDirectOrDescendant(Element root, String localName)
    {
        for (Element child : directChildElements(root, localName))
        {
            return child;
        }
        return firstDescendant(root, localName);
    }

    private static List<String> warningSummaries(Element relOp)
    {
        List<String> warnings = new ArrayList<>();
        for (Element warning : directChildElements(relOp, "Warnings"))
        {
            for (String name : List.of("NoJoinPredicate", "ColumnsWithNoStatistics", "SpillToTempDb", "PlanAffectingConvert", "Wait"))
            {
                String value = attr(warning, name);
                if (!value.isBlank()
                        && !"false".equalsIgnoreCase(value))
                {
                    warnings.add(name + ("true".equalsIgnoreCase(value) ? ""
                            : ": " + value));
                }
            }
            String text = compactText(warning.getTextContent());
            if (!text.isBlank())
            {
                warnings.add(truncate(text, 180));
            }
        }
        return warnings;
    }

    private static List<Element> directChildElements(Element root, String localName)
    {
        List<Element> result = new ArrayList<>();
        NodeList children = root.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element element
                    && localName.equals(element.getLocalName()))
            {
                result.add(element);
            }
        }
        return result;
    }

    private static Element firstDescendant(Element root, String localName)
    {
        NodeList matches = root.getElementsByTagNameNS(SHOWPLAN_NAMESPACE, localName);
        return matches.getLength() == 0 ? null
                : (Element) matches.item(0);
    }

    private static Element firstDescendantWithinRelOp(Element root, String localName)
    {
        return firstDescendantWithinRelOp(root, localName, true);
    }

    private static Element firstDescendantWithinRelOp(Element root, String localName, boolean rootElement)
    {
        if (!rootElement
                && "RelOp".equals(root.getLocalName()))
        {
            return null;
        }
        if (localName.equals(root.getLocalName()))
        {
            return root;
        }
        NodeList children = root.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element element)
            {
                Element match = firstDescendantWithinRelOp(element, localName, false);
                if (match != null)
                {
                    return match;
                }
            }
        }
        return null;
    }

    private static String firstAttributeWithinRelOp(Element root, List<String> names)
    {
        return firstAttributeWithinRelOp(root, names, true);
    }

    private static String firstAttributeWithinRelOp(Element root, List<String> names, boolean rootElement)
    {
        if (!rootElement
                && "RelOp".equals(root.getLocalName()))
        {
            return "";
        }
        for (String name : names)
        {
            String value = attr(root, name);
            if (!value.isBlank())
            {
                return value;
            }
        }
        NodeList children = root.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element element)
            {
                String value = firstAttributeWithinRelOp(element, names, false);
                if (!value.isBlank())
                {
                    return value;
                }
            }
        }
        return "";
    }

    private static List<Element> descendantsWithinRelOp(Element root, String localName)
    {
        List<Element> result = new ArrayList<>();
        collectDescendantsWithinRelOp(root, localName, true, result);
        return result;
    }

    private static void collectDescendantsWithinRelOp(Element root, String localName, boolean rootElement, List<Element> result)
    {
        if (!rootElement
                && "RelOp".equals(root.getLocalName()))
        {
            return;
        }
        if (localName.equals(root.getLocalName()))
        {
            result.add(root);
        }
        NodeList children = root.getChildNodes();
        for (int i = 0; i < children.getLength(); i++)
        {
            Node child = children.item(i);
            if (child instanceof Element element)
            {
                collectDescendantsWithinRelOp(element, localName, false, result);
            }
        }
    }

    private static boolean booleanAttr(Element element, String name)
    {
        return "true".equalsIgnoreCase(attr(element, name))
                || "1".equals(attr(element, name));
    }

    private static Double numberAttr(Element element, String name)
    {
        return parseDouble(attr(element, name));
    }

    private static Double parseDouble(String value)
    {
        if (value == null
                || value.isBlank())
        {
            return null;
        }
        try
        {
            return Double.parseDouble(value);
        }
        catch (NumberFormatException e)
        {
            return null;
        }
    }

    private static String attr(Element element, String name)
    {
        return element.hasAttribute(name) ? element.getAttribute(name)
                : "";
    }

    private static void addGroup(List<GraphPropertyGroup> groups, String id, String label, List<GraphProperty> properties)
    {
        if (!properties.isEmpty())
        {
            groups.add(new GraphPropertyGroup(id, label, properties));
        }
    }

    private static void addElementText(List<GraphProperty> properties, String id, String label, Element element)
    {
        if (element == null)
        {
            return;
        }
        addStringProperty(properties, id, label, truncate(elementValue(element), 300), null, false);
    }

    private static String elementValue(Element element)
    {
        Element scalar = firstDescendant(element, "ScalarOperator");
        if (scalar != null)
        {
            String scalarString = attr(scalar, "ScalarString");
            if (!scalarString.isBlank())
            {
                return scalarString;
            }
        }
        return compactText(element.getTextContent());
    }

    private static void addStringProperty(List<GraphProperty> properties, String id, String label, String value, String unit, boolean important)
    {
        if (value == null
                || value.isBlank())
        {
            return;
        }
        properties.add(new GraphProperty(id, label, value, unit, important));
    }

    private static void addStringProperties(List<GraphProperty> properties, String idPrefix, String label, List<String> values, boolean important)
    {
        for (int i = 0; i < values.size(); i++)
        {
            addStringProperty(properties, idPrefix + "-" + (i + 1), label + " " + (i + 1), truncate(values.get(i), 300), null, important);
        }
    }

    private static void addNumberProperty(List<GraphProperty> properties, String id, String label, Double value, String unit, boolean important)
    {
        if (value == null)
        {
            return;
        }
        properties.add(new GraphProperty(id, label, value, unit, important));
    }

    private static String compactText(String value)
    {
        return value == null ? ""
                : value.replaceAll("\\s+", " ")
                        .trim();
    }

    private static String truncate(String value, int maxLength)
    {
        if (value.length() <= maxLength)
        {
            return value;
        }
        return value.substring(0, Math.max(0, maxLength - 3)) + "...";
    }

    private static String trimBrackets(String value)
    {
        return value == null ? ""
                : value.replace("[", "")
                        .replace("]", "");
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

    private record EdgeDraft(String id, String sourceVertexId, String targetVertexId, Double estimatedRows, Double actualRows)
    {
    }

    private record SpoolTargetDraft(String id, String sourceVertexId, String targetVertexId, String targetNodeId)
    {
    }
}
