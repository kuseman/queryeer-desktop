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
      return this.context[token.value];
    }

    if (token.type === "string" || token.type === "boolean" || token.type === "number") {
      this.cursor += 1;
      return token.value;
    }

    throw new Error(`Unexpected token '${token.type}' in when expression`);
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
