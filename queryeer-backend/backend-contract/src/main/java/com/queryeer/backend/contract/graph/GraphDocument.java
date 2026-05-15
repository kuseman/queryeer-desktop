package com.queryeer.backend.contract.graph;

import java.util.List;

public record GraphDocument(String id, String title, String description, GraphLayoutOptions layout, List<GraphVertex> vertices, List<GraphEdge> edges)
{
}
