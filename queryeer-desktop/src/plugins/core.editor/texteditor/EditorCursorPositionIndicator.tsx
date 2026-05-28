import { useEffect, useRef, useState } from "react";
import { getTextEditorRegistry } from "./TextEditorRegistry";
import type { TextEditorApi } from "./TextEditorApi";
import type { Disposable } from "./types";

type Position = {
  lineNumber: number;
  column: number;
};

export function EditorCursorPositionIndicator() {
  const [position, setPosition] = useState<Position | null>(null);
  const editorRef = useRef<TextEditorApi | null>(null);
  const disposableRef = useRef<Disposable | null>(null);

  useEffect(() => {
    const checkEditor = () => {
      const registry = getTextEditorRegistry();
      const editor = registry.getCommandTargetEditor();
      if (editor !== editorRef.current) {
        disposableRef.current?.dispose();
        editorRef.current = editor;
        if (editor) {
          const pos = editor.getPosition();
          if (pos) {
            setPosition((previous) => updatePosition(previous, pos));
          } else {
            setPosition(null);
          }
          let rafId: number | null = null;
          const latestEvent = { position: editor.getPosition() };
          disposableRef.current = editor.onDidChangeCursorPosition((event) => {
            latestEvent.position = event.position;
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
              rafId = null;
              setPosition((previous) => updatePosition(previous, latestEvent.position!));
            });
          });
        } else {
          setPosition(null);
        }
      }
    };

    checkEditor();
    const interval = window.setInterval(checkEditor, 500);
    return () => {
      window.clearInterval(interval);
      disposableRef.current?.dispose();
    };
  }, []);

  if (!position) {
    return null;
  }

  return <span>Ln {position.lineNumber}, Col {position.column}</span>;
}

function updatePosition(previous: Position | null, next: Position): Position {
  if (previous?.lineNumber === next.lineNumber && previous.column === next.column) {
    return previous;
  }
  return { lineNumber: next.lineNumber, column: next.column };
}
