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

export function tokenize(text: string, path: string): Array<{ text: string; token: Token }> {
  const pattern = cache.get(path) ?? patternFor(path);
  cache.set(path, pattern);
  const out: Array<{ text: string; token: Token }> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), token: "plain" });
    const token: Token = match[1] ? "comment" : match[2] ? "string" : match[3] ? "number" : "keyword";
    out.push({ text: match[0], token });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: "plain" });
  return out;
}
