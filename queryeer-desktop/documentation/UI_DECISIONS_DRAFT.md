# UI Decisions Draft (VS Code-Inspired)

Status: draft

Purpose: define practical UI baseline decisions for a slimmer shell that feels close to VS Code while still keeping Queryeer identity.

## Principles

- Dense, low-noise workspace first.
- Clear separation between zones via thin borders.
- Consistent spacing and typography across panels.
- Icons should be vector-based (SVG), not text glyphs.

## Decisions

### 1) Smaller scrollbars

Decision:

- Use compact scrollbars in all scrollable shells/panels.
- Keep them visible enough for discoverability.

Target values:

- Scrollbar thickness: `8px`.
- Thumb min-height: `24px`.
- Track opacity low; thumb medium contrast.

Guidelines:

- Apply globally for renderer shell.
- Increase thumb contrast on hover.
- Avoid fully hidden/overlay-only scrollbars.

---

### 2) Thin visible line between panels

Decision:

- Use a 1px divider line between shell zones and panel cards.
- Keep draggable splitters but make the visual divider thinner and cleaner.

Target values:

- Static borders/dividers: `1px`.
- Splitter hit area can remain larger (for usability), visual line stays thin.

Guidelines:

- Use one consistent border token throughout shell.
- Do not use heavy shadows for separation.

---

### 3) Smaller font sizes

Decision:

- Shift to compact typography scale similar to editor-centric UIs.

Target scale:

- Base text: `12px` to `13px`.
- Secondary/meta text: `11px`.
- Section titles: `13px` to `14px`.
- Large page headings should be minimized in workspace mode.

Guidelines:

- Prioritize readability over decorative scale.
- Keep line-height tight but readable (around `1.35` to `1.45`).

---

### 4) SVG icons

Decision:

- Toolbar and shell action icons should be SVG components/assets.
- Remove text-symbol icons for production UI.

Guidelines:

- Use 16x16 baseline icon size.
- Color driven by CSS currentColor.
- Active/hover state handled by surrounding button classes.
- Prefer a consistent icon set style (outline or filled, not mixed).

## Proposed design tokens (initial)

```css
:root {
  --ui-font-size-xs: 11px;
  --ui-font-size-sm: 12px;
  --ui-font-size-md: 13px;
  --ui-font-size-title: 14px;

  --ui-border-color: rgba(173, 194, 219, 0.18);
  --ui-border-width: 1px;

  --ui-scrollbar-size: 8px;
  --ui-scrollbar-thumb: rgba(173, 194, 219, 0.35);
  --ui-scrollbar-thumb-hover: rgba(173, 194, 219, 0.55);
  --ui-scrollbar-track: rgba(7, 15, 25, 0.22);
}
```

## Implementation order

1. Introduce typography + border + scrollbar tokens in `base.css`.
2. Reduce current shell text scale to compact sizes.
3. Replace toolbar glyph icons with SVG icon components.
4. Unify divider visuals while keeping draggable behavior.
5. Run quick visual pass on desktop and mobile breakpoints.

## Acceptance criteria (draft)

- Scrollbars are visibly slimmer across sidebars/main logs.
- All zone boundaries use consistent thin line separators.
- Toolbar/status/sidebar text appears compact and readable.
- Sidebar toggle icons are SVG and styled consistently.
- No regressions in resize, drag handles, or status bar stickiness.

## Non-goals for this draft

- Full theme system redesign.
- Pixel-perfect VS Code cloning.
- Persistence of per-user density preferences.
