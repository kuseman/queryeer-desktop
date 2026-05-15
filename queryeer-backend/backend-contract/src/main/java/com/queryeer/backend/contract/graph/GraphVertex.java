package com.queryeer.backend.contract.graph;

import java.util.List;

public record GraphVertex(String id, String label, String kind, String description, GraphVertexStyle style, List<GraphPropertyGroup> properties, List<GraphAction> actions)
{
}
