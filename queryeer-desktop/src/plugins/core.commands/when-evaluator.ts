export type ContextValues = Record<string, string | number | boolean | undefined>;

type Token =
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "and" }
  | { type: "or" }
  | { type: "not" }
  | { type: "eq" }
  | { type: "neq" }
  | { type: "identifier"; value: string }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "number"; value: number };

type StringMethod = "contains" | "startsWith" | "endsWith" | "matches";
type StringTransform = "lower" | "upper";

const STRING_METHODS: StringMethod[] = ["contains", "startsWith", "endsWith", "matches"];
const STRING_TRANSFORMS: StringTransform[] = ["lower", "upper"];

function applyStringMethod(method: StringMethod, subject: unknown, arg: unknown): boolean {
  if (typeof subject !== "string" || typeof arg !== "string") {
    return false;
  }
  switch (method) {
    case "contains": return subject.includes(arg);
    case "startsWith": return subject.startsWith(arg);
    case "endsWith": return subject.endsWith(arg);
    case "matches": {
      try {
        return new RegExp(arg).test(subject);
      } catch {
        return false;
      }
    }
  }
}

function applyStringTransform(transform: StringTransform, subject: unknown): string | undefined {
  if (typeof subject !== "string") {
    return undefined;
  }
  switch (transform) {
    case "lower": return subject.toLowerCase();
    case "upper": return subject.toUpperCase();
  }
}

class Parser {
  private readonly tokens: Token[];
  private cursor = 0;
  private readonly context: ContextValues;

  public constructor(tokens: Token[], context: ContextValues) {
    this.tokens = tokens;
    this.context = context;
  }

  public parseExpression(): boolean {
    return this.parseOr();
  }

  private parseOr(): boolean {
    let value = this.parseAnd();
    while (this.match("or")) {
      value = value || this.parseAnd();
    }
    return value;
  }

  private parseAnd(): boolean {
    let value = this.parseUnary();
    while (this.match("and")) {
      value = value && this.parseUnary();
    }
    return value;
  }

  private parseUnary(): boolean {
    if (this.match("not")) {
      return !this.parseUnary();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parsePrimaryValue();
    if (this.match("eq")) {
      const right = this.parsePrimaryValue();
      return left === right;
    }
    if (this.match("neq")) {
      const right = this.parsePrimaryValue();
      return left !== right;
    }
    return truthy(left);
  }

  private parsePrimaryValue(): string | number | boolean | undefined {
    const token = this.peek();
    if (!token) {
      return undefined;
    }

    if (this.match("lparen")) {
      const value = this.parseExpression();
      this.expect("rparen");
      return value;
    }

    if (token.type === "identifier") {
      this.cursor += 1;
      // Detect method call: tokenizer greedily consumed "foo.bar.contains" as one identifier.
      // Split at the last .methodName suffix when followed by (.
      const methodResult = this.tryParseMethodCall(token.value);
      if (methodResult !== null) {
        // Transforms return a string; apply any chained .method() calls that follow.
        return typeof methodResult === "string" ? this.applyChainedCalls(methodResult) : methodResult;
      }
      return this.context[token.value];
    }

    if (token.type === "string" || token.type === "boolean" || token.type === "number") {
      this.cursor += 1;
      return token.value;
    }

    throw new Error(`Unexpected token '${token.type}' in when expression`);
  }

  /**
   * If the identifier ends with a known method/transform suffix and the next token is "(",
   * consumes the call and returns the result (boolean for predicates, string for transforms).
   * Returns null if this is not a method call so the caller can fall back to a plain lookup.
   */
  private tryParseMethodCall(identifier: string): boolean | string | null {
    if (this.peek()?.type !== "lparen") {
      return null;
    }
    for (const method of STRING_METHODS) {
      const suffix = `.${method}`;
      if (identifier.endsWith(suffix)) {
        const propPath = identifier.slice(0, -suffix.length);
        const subject = this.context[propPath];
        this.cursor += 1; // consume lparen
        const arg = this.parsePrimaryValue();
        this.expect("rparen");
        return applyStringMethod(method, subject, arg);
      }
    }
    for (const transform of STRING_TRANSFORMS) {
      const suffix = `.${transform}`;
      if (identifier.endsWith(suffix)) {
        const propPath = identifier.slice(0, -suffix.length);
        const subject = this.context[propPath];
        this.cursor += 1; // consume lparen
        this.expect("rparen");
        return applyStringTransform(transform, subject) ?? null;
      }
    }
    return null;
  }

  /**
   * After a transform (lower/upper) yields a string, consume any further .method() tokens
   * that the tokenizer emitted as separate identifiers starting with ".".
   * Transforms (lower/upper) continue the loop; predicates (contains/startsWith/…) end it.
   */
  private applyChainedCalls(value: string): string | boolean | undefined {
    let current: string | undefined = value;
    while (true) {
      const next = this.peek();
      if (!next || next.type !== "identifier" || !next.value.startsWith(".")) {
        break;
      }
      const methodName = next.value.slice(1);
      if (this.tokens[this.cursor + 1]?.type !== "lparen") {
        break;
      }
      this.cursor += 1; // consume method identifier
      this.cursor += 1; // consume lparen
      if ((STRING_TRANSFORMS as readonly string[]).includes(methodName)) {
        this.expect("rparen");
        current = applyStringTransform(methodName as StringTransform, current);
      } else if ((STRING_METHODS as readonly string[]).includes(methodName)) {
        const arg = this.parsePrimaryValue();
        this.expect("rparen");
        return applyStringMethod(methodName as StringMethod, current, arg);
      } else {
        throw new Error(`Unknown method '.${methodName}' in when expression`);
      }
    }
    return current;
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private match(type: Token["type"]): boolean {
    const token = this.peek();
    if (!token || token.type !== type) {
      return false;
    }
    this.cursor += 1;
    return true;
  }

  private expect(type: Token["type"]): void {
    if (!this.match(type)) {
      throw new Error(`Expected '${type}' in when expression`);
    }
  }
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const isAlpha = (char: string) => /[A-Za-z_]/.test(char);
  const isAlnum = (char: string) => /[A-Za-z0-9_.]/.test(char);
  const isDigit = (char: string) => /[0-9]/.test(char);

  while (i < input.length) {
    const char = input[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }

    // Chained method suffix after ")" — e.g. ".lower" or ".contains"
    if (char === "." && i + 1 < input.length && isAlpha(input[i + 1]!)) {
      let value = ".";
      i += 1;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) {
        value += input[i]!;
        i += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }

    if (char === "!" && input[i + 1] === "=") {
      tokens.push({ type: "neq" });
      i += 2;
      continue;
    }

    if (char === "=") {
      if (input[i + 1] !== "=") {
        throw new Error("Invalid '=' token in when expression, use '=='");
      }
      tokens.push({ type: "eq" });
      i += 2;
      continue;
    }

    if (char === "&" && input[i + 1] === "&") {
      tokens.push({ type: "and" });
      i += 2;
      continue;
    }

    if (char === "|" && input[i + 1] === "|") {
      tokens.push({ type: "or" });
      i += 2;
      continue;
    }

    if (char === "!") {
      tokens.push({ type: "not" });
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      i += 1;
      let value = "";
      while (i < input.length && input[i] !== quote) {
        value += input[i]!;
        i += 1;
      }
      if (input[i] !== quote) {
        throw new Error("Unterminated string literal in when expression");
      }
      i += 1;
      tokens.push({ type: "string", value });
      continue;
    }

    if (isDigit(char)) {
      let value = char;
      i += 1;
      while (i < input.length && isDigit(input[i]!)) {
        value += input[i]!;
        i += 1;
      }
      tokens.push({ type: "number", value: Number(value) });
      continue;
    }

    if (isAlpha(char)) {
      let value = char;
      i += 1;
      while (i < input.length && isAlnum(input[i]!)) {
        value += input[i]!;
        i += 1;
      }
      if (value === "true") {
        tokens.push({ type: "boolean", value: true });
      } else if (value === "false") {
        tokens.push({ type: "boolean", value: false });
      } else {
        tokens.push({ type: "identifier", value });
      }
      continue;
    }

    throw new Error(`Unexpected character '${char}' in when expression`);
  }

  return tokens;
}

export function evaluateWhenExpression(expression: string | undefined, context: ContextValues): boolean {
  if (!expression || expression.trim().length === 0 || expression.trim() === "global") {
    return true;
  }

  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    return true;
  }

  const parser = new Parser(tokens, context);
  return parser.parseExpression();
}
