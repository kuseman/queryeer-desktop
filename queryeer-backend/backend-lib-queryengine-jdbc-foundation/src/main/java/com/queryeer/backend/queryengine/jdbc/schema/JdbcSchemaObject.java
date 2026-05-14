package com.queryeer.backend.queryengine.jdbc.schema;

import java.util.List;
import java.util.Map;

public record JdbcSchemaObject(String id, String name, String kind, NodeType nodeType, String fullName, List<JdbcSchemaObject> children, Map<String, Object> attributes)
{
    public JdbcSchemaObject(String id, String name, String kind, List<JdbcSchemaObject> children, Map<String, Object> attributes)
    {
        this(id, name, kind, null, null, children, attributes);
    }

    public JdbcSchemaObject
    {
        if (nodeType == null)
        {
            nodeType = switch (kind)
            {
                case "connection", "database", "schema" -> NodeType.STRUCTURAL;
                case "column", "primary_key", "foreign_key", "index" -> NodeType.PROPERTY;
                default -> kind.endsWith("_container") ? NodeType.CONTAINER
                        : kind.endsWith("_folder") ? NodeType.FOLDER
                                : NodeType.OBJECT;
            };
        }
        if (fullName == null)
        {
            fullName = name;
        }
    }
}
