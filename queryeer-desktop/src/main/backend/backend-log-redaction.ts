const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "authorization",
  "connectionString",
  "credential"
];

const REDACTED = "[REDACTED]";

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate.toLowerCase()));
};

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = isSensitiveKey(key) ? REDACTED : redactValue(nestedValue);
    }
    return redacted;
  }

  return value;
};

const redactKeyValuePairs = (message: string): string => {
  let redacted = message;

  for (const key of SENSITIVE_KEYS) {
    const eqPattern = new RegExp(`(${key}\\s*=\\s*)([^\\s,;]+)`, "gi");
    redacted = redacted.replace(eqPattern, `$1${REDACTED}`);

    const colonPattern = new RegExp(`(${key}\\s*:\\s*)([^\\s,;]+)`, "gi");
    redacted = redacted.replace(colonPattern, `$1${REDACTED}`);
  }

  return redacted;
};

export const redactLogMessage = (message: string): string => {
  const trimmed = message.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(message) as unknown;
      return JSON.stringify(redactValue(parsed));
    } catch {
      return redactKeyValuePairs(message);
    }
  }

  return redactKeyValuePairs(message);
};

export const redactErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return redactLogMessage(message);
};
