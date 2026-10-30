/** A per-line highlighter: comments, strings, numbers and keywords. Enough to give code shape, not a parser. */

export type Token = "comment" | "string" | "number" | "keyword" | "plain";

const COMMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(py|rb|sh|bash|zsh|ya?ml|toml|tf|r|pl|ex|exs|nix)$|(^|\/)(Dockerfile|Makefile|\.env[^/]*)$/i, "#.*$"],
  [/\.sql$/i, "--.*$"],
  [/\.(md|mdx|txt|json|csv|lock)$/i, ""],
];

const KEYWORDS = [
  "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default",
  "defer", "delete", "do", "elif", "else", "enum", "export", "extends", "false", "finally", "fn", "for", "from",
  "func", "function", "go", "if", "impl", "implements", "import", "in", "instanceof", "interface", "is", "let",
  "match", "mod", "module", "mut", "new", "nil", "None", "null", "of", "package", "private", "protected", "pub",
  "public", "readonly", "return", "satisfies", "self", "static", "struct", "super", "switch", "this", "throw",
  "trait", "True", "true", "False", "try", "type", "typeof", "undefined", "use", "var", "void", "while", "with",
  "yield",
];
const SQL = ["SELECT", "FROM", "WHERE", "JOIN", "LEFT", "INNER", "ON", "AND", "OR", "NOT", "IN", "ORDER", "GROUP",
  "BY", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "RETURNING", "LIMIT", "AS", "IS", "NULL", "ANY"];

const patternFor = (path: string) => {
  const comment = COMMENTS.find(([test]) => test.test(path))?.[1] ?? String.raw`\/\/.*$|\/\*.*?(?:\*\/|$)`;
  return new RegExp(
    [
      `(${comment || "(?!)"})`,
      String.raw`("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\x60(?:[^\x60\\]|\\.)*\x60?)`,
      String.raw`\b(\d[\d_]*(?:\.\d+)?)\b`,
      `\\b(${[...KEYWORDS, ...SQL].join("|")})\\b`,
    ].join("|"),
    "g",
  );
};

const cache = new Map<string, RegExp>();

/** A construct left open at the end of a line: a template string or a block comment. */
export type Open = "`" | "/*" | null;

const CLOSERS = { "`": { close: /(?:[^`\\]|\\.)*`/y, token: "string" }, "/*": { close: /.*?\*\//y, token: "comment" } } as const;

/** Tokenizes one line, continuing whatever the previous line left open, and says what this one leaves open. */
export function tokenize(text: string, path: string, open: Open = null): { tokens: Array<{ text: string; token: Token }>; open: Open } {
  const out: Array<{ text: string; token: Token }> = [];
  let last = 0;
  if (open !== null) {
    const { close, token } = CLOSERS[open];
    close.lastIndex = 0;
    const match = close.exec(text);
    if (match === null) return { tokens: [{ text, token }], open };
    out.push({ text: match[0], token });
    last = match[0].length;
  }
  const pattern = cache.get(path) ?? patternFor(path);
  cache.set(path, pattern);
  let next: Open = null;
  const offset = last;
  for (const match of text.slice(offset).matchAll(pattern)) {
    const index = match.index + offset;
    if (index > last) out.push({ text: text.slice(last, index), token: "plain" });
    const token: Token = match[1] ? "comment" : match[2] ? "string" : match[3] ? "number" : "keyword";
    out.push({ text: match[0], token });
    last = index + match[0].length;
    const unclosed = (opener: string, closer: string) => match[0].startsWith(opener) && (match[0].length < opener.length + closer.length || !match[0].endsWith(closer));
    next = unclosed("`", "`") ? "`" : unclosed("/*", "*/") ? "/*" : null;
  }
  if (last < text.length) {
    out.push({ text: text.slice(last), token: "plain" });
    next = null;
  }
  return { tokens: out, open: next };
}
