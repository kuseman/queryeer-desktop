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
            setPosition({ lineNumber: pos.lineNumber, column: pos.column });
          } else {
            setPosition(null);
          }
          disposableRef.current = editor.onDidChangeCursorPosition((event) => {
            setPosition({ lineNumber: event.position.lineNumber, column: event.position.column });
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
