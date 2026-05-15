package com.queryeer.backend.contract.query;

import com.queryeer.backend.contract.graph.GraphDocument;

public record QueryOutputArtifact(String id, String capability, String kind, String title, GraphDocument graph)
{
}
