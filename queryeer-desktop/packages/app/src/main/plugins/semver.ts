/**
 * SemVer versions and npm-style ranges, for plugin compatibility checks. A port of the backend's `SemVer`
 * (queryeer-backend/backend-core), so both halves of a plugin read a range the same way.
 *
 * Ranges: comparators `=`, `>`, `>=`, `<`, `<=`, caret `^1.2.3`, tilde `~1.2.3`, wildcards `1.x` / `1.2.*` / `*`,
 * partial versions `1.2`, hyphen ranges `1.2.3 - 2.0.0`, comparators joined by spaces (and) and sets joined by `||` (or).
 *
 * Prereleases follow npm: `1.2.0-beta.1` satisfies a range only when one of its comparators names a prerelease of the
 * same `major.minor.patch`. `-SNAPSHOT`, Maven's development marker, counts as the release it becomes.
 */

type Version = { major: number; minor: number; patch: number; prerelease: string[] };
type Operator = "=" | ">" | ">=" | "<" | "<=";
type Comparator = { operator: Operator; version: Version };
type Partial = { major: number | null; minor: number | null; patch: number | null; prerelease: string[] };

const IDENTIFIERS = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const VERSION = new RegExp(`^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIERS}))?(?:\\+${IDENTIFIERS})?$`);
const PARTIAL = new RegExp(`^v?(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-(${IDENTIFIERS}))?(?:\\+${IDENTIFIERS})?$`);
const COMPARATOR = /^(<=|>=|<|>|=|\^|~>|~)?\s*(.+)$/;
const SNAPSHOT = "SNAPSHOT";
const MAX_PART = 2147483646;

/** Whether `version` satisfies `range`. Throws when either is not valid. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  parsed.prerelease = withoutSnapshot(parsed.prerelease);
  return parseRange(range).some((set) => satisfiesSet(parsed, set));
}

/** Whether the version is a development build (`-SNAPSHOT`, any case, build metadata ignored). */
export function isDevelopmentBuild(version: string): boolean {
  return /-snapshot$/i.test(version.trim().split("+", 1)[0]);
}

export function parseVersion(text: string): Version {
  const match = VERSION.exec(text.trim());
  if (!match) {
    throw new Error(`Not a SemVer version: '${text}'`);
  }
  return { major: part(match[1], text), minor: part(match[2], text), patch: part(match[3], text), prerelease: identifiers(match[4]) };
}

export function compareVersions(left: Version, right: Version): number {
  const tuple = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (tuple !== 0) {
    return Math.sign(tuple);
  }
  // A release is greater than its prereleases
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Number(left.prerelease.length === 0) - Number(right.prerelease.length === 0);
  }
  for (let i = 0; i < Math.min(left.prerelease.length, right.prerelease.length); i++) {
    const result = compareIdentifier(left.prerelease[i], right.prerelease[i]);
    if (result !== 0) {
      return result;
    }
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    // By length, then by digits: no overflow for long identifiers
    const aDigits = a.replace(/^0+(?=.)/, "");
    const bDigits = b.replace(/^0+(?=.)/, "");
    return aDigits.length !== bDigits.length ? Math.sign(aDigits.length - bDigits.length) : compareStrings(aDigits, bDigits);
  }
  if (aNumeric !== bNumeric) {
    // Numeric identifiers sort before alphanumeric ones
    return aNumeric ? -1 : 1;
  }
  return compareStrings(a, b);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function part(digits: string, text: string): number {
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value > MAX_PART) {
    throw new Error(`Version number too large in '${text}'`);
  }
  return value;
}

function satisfiesSet(version: Version, set: Comparator[]): boolean {
  if (!set.every((comparator) => test(comparator, version))) {
    return false;
  }
  if (version.prerelease.length === 0) {
    return true;
  }
  return set.some((comparator) => comparator.version.prerelease.length > 0
    && comparator.version.major === version.major
    && comparator.version.minor === version.minor
    && comparator.version.patch === version.patch);
}

function test(comparator: Comparator, candidate: Version): boolean {
  const result = compareVersions(candidate, comparator.version);
  switch (comparator.operator) {
    case "=": return result === 0;
    case ">": return result > 0;
    case ">=": return result >= 0;
    case "<": return result < 0;
    case "<=": return result <= 0;
  }
}

function parseRange(range: string): Comparator[][] {
  if (typeof range !== "string" || range.trim().length === 0) {
    throw new Error("Version range is empty");
  }
  return range.split("||").map((set) => parseSet(set.trim(), range));
}

function parseSet(set: string, range: string): Comparator[] {
  if (set.length === 0) {
    throw new Error(`Empty set in version range '${range}'`);
  }
  const hyphen = set.split(/\s+-\s+/);
  if (hyphen.length === 2) {
    const from = parsePartial(hyphen[0], range);
    const to = parsePartial(hyphen[1], range);
    return [{ operator: ">=", version: floor(from) }, ...upperBound(to, true)];
  }
  if (hyphen.length > 2) {
    throw new Error(`Invalid hyphen range in '${range}'`);
  }
  // Allow a space between an operator and its version: ">= 1.2.3"
  return set.replace(/(<=|>=|<|>|=|\^|~>|~)\s+/g, "$1").split(/\s+/).flatMap((token) => parseComparator(token, range));
}

function parseComparator(token: string, range: string): Comparator[] {
  const match = COMPARATOR.exec(token);
  if (!match) {
    throw new Error(`Invalid comparator '${token}' in version range '${range}'`);
  }
  const operator = match[1] ?? "";
  const partial = parsePartial(match[2], range);
  const low = floor(partial);
  const lowest = ["0"];
  switch (operator) {
    case "^":
      return [{ operator: ">=", version: low }, { operator: "<", version: caretCeiling(partial) }];
    case "~":
    case "~>":
      if (partial.major === null) {
        // "~*" is any version, like "*"
        return [{ operator: ">=", version: low }];
      }
      return [
        { operator: ">=", version: low },
        {
          operator: "<",
          version: partial.minor === null
            ? { major: low.major + 1, minor: 0, patch: 0, prerelease: lowest }
            : { major: low.major, minor: low.minor + 1, patch: 0, prerelease: lowest }
        }
      ];
    case ">":
      if (partial.major === null) {
        // ">*" matches nothing
        return [{ operator: "<", version: { major: 0, minor: 0, patch: 0, prerelease: lowest } }];
      }
      if (partial.minor === null) {
        return [{ operator: ">=", version: { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] } }];
      }
      if (partial.patch === null) {
        return [{ operator: ">=", version: { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: [] } }];
      }
      return [{ operator: ">", version: low }];
    case ">=":
      return [{ operator: ">=", version: low }];
    case "<":
      // "<1.2" is "<1.2.0-0", so no prerelease of 1.2.0 slips through; "<*" matches nothing
      return [{ operator: "<", version: partial.patch === null ? { major: low.major, minor: low.minor, patch: 0, prerelease: lowest } : low }];
    case "<=":
      return upperBound(partial, true);
    default:
      // "=" or none: an exact version, or a range for a partial one
      if (partial.major === null) {
        return [{ operator: ">=", version: { major: 0, minor: 0, patch: 0, prerelease: [] } }];
      }
      if (partial.patch === null) {
        return [{ operator: ">=", version: low }, ...upperBound(partial, false)];
      }
      return [{ operator: "=", version: low }];
  }
}

/** `<=` a partial version: below the next version up for its missing parts. With `inclusive` false, a partial is a wildcard. */
function upperBound(partial: Partial, inclusive: boolean): Comparator[] {
  if (partial.major === null) {
    return [];
  }
  if (partial.minor === null) {
    return [{ operator: "<", version: { major: partial.major + 1, minor: 0, patch: 0, prerelease: ["0"] } }];
  }
  if (partial.patch === null) {
    return [{ operator: "<", version: { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: ["0"] } }];
  }
  return [{ operator: inclusive ? "<=" : "<", version: floor(partial) }];
}

/** `^`: changes that do not modify the left-most non-zero part. */
function caretCeiling(partial: Partial): Version {
  const lowest = ["0"];
  if (partial.major === null) {
    return { major: 2147483647, minor: 0, patch: 0, prerelease: lowest };
  }
  if (partial.major > 0 || partial.minor === null) {
    return { major: partial.major + 1, minor: 0, patch: 0, prerelease: lowest };
  }
  if (partial.minor > 0 || partial.patch === null) {
    return { major: 0, minor: partial.minor + 1, patch: 0, prerelease: lowest };
  }
  return { major: 0, minor: 0, patch: partial.patch + 1, prerelease: lowest };
}

function parsePartial(text: string, range: string): Partial {
  const match = PARTIAL.exec(text.trim());
  if (!match) {
    throw new Error(`Invalid version '${text}' in version range '${range}'`);
  }
  const major = wildcardOrNumber(match[1]);
  const minor = wildcardOrNumber(match[2]);
  const patch = wildcardOrNumber(match[3]);
  if ((major === null && minor !== null) || (minor === null && patch !== null)) {
    throw new Error(`Invalid version '${text}' in version range '${range}'`);
  }
  const prerelease = withoutSnapshot(identifiers(match[4]));
  if (prerelease.length > 0 && patch === null) {
    throw new Error(`A prerelease needs a full version: '${text}' in version range '${range}'`);
  }
  return { major, minor, patch, prerelease };
}

function wildcardOrNumber(value: string | undefined): number | null {
  if (value === undefined || value === "x" || value === "X" || value === "*") {
    return null;
  }
  return part(value, value);
}

function floor(partial: Partial): Version {
  return { major: partial.major ?? 0, minor: partial.minor ?? 0, patch: partial.patch ?? 0, prerelease: partial.prerelease };
}

function withoutSnapshot(prerelease: string[]): string[] {
  return prerelease.length === 1 && prerelease[0].toUpperCase() === SNAPSHOT ? [] : prerelease;
}

function identifiers(prerelease: string | undefined): string[] {
  return prerelease === undefined ? [] : prerelease.split(".");
}
