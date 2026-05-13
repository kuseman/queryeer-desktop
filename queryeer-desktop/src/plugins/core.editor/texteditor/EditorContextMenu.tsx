import React from "react";
import type { ContextMenuItem } from "../../../contracts/extensions/ContextMenuExtension";
import { ContextMenuSurface } from "../../../renderer/components/ContextMenuSurface";

void React;

export type EditorContextMenuProps = {
  x: number;
  y: number;
  sections: ContextMenuItem[][];
  loading?: boolean;
  onClose: () => void;
};

export function EditorContextMenu({ x, y, sections, loading = false, onClose }: EditorContextMenuProps): JSX.Element {
  return (
    <ContextMenuSurface
      x={x}
      y={y}
      sections={sections.map((section) => section.map((item) => ({
        id: item.id,
        label: item.label,
        onSelect: item.run,
      })))}
      loading={loading}
      onClose={onClose}
    />
  );
}
