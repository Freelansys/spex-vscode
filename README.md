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
- Semantic highlighting (in-process, powered by
  [`spex-parser`](https://www.npmjs.com/package/spex-parser)):
  - Declaration sites — `create X`, import/include names, decomposition parts
  - References to in-file declarations, including dotted paths
  - `@refs` resolve to their declaration: objects → `type`, product
    fields/parameters → `parameter`
  - Builtin types and unresolved names are left to the grammar (cross-file
    resolution comes with the language server)

## Development

```sh
npm install
npm run compile      # esbuild bundle -> out/extension.js (or: npm run watch)
npm run typecheck    # tsc --noEmit
```

Press **F5** ("Run Extension") to launch an Extension Development Host and open
a `.spex` file.

### Tests

```sh
npm test
```

- `scripts/test.mjs` — tokenizes edge-case snippets and asserts the expected
  TextMate scopes (spec checklist §8)
- `scripts/test-semantic.mjs` — builds `src/semantic.ts` with esbuild and
  asserts declaration/reference/`@ref` resolution
- `scripts/check.mjs` — parses `test/fixtures/*.spex` with the real
  [`spex-parser`](https://www.npmjs.com/package/spex-parser) to keep fixtures
  valid
- `node scripts/tokenize.mjs <file.spex>` — dump scopes for any snippet

## Roadmap: language server

Semantic highlighting runs in-process today: `src/extension.ts` registers a
`DocumentSemanticTokensProvider` that delegates to the pure walker in
`src/semantic.ts` (parse with `spex-parser` → declarations → references →
`@refs`). When diagnostics, go-to-definition, hover or cross-file reference
resolution are needed:

1. Add a `server/` package (e.g. `vscode-languageserver`) and move
   `src/semantic.ts` behind it — the walker is transport-agnostic.
2. Start the client from `activate()` using `vscode-languageclient` (the
   designated hook point — grammar and legend stay unchanged).
3. Extend resolution beyond in-file declarations (imports, other `.spex`
   files) and surface unresolved names as diagnostics.
