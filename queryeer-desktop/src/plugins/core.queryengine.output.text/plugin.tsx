import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext } from "../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { XtermTextConsole } from "../../renderer/components/XtermTextConsole";
import {
  resolveTextOutputFormatter,
  type TextOutputFormatId
} from "./formatters";
import outputTextIconUrl from "./output-text.svg";
import { queryTextRegistry } from "../core.queryengine/QueryTextEditorRegistry";

type TextOutputViewState = {
  lines: string[];
  scrollLine: number;
};

const VIEW_STATE_KEY = defineStateKey<TextOutputViewState>("core.queryengine.output.text.viewState");
const MAX_BUFFER_LINES = 10_000;
function capLines(lines: string[]): string[] {
  return lines.length > MAX_BUFFER_LINES ? lines.slice(lines.length - MAX_BUFFER_LINES) : lines;
}

function TextOutputView({ context }: { context: OutputContext }): JSX.Element {
  const [scrollLine, setScrollLine] = useState(0);
  const scrollLineRef = useRef(0);

  const formatter = context.textOutputFormat as TextOutputFormatId;
  const activeFormatter = useMemo(() => resolveTextOutputFormatter(formatter), [formatter]);
  const formattedLines = useMemo(() => capLines(activeFormatter.format(context)), [activeFormatter, context]);

  useEffect(() => {
    if (!context.fileId) return;
    const saved = getFileStateRegistry().get(context.fileId, VIEW_STATE_KEY);
    if (!saved) return;
    setScrollLine(saved.scrollLine);
    scrollLineRef.current = saved.scrollLine;
  }, [context.fileId]);

  useEffect(() => {
    if (!context.fileId) return;
    getFileStateRegistry().set(context.fileId, VIEW_STATE_KEY, {
      lines: formattedLines,
      scrollLine
    });
  }, [context.fileId, formattedLines, scrollLine]);

  const handleLinkActivate = useCallback((uri: string) => {
    if (!uri.startsWith("editor://")) {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return;
    }
    const line = Number(parsed.searchParams.get("line") ?? "");
    const column = Number(parsed.searchParams.get("column") ?? "");
    if (!Number.isFinite(line) || line < 1) {
      return;
    }
    const editor = queryTextRegistry.getCommandTargetEditor();
    if (!editor) {
      return;
    }
    editor.focus();
    editor.setPosition({ lineNumber: line, column: Number.isFinite(column) && column > 0 ? column : 1 }, "center");
  }, []);

  return (
    <XtermTextConsole
      lines={formattedLines}
      classNamePrefix="query-output-text"
      fontSize={12}
      scrollback={MAX_BUFFER_LINES}
      initialScrollLine={scrollLineRef.current}
      onScrollLineChange={(line) => {
        scrollLineRef.current = line;
        setScrollLine(line);
        if (!context.fileId) {
          return;
        }
        getFileStateRegistry().set(context.fileId, VIEW_STATE_KEY, {
          lines: formattedLines,
          scrollLine: line
        });
      }}
      onLinkActivate={handleLinkActivate}
    />
  );
}

export const coreQueryEngineOutputTextPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.text",
    name: "Query Engine Output: Text",
    version: "0.1.0",
    kind: "core",
    description: "xterm.js text output contributor for query results",
    dependencies: ["core.queryengine"],
    requiredCapabilities: ["query.engine"]
  },
  activate: () => {
    getOutputRegistry().register({
      id: "core.queryengine.output.text",
      capability: "rows",
      mode: "primary",
      selectable: true,
      title: "Text",
      icon: outputTextIconUrl,
      priority: 200,
      render: (context) => <TextOutputView context={context} />
    });
  }
};
