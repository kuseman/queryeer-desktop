import { useEffect, useRef } from "react";

type OutlineHelpDialogProps = {
  onClose: () => void;
};

export function OutlineHelpDialog({ onClose }: OutlineHelpDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="outline-help-overlay" role="dialog" aria-modal={true} aria-label="Outline help">
      <div className="outline-help-dialog" ref={dialogRef} tabIndex={-1}>
        <h2>Outline</h2>
        <p>
          The outline view shows the symbols found in the active file and lets you
          quickly navigate to any symbol by clicking it or using keyboard navigation.
        </p>

        <h3>Keyboard Navigation</h3>
        <p>
          <kbd>&darr;</kbd> / <kbd>&uarr;</kbd> &mdash; Move selection down / up<br />
          <kbd>Enter</kbd> / <kbd>Space</kbd> &mdash; Toggle expand/collapse for symbols with children<br />
          <kbd>Esc</kbd> &mdash; Close this dialog
        </p>

        <h3>Supported File Types</h3>
        <p>
          Built-in outline providers exist for <code>JSON</code>, <code>XML</code>,
          <code>YAML</code>, and <code>SQL</code> files.
        </p>

        <h3>Custom Pattern Directives</h3>
        <p>
          Any text file can define custom symbol patterns using{" "}
          <code>@outline-pattern:</code> directives in the first 20 lines.
          This allows you to teach the outline view to recognize symbols in file
          types that don't have a built-in provider.
        </p>
        <p>
          The directive syntax is:
        </p>
        <pre>{"@outline-pattern: /{regex}/{flags} {kind} {detail}"}</pre>
        <p>Where:</p>
        <p>
          <code>{"{regex}"}</code> &mdash; A JavaScript regex. If it contains a
          capture group, the first group is used as the symbol name; otherwise the
          entire match is used.<br />
          <code>{"{flags}"}</code> &mdash; Optional regex flags (default:{" "}
          <code>g</code>). The <code>g</code> flag is always added if missing.<br />
          <code>{"{kind}"}</code> &mdash; Optional symbol kind such as{" "}
          <code>Function</code>, <code>Class</code>, <code>Variable</code>, etc.
          Defaults to <code>Namespace</code>.<br />
          <code>{"{detail}"}</code> &mdash; Optional detail string shown next to
          the symbol name.
        </p>
        <p>Examples:</p>
        <pre>{`# @outline-pattern: /function\\s+(\\w+)/ Function
# @outline-pattern: /class\\s+(\\w+)/ Class
-- @outline-pattern: /CREATE\\s+PROCEDURE\\s+(\\w+)/ Method
// @outline-pattern: /^\\s*pub\\s+fn\\s+(\\w+)/ Function pub-fns
/* @outline-pattern: /TODO\\b Variable todo */`}</pre>

        <button className="outline-help-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}