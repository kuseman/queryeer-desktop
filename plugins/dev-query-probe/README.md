# Dev Query Probe Plugin

External dual-target development plugin package used to probe backend query execution from a frontend panel/commands.

## Package layout

- `plugin.json` - shared manifest for frontend + backend targets
- `frontend/module.mjs` - frontend plugin entry module
- `lib/*.jar` - backend plugin jar artifacts staged from `backend-plugin-devprobe`

## Development workflow

From `queryeer-desktop`:

- `npm run dev:plugin:stage`
  - builds backend module `backend-plugin-devprobe`
  - stages generated jar(s) into `plugins/dev-query-probe/lib`
- `npm run dev:plugin:watch`
  - watches backend plugin source + external plugin files
  - reruns staging automatically on change
- `npm run dev:with-plugins`
  - launches desktop dev server with `QUERYEER_PLUGINS_PATH=<repo>/plugins`

## Runtime notes

- Frontend target is loaded from `frontend/module.mjs`.
- Backend target activation requires staged jar(s) in `lib/`.
- If load fails, check desktop Manifest Diagnostics and backend runtime status diagnostics.
