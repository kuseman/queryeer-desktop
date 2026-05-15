package com.queryeer.backend.contract.graph;

import java.util.List;

public record GraphPropertyGroup(String id, String label, List<GraphProperty> properties)
{
}
