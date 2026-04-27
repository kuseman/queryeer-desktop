import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext } from "../core.queryengine/output/OutputRegistry";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";

function ResultsTable({
  schema,
  rows,
  metrics
}: {
  schema: OutputContext["schema"];
  rows: unknown[][];
  metrics?: OutputContext["metrics"];
}): JSX.Element {
  return (
    <div className="query-results-table-wrapper">
      <table className="query-results-table">
        {schema && (
          <thead>
            <tr>
              {schema.columns.map((col) => (
                <th key={col.name} title={col.type}>
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {(row as unknown[]).map((cell, j) => (
                <td key={j}>{cell === null || cell === undefined ? <em>NULL</em> : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {metrics && (
        <div className="query-results-metrics">
          {(metrics.rowCount ?? rows.length).toLocaleString()} rows &middot;{" "}
          {metrics.durationMs ?? 0}ms
        </div>
      )}
    </div>
  );
}

function TextOutputView({ context }: { context: OutputContext }): JSX.Element {
  // Rows are shown immediately as they stream in, in a stable position.
  // Progress messages live in the query editor toolbar — not here.
  if (context.rows.length > 0) {
    return (
      <ResultsTable
        schema={context.schema}
        rows={context.rows}
        metrics={context.state === "completed" ? (context.metrics ?? undefined) : undefined}
      />
    );
  }

  if (context.state === "failed" && context.error) {
    return (
      <div className="query-output-text-error">
        <span className="query-output-error-code">{context.error.code}</span>
        <span className="query-output-error-message">{context.error.message}</span>
      </div>
    );
  }

  if (context.state === "completed") {
    return (
      <div className="query-output-text-idle">
        No rows returned.
        {context.metrics?.durationMs !== undefined && (
          <span className="query-output-text-meta"> ({context.metrics.durationMs}ms)</span>
        )}
      </div>
    );
  }

  if (context.state === "cancelled") {
    return <div className="query-output-text-idle">Query cancelled.</div>;
  }

  if (context.state === "idle") {
    return <div className="query-output-text-idle">Press F5 or click Run to execute a query.</div>;
  }

  // running, no rows yet — empty; toolbar already shows the progress message
  return <div />;
}

export const coreQueryEngineOutputTextPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.text",
    name: "Query Engine Output: Text",
    version: "0.1.0",
    kind: "core",
    description: "Table/text output contributor for query results",
    dependencies: ["core.queryengine"],
    requiredCapabilities: ["query.engine"]
  },
  activate: () => {
    getOutputRegistry().register({
      id: "core.queryengine.output.text",
      title: "Results",
      render: (context) => <TextOutputView context={context} />
    });
  }
};
