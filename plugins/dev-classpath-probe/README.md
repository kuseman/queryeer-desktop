# Dev Classpath Probe

This plugin verifies backend dev-mode classpath loading via `classes/` + `@deps-list.txt`.

## Stage artifacts

From `queryeer-desktop`:

```bash
npm run dev:classpath:probe:stage
```

This command:

- builds `queryeer-backend/backend-plugin-devprobe`
- copies compiled classes to `plugins/dev-classpath-probe/classes`
- generates `plugins/dev-classpath-probe/deps-list.txt`

`deps-list.txt` is machine-generated and intentionally not committed.

## Run desktop with external plugins

```bash
npm run dev:with-plugins
```

Ensure `QUERYEER_PLUGINS_PATH` points to repository `plugins/` (handled by `dev:with-plugins`).

## One-command smoke check

From `queryeer-desktop`:

```bash
npm run dev:classpath:probe:smoke
```

This stages artifacts and verifies backend runtime status includes `dev.classpath.probe`.
