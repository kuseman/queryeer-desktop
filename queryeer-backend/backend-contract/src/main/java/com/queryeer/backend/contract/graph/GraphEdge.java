package com.queryeer.backend.contract.graph;

import java.util.List;

public record GraphEdge(String id, String sourceVertexId, String targetVertexId, String label, String kind, GraphEdgeStyle style, List<GraphPropertyGroup> properties, List<GraphAction> actions)
{
}
