import type { GraphLayoutDirection, GraphProperty } from "@queryeer/api/graph";
import type { GraphNodeTypeProps } from "@queryeer/api/graph/GraphNodeTypeExtension";
import { Handle, Position } from "../core.graph/graph-primitives";
import "./SchemaTableNode.css";

type ColumnDisplay = {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
};

function getColumnDisplay(property: GraphProperty): ColumnDisplay {
  return {
    name: property.label,
    type: String(property.value ?? ""),
    isPk: property.important === true,
    isFk: property.unit === "FK",
  };
}

function getHandlePositions(direction: GraphLayoutDirection | undefined): { source: Position; target: Position } {
  switch (direction) {
    case "bottom-top":
      return { source: Position.Top, target: Position.Bottom };
    case "left-right":
      return { source: Position.Right, target: Position.Left };
    case "right-left":
      return { source: Position.Left, target: Position.Right };
    case "top-bottom":
    default:
      return { source: Position.Bottom, target: Position.Top };
  }
}

export function SchemaTableNode({ data, selected }: GraphNodeTypeProps): JSX.Element {
  const vertex = data.vertex;
  const columnsGroup = vertex.properties?.find((g) => g.id === "columns");
  const columns = columnsGroup?.properties.map(getColumnDisplay) ?? [];
  const isView = vertex.kind === "VIEW";
  const handles = getHandlePositions(data.direction);
  const headerColor = isView ? "#059669" : "#2563eb";

  const hasPkColumns = columns.some((c) => c.isPk);
  const hasFkColumns = columns.some((c) => c.isFk);

  return (
    <div
      className={`schema-table-node${selected ? " is-selected" : ""}`}
    >
      {/*
       * Generic handles for non-FK connections or tables without FK/PK columns.
       * Kept as fallback so every node always has at least one handle of each type.
       */}
      {!hasPkColumns && <Handle type="target" position={handles.target} className="schema-table-node-handle" />}
      {!hasFkColumns && <Handle type="source" position={handles.source} className="schema-table-node-handle" />}

      <div className="schema-table-header" style={{ backgroundColor: headerColor }}>
        <span className="schema-table-kind">{vertex.kind}</span>
        <span className="schema-table-name">{vertex.label}</span>
      </div>

      <div className="schema-table-columns">
        {columns.length === 0 && (
          <div className="schema-table-empty">No columns</div>
        )}
        {columns.map((col) => (
          <div key={col.name} className="schema-table-column">
            <span className="schema-table-col-name">{col.name}</span>
            <span className="schema-table-col-type">{col.type}</span>
            <span className="schema-table-col-badges">
              {col.isPk && <span className="schema-table-badge schema-table-badge-pk" title="Primary Key">PK</span>}
              {col.isFk && <span className="schema-table-badge schema-table-badge-fk" title="Foreign Key">FK</span>}
            </span>
            {col.isPk && <Handle type="target" position={Position.Left} id={`pk:${col.name}`} className="schema-table-col-handle schema-table-col-handle-pk" />}
            {col.isFk && <Handle type="source" position={Position.Right} id={`fk:${col.name}`} className="schema-table-col-handle schema-table-col-handle-fk" />}
          </div>
        ))}
      </div>
    </div>
  );
}
