import { Badge, Card, EmptyState, Icon, Mono } from "./components";
import { fileNameOf, hasEngineMismatch, type FileEngineMatch, type QueryEngineRegistration } from "./model";

export function EnginesSection({
  registrations,
  resolvers,
  fileMatches,
  ownerOf,
  onSelectPlugin,
  onOpenFile
}: {
  registrations: QueryEngineRegistration[];
  resolvers: string[];
  fileMatches: FileEngineMatch[];
  ownerOf: (engineId: string) => string | undefined;
  onSelectPlugin: (pluginId: string) => void;
  onOpenFile: (fileId: string) => void;
}) {
  return (
    <div className="obs-stack">
      <div className="obs-grid-2">
        <Card title="Registered engines" icon="database" flush>
          {registrations.length === 0 ? (
            <EmptyState icon="database" title="No query engines registered" />
          ) : (
            <div className="obs-table-scroll">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Engine</th>
                  <th>MIME types</th>
                  <th>Plugin</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((registration) => {
                  const owner = ownerOf(registration.engineId);
                  return (
                    <tr key={registration.engineId}>
                      <td>
                        <Mono>{registration.engineId}</Mono>
                      </td>
                      <td>
                        <div className="obs-badge-row">
                          {registration.mimeTypes.length === 0 ? <span className="obs-muted">-</span> : registration.mimeTypes.map((mime) => <Badge key={mime}>{mime}</Badge>)}
                        </div>
                      </td>
                      <td className="obs-nowrap">
                        {owner ? (
                          <button type="button" className="obs-link" onClick={() => onSelectPlugin(owner)}>
                            {owner}
                          </button>
                        ) : (
                          <span className="obs-muted">shell</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </Card>
        <Card title="Engine resolvers" icon="symbol-misc">
          {resolvers.length === 0 ? (
            <p className="obs-muted">No resolvers registered, so no file can be matched to an engine.</p>
          ) : (
            <ol className="obs-ordered">
              {resolvers.map((resolver) => (
                <li key={resolver}>
                  <Mono>{resolver}</Mono>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Open files" icon="files" flush>
        {fileMatches.length === 0 ? (
          <EmptyState icon="file" title="No open files" />
        ) : (
          <div className="obs-table-scroll">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>MIME</th>
                  <th>Matched engine</th>
                  <th>Matched by</th>
                  <th>Bound engine</th>
                </tr>
              </thead>
              <tbody>
                {fileMatches.map((match) => {
                  const { file, matchedEngineId, matchedByResolver } = match;
                  const mismatch = hasEngineMismatch(match);
                  return (
                    <tr key={file.fileId} className={mismatch ? "obs-row-warning" : undefined}>
                      <td className="obs-nowrap">
                        <button type="button" className="obs-link" title={`${file.uri} (click to show its tab)`} onClick={() => onOpenFile(file.fileId)}>
                          {fileNameOf(file.uri)}
                        </button>
                      </td>
                      <td>
                        <Mono>{file.mimeType}</Mono>
                      </td>
                      <td className="obs-nowrap" title={mismatch ? `Bound to ${file.engineBinding?.engineId}, but a query would run on ${matchedEngineId ?? "no engine"}` : undefined}>
                        {mismatch && <Icon name="warning" className="obs-tone-text-warning obs-inline-icon" />}
                        {matchedEngineId ? <Mono>{matchedEngineId}</Mono> : <span className={mismatch ? "obs-tone-text-warning" : "obs-muted"}>none</span>}
                      </td>
                      <td className="obs-muted obs-nowrap">{matchedByResolver ?? "-"}</td>
                      <td className="obs-nowrap">
                        {file.engineBinding?.engineId ? (
                          <Mono>{file.engineBinding.engineId}</Mono>
                        ) : (
                          <span className="obs-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
