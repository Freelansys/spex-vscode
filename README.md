# spex-vscode

A Visual Studio Code plugin for the Spex language.

Currently provides syntax highlighting for `.spex` files. See
[VSCODE_SYNTAX_HIGHLIGHTING.md](VSCODE_SYNTAX_HIGHLIGHTING.md) for the language
reference the grammar is derived from.

## Features

- TextMate grammar (`syntaxes/spex.tmLanguage.json`, scope `source.spex`)
  - Comments (`--`, `/* */`), keywords (case-insensitive), base types,
    operators, punctuation
  - String, number, boolean and regex pattern literals (`/\d+/i`)
  - `select { ... }` natural-language constraint blocks: prose is left alone,
    with `@refs`, escapes (`\}`) and list markers highlighted
  - Fenced blocks delegate to VS Code's built-in grammars
    (` ```python ` → `source.python`, etc.); untagged fences (SKIT) stay plain
  - `create X` / `import X` declaration names
  - Brace products (`realize A as { ... }`, spex-parser 0.8.0)
- Language configuration: comment toggling (`--`, `/* */`), brackets,
  auto-closing pairs

## Development

```sh
npm install
npm run compile      # or: npm run watch
```

Press **F5** ("Run Extension") to launch an Extension Development Host and open
a `.spex` file.

### Tests

```sh
npm test
```

- `scripts/test.mjs` — tokenizes edge-case snippets and asserts the expected
  TextMate scopes (spec checklist §8)
- `scripts/check.mjs` — parses `test/fixtures/*.spex` with the real
  [`spex-parser`](https://www.npmjs.com/package/spex-parser) to keep fixtures
  valid
- `node scripts/tokenize.mjs <file.spex>` — dump scopes for any snippet

## Roadmap: language server

The extension currently ships a no-op activation entry point
(`src/extension.ts`). When diagnostics, go-to-definition or semantic tokens
(e.g. resolving `@refs` to their declarations) are needed, the plan is:

1. Add a `server/` package (e.g. `vscode-languageserver`) that wraps
   `spex-parser` for parse diagnostics and reference extraction.
2. Start the client from `activate()` in `src/extension.ts` using
   `vscode-languageclient` (already the designated hook point — no grammar
   changes required).
3. Keep TextMate highlighting as-is; use semantic tokens only for what the
   grammar cannot know (resolved references, cross-file bindings).
