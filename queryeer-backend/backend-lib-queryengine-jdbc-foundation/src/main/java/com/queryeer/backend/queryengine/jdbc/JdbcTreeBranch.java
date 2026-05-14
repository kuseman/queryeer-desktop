package com.queryeer.backend.queryengine.jdbc;

import com.queryeer.backend.queryengine.jdbc.schema.NodeType;

public record JdbcTreeBranch(String parentKind, String kind, NodeType nodeType, String displayName, String icon)
{
}
