export function inflateDottedKeys(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes(".")) {
      if (!(key in root)) {
        root[key] = value;
      }
      continue;
    }

    const segments = key.split(".");
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) break;

      const isLast = i === segments.length - 1;
      if (isLast) {
        if (!(segment in cursor)) {
          cursor[segment] = value;
        }
      } else {
        const next = cursor[segment];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          cursor[segment] = {};
        }
        cursor = cursor[segment] as Record<string, unknown>;
      }
    }
  }

  return root;
}
