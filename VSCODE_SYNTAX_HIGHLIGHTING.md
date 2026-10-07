# Spex — VS Code Syntax Highlighting: Language Reference & Handoff

This document contains everything needed to build a VS Code extension that provides
syntax highlighting for the Spex language, in a form that can be handed to a fresh
session with no other context. It is derived from the authoritative implementation in
this repository (`spex-parser` v0.7.1).

No extension code lives in this repo — this file is the knowledge transfer.

---

## 1. Language at a glance

- **Spex** is a declarative language for AI-assisted software development. Syntax is
  intentionally close to TypeScript and SQL.
- **File extension:** `.spex` (suggested VS Code language id: `spex`, TextMate scope:
  `source.spex`).
- A file is a flat sequence of declarations. There is no `end` marker; an empty file
  is valid.
- Three fundamental object universes: `artifact`, `concept`, `environment`.
- The central operation is **realization** (`realize ... as ... in ...`); the central
  refinement mechanism is **subobjecting** (`from X select P`).
- Constraints (`select { ... }`) hold **natural-language prose**, not code — except
  when they are fenced code blocks (structured/code patterns).

### Sample file (use as a highlighting test case)

```spex
-- line comment
/* block comment */

import Todo from "todo.spex";
include "config.json" as config;

create TodoId as
from string
select {
  are valid UUIDs
};

create Todo as (
  id: TodoId,
  title: string,
  completed: bool
);

create AddTodo as
from (title: string) -> Todo
select {
  1. generate a UUID for the todo id
  2. call @CreateTodo using @title
  3. return the created todo
};

create Digits as /\d+/i;
create EvenInt as from number select ```
if &number > 0 {
  // gen: let $y be the square root of &number
}
```;

create PyDouble as from number -> number select ```python
return @n * 2
```;

realize TodoApp as TodoCli in Cli;
generate TodoWeb in FlaskWebEnv;
```

Real-world corpus for visual testing: `tests/props/*.spex` (9 files covering imports,
realize products, environments, comments, long NL constraints).

---

## 2. Source of truth in this repo

| File | Contains |
|---|---|
| `src/lexer.ts` | **All tokens and their exact regexes, in priority order** — start here |
| `src/parser.ts` | Full grammar (declarations, expressions, precedence) |
| `src/ast.ts` | AST node shapes, constraint kinds, `ReferenceDirective` |
| `src/visitor.ts` | `@ref` extraction regex, unescaping rules, code-fence parsing |
| `src/errors.ts` | `SpexError` with `phase`, `location`, `underlying` (useful if the extension later adds diagnostics/LSP) |
| `README.md` | Language concepts, semantics, many examples |
| `tests/lexer.test.ts` | Exact edge-case behavior of every token |

Parser can be used programmatically to validate any sample:
`import { SpexLexer, parseToAst } from 'spex-parser'` (package `spex-parser`,
ESM, built with `tsc`). `SpexLexer.tokenize(text)` dumps raw tokens — useful for
iterating on the TextMate grammar against tricky inputs.

---

## 3. Lexer specification (authoritative)

Tokens are tried **in array order; first match at the current offset wins**
(Chevrotain default). Order matters — see §3.9.

### 3.1 Whitespace & comments

| Token | Pattern | Notes |
|---|---|---|
| WhiteSpace | `/\s+/` | skipped |
| LineComment | `/--[^\r\n]*/` | SQL-style; to end of line; may be the last line of a file (no newline needed) |
| BlockComment | `/\/\*[\s\S]*?\*\//` | non-greedy; **cannot nest**; unterminated → lexing error |

**Critical:** comment markers are *not* comments inside a `select { ... }` block
(§5). `--` and `/*` inside braces are raw text.

### 3.2 Keywords — all **case-insensitive**, all end with `\b`

Declaration / clause keywords:

| Token | Pattern |
|---|---|
| `create` | `/create\b/i` |
| `as` | `/as\b/i` |
| `from` | `/from\b/i` |
| `select` | `/select\b/i` |
| `generate` | `/generate\b/i` |
| `import` | `/import\b/i` |
| `realize` | `/realize\b/i` |
| `include` | `/include\b/i` |
| `in` | `/in\b/i` |

Set-operator keywords:

| Token | Pattern |
|---|---|
| `union` | `/union\b/i` |
| `intersect` | `/intersect\b/i` |
| `except` | `/except\b/i` |

> Keywords are matched **before** `Identifier`, so every word in this section is a
> reserved word: `create In as string;` fails to parse. Same for §3.4 base types and
> `true`/`false`.

### 3.3 Operators & punctuation (exact tokens)

`->`  `|`  `{`  `}`  `[`  `]`  `(`  `)`  `:`  `,`  `;`  `.`

Note there is **no** `=` and no arithmetic operators. `/` never appears as an
operator — it only starts a block comment (§3.1) or a regex pattern literal (§3.7).

### 3.4 Base-type keywords — case-insensitive, reserved

| Token | Pattern | Meaning |
|---|---|---|
| `artifact` | `/artifact\b/i` | base universe of concrete things |
| `concept` | `/concept\b/i` | base universe of abstract specs |
| `environment` | `/environment\b/i` | base universe of realization contexts |
| `string` | `/string\b/i` | built-in artifact |
| `number` | `/number\b/i` | built-in artifact |
| `bool` | `/bool\b/i` | built-in artifact |
| `unit` | `/unit\b/i` | empty product |

### 3.5 Literals

| Token | Pattern | Notes |
|---|---|---|
| StringLiteral | `/'([^'\\]\|\\.)*'\|"([^"\\]\|\\.)*"/` | single **or** double quotes; any `\x` escape allowed inside; value unescaped with `\\([\\'"]) → $1` |
| NumberLiteral | `/\d+(\.\d+)?/` | integers and simple decimals only — **no sign, no exponent, no hex, no leading-dot** (`1.5` is one token; `1.` is `1` + `.`) |
| TrueTok | `/true\b/i` | reserved word |
| FalseTok | `/false\b/i` | reserved word |

### 3.6 Identifier

`/[a-zA-Z_][a-zA-Z0-9_]*/` — ASCII only, no `$`, no Unicode, no `-` (kebab-case
identifiers do not exist).

### 3.7 Regex pattern literal (a.k.a. pattern object)

Custom matcher for `/pattern/flags`:

- Must start with `/`.
- `\<any>` escapes skip the next character.
- Inside `[...]` character classes, `/` does not terminate.
- Terminates at the first unescaped `/` outside a class, then consumes a run of
  **lowercase ASCII letters** as flags (`[a-z]*`) — e.g. `/create\b/i`.
- Unterminated → no match → lexing error.
- `/*` is **always** a block comment, never a pattern (comment tokens come first).
- Examples that must highlight correctly: `/\d+/`, `/create\b/i`,
  `/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"/`, `/\/\*/` (escaped slash), `/[]']/` (quote in class).

### 3.8 Multi-line raw blocks (the two big ones)

#### SelectBlock — natural-language constraint `{ ... }`

Custom matcher:

- Matches only if the text at the offset starts with `{`.
- Scans forward; `\<char>` skips the next character (so `\}`, `\{`, `\\` are
  escapes); ends at the **first unescaped `}`**.
- **No nesting**: the first unescaped `}` closes the block, even if a `{` appeared
  inside.
- Multi-line allowed (`line_breaks: true`).
- If no unescaped `}` exists to end of file → the token does not match, and the
  lexer **falls back to individual tokens** (`{`, identifiers, ...). Mirror this in
  TextMate (see §7.1): an unterminated `{` degrades to normal tokenization.
- Unescaping after extraction: only `\\`, `\{`, `\}` are unescaped
  (`\\([\\{}]) → $1`); backslashes before other characters are kept verbatim.

#### CodeBlock — fenced block ` ``` `

Custom matcher:

- Must start with exactly three backticks. (Four or more backticks → no match →
  lexing error.)
- Optional **language identifier** on the rest of the opening fence line; must match
  `^[a-zA-Z0-9_]+$` after trimming (empty ⇒ structured pattern). Anything else
  (e.g. hyphens) → no match → error.
- The opening fence **must be followed by a newline**; otherwise no match.
- `\<char>` escapes skip the next character inside the body.
- Ends at the first unescaped ` ``` `; the closing fence is part of the token.
- Trailing content after the closing fence stays for normal tokenization.

Classification (from `visitor.ts`):

- Fence language empty → constraint type **`Structured`** (SKIT — universal
  pseudo-code: `if`, loops, `try/catch`, ...).
- Fence language present → constraint type **`Code`**, language string recorded in
  the AST (```` ```python ````, ```` ```typescript ````, ...).

### 3.9 Token priority order (reproduce this order in the TextMate grammar)

```
WhiteSpace, LineComment, BlockComment,
create as from select generate import union intersect except realize in include,
->, |, SelectBlock, {, }, [, ], (, ), :, ,, ;, .,
StringLiteral, NumberLiteral, true, false,
PatternLiteral, CodeBlock,
artifact concept environment string number bool unit,
Identifier
```

Consequences worth reproducing:

- Comment tokens precede pattern literals → `-- /x/` is a comment; `/*...*/` wins
  over `/.../`.
- `SelectBlock` precedes `{` → a terminated block wins; an unterminated one falls
  back to tokens.
- Keywords/base types precede `Identifier` → they are reserved words.

---

## 4. Grammar (from `src/parser.ts`)

```ebnf
spexFile        := declaration*
declaration     := realizeDecl | objectDecl | importDecl | includeDecl | generateDecl
                   (alternatives are disambiguated by backtracking)

objectDecl      := 'create' Identifier 'as' setObject ';'
setObject       := coproduct (('union' | 'intersect' | 'except') coproduct)*   -- left-assoc
coproduct       := objectExpr ('|' objectExpr)*                                -- left-assoc
objectExpr      := operand ('->' objectExpr)?                                  -- right-assoc
operand         := (literal | pattern | subObject | parenthesized | product | named) '[]'*
literal         := StringLiteral | NumberLiteral | 'true' | 'false'
named           := (Identifier | 'string' | 'number' | 'bool' | 'unit'
                    | 'artifact' | 'concept' | 'environment') ('.' Identifier)*
product         := '(' (Identifier ':' setObject ','?)* ')'   -- comma optional, trailing comma OK
parenthesized   := '(' setObject ')'
subObject       := 'from' setObject 'select' (SelectBlock | CodeBlock)
pattern         := PatternLiteral

importDecl      := 'import' (namedImport | moduleImport) ';'
namedImport     := Identifier 'from' StringLiteral ('as' Identifier)?
moduleImport    := StringLiteral 'as' Identifier
generateDecl    := 'generate' Identifier ('in' setObject)? ';'
realizeDecl     := 'realize' setObject 'as' setObject ('in' setObject)? ';'
includeDecl     := 'include' StringLiteral 'as' Identifier ';'
```

### Operator precedence — loosest to tightest

1. Set operations `UNION` / `INTERSECT` / `EXCEPT` (left-to-right chaining)
2. `|` (coproduct), left-associative
3. `->` (exponential), right-associative

Examples: `A -> B | C` = `(A -> B) | C`; `A UNION B | C` = `A UNION (B | C)`;
`A UNION B EXCEPT C` = `(A UNION B) EXCEPT C`.

### Product vs. group disambiguation

`(` opens a **product** if it is followed by `Identifier :`, otherwise a **group**.
Empty product `()` parses to `unit`. `unit` fields are dropped from products.

### Array suffix

`[]` may repeat: `Todo[]`, `string[][]`.

### Dotted names

`types.EmailAddress`, `z.real`, `string.foo` are all single named objects
(base-type tokens may also start a dotted path).

---

## 5. `select { ... }` natural-language constraints

- Raw prose: numbered steps (`1.`, `2.`), bullets (`-`), plain English.
- `--` and `/* */` inside are **text**, not comments.
- `\{`, `\}`, `\\` are escapes (highlight as `constant.character.escape`).
- `@refs` (§6) appear frequently and should be highlighted.
- Because prose is unstructured, consider scoping the whole block as plain text
  (e.g. `string.unquoted.spex` / `meta.constraint.natural-language.spex`) plus
  `@ref` and escape highlighting, rather than tokenizing it as Spex code.
- First unescaped `}` closes — no nested blocks.

---

## 6. Directives & in-block markup

### `@ref` reference directives

Exact extraction regex (from `src/visitor.ts`):

```
/@([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)/g
```

- Applies in **all three constraint kinds** (natural language, structured, code).
- Scoping rule: TypeScript-like scope (semantic, not a lexer concern).
- Examples: `@AddTodo`, `@title`, `@z.real`, `@types.EmailAddress`.
- Parsed into `ReferenceDirective` AST nodes — the parser can be used to compute the
  exact set of refs in a file (useful if the extension later adds go-to-definition).

### Inside structured (SKIT) and code blocks

| Construct | Example | Suggested scope |
|---|---|---|
| `@ref` | `return @n * 2` | reference/variable scope (same as above) |
| `&param` | `if &number > 0` | `variable.parameter` — refers to a function parameter |
| `$var` | `let $y be ...` | `variable.other` — introduced bindings |
| `gen:` directive | `// gen: let $y be the square root of &x` | comment-like + `keyword.other` for `gen:` — marks *unprovable* generated code |
| `gen:` prefixes seen | `//` (per README); assume language-appropriate comment prefix (`//`, `#`, `--`) followed by `gen:` | |

**Gotcha:** Python decorators (`@decorator`) in a `python` code block are lexically
identical to `@refs`. The real parser intentionally extracts `@refs` from code
constraints too, so highlighting them in code blocks matches the parser — accept the
decorator collision or only highlight refs outside language-identified blocks.

---

## 7. TextMate grammar design notes

### 7.1 Suggested pattern order inside `source.spex`

1. `comment.line.double-dash.spex` — `--.*$`
2. `comment.block.spex` — `/\* ... \*/`
3. Select block: `begin` `\{`, `end` `\}` with escape handling for `\{` `\}` `\\`
   (contentName `meta.constraint.natural-language.spex`, inner patterns: escapes,
   `@refs`, optional list markers `^\s*\d+\.` / `^\s*-`).
   - If you want exact lexer fidelity with a single regex instead:
     `\{(?:\\.|[^\\}])*\}` — but a `match` pattern cannot carry nested patterns, so
     `begin`/`end` is preferred. Handle the "unterminated `{` falls back to normal
     tokenization" case with a `begin` that has a same-line/limited `end`, or accept
     slight deviation.
4. Code fence: `begin` `` ``` ``, `end` `` ``` `` (see §7.3).
5. String literals (single and double quoted) with `constant.character.escape` for
   `\\`, `\'`, `\"`.
6. Regex pattern literal: begin `/`, end `/[a-z]*` — beware of `/*` (block comment
   already matched earlier in the order) and of `/` inside `[...]` classes.
7. Keywords (§3.2) — case-insensitive. TextMate regex supports `(?i)`; use e.g.
   `(?i)\bcreate\b`. Make sure keyword patterns do not fire inside strings, comments,
   blocks (ordering handles this).
8. Base types (§3.4) — case-insensitive, `storage.type` / `support.type`.
9. `true`/`false` → `constant.language`.
10. Numbers `\d+(?:\.\d+)?` → `constant.numeric`.
11. Identifiers after `create` → `entity.name.type.spex` (the declared name).
12. Punctuation: `->` `|` → `keyword.operator`; `,` `;` `:` → `punctuation.separator`;
    brackets/parens/braces → `punctuation.definition.*`.
13. Declaration keywords can also be scoped contextually: everything between
    `create` and `as` is the name; `from ... select` is a meta.subobject region.

### 7.2 Suggested scope mapping

| Spex construct | TextMate scope |
|---|---|
| `-- ...` | `comment.line.double-dash.spex` |
| `/* ... */` | `comment.block.spex` |
| `create as from select realize generate import include in` | `keyword.control.declaration.spex` (or `keyword.other.spex`) |
| `union intersect except` | `keyword.operator.word.spex` |
| `->` `\|` | `keyword.operator.spex` |
| `string number bool unit artifact concept environment` | `storage.type.builtin.spex` |
| `true` `false` | `constant.language.boolean.spex` |
| numbers | `constant.numeric.spex` |
| `'...'` `"..."` | `string.quoted.single.spex` / `string.quoted.double.spex` |
| `/re/flags` | `string.regexp.spex` |
| declared name in `create X as` | `entity.name.type.spex` |
| imported name / alias | `entity.name.import.spex` |
| module path string in `import`/`include` | `string.quoted...` + `entity.name.namespace.spex` (optional) |
| `@ref` | `variable.other.reference.spex` (or `entity.name.function` if you prefer call-like look) |
| `&param` | `variable.parameter.skit.spex` |
| `$var` | `variable.other.skit.spex` |
| `gen:` | `comment.line` with `keyword.other.gen.spex` on `gen:` |
| escapes `\{ \} \\` | `constant.character.escape.spex` |
| select-block prose | `meta.constraint.natural-language.spex` (treat as plain text) |
| fence language id | `entity.name.language.spex` or `fenced_code.block.language` |

### 7.3 Fenced code blocks & embedded languages

- Opening fence: `` ``` `` optionally followed by `[A-Za-z0-9_]+`.
- Two flavors: no language → **structured (SKIT)**; with language → **code** pattern.
- VS Code cannot select an embedded grammar dynamically from a capture — follow the
  Markdown approach: one repository rule per supported fence language, e.g. a rule
  with `begin: ```python\b` … `end: ``` ``, `contentName:
  meta.embedded.block.python`, inner `include: source.python`. Provide the same for
  `typescript`, `javascript`, `json`, `sql`, `bash`, `go`, `rust`, ... — whatever set
  you support; unknown languages fall back to the generic fence rule (plain text).
- Suggested fence-id → VS Code language id / TextMate scope table:

  | fence id | language id | include |
  |---|---|---|
  | `python`, `py` | python | `source.python` |
  | `typescript`, `ts` | typescript | `source.ts` |
  | `javascript`, `js`, `jsx` | javascript | `source.js` |
  | `json` | json | `source.json` |
  | `bash`, `sh`, `shell` | shellscript | `source.shell` |
  | `sql` | sql | `source.sql` |
  | `go` | go | `source.go` |
  | `rust` | rust | `source.rust` |
  | `html` / `css` / `yaml` | ... | `source.html` / `source.css` / `source.yaml` |

  (Fence ids are restricted to `[A-Za-z0-9_]` — no `c++`, no `objective-c`.)
- Inside SKIT/structured blocks, apply generic highlighting: language-agnostic
  keywords (`if`, `else`, `return`, `for`, `while`, `try`, `catch`), `@refs`,
  `&params`, `$vars`, `gen:` comments.
- Declare `contributes.grammars.embeddedLanguages` so VS Code sets the right
  language configuration inside embedded regions (auto-closing pairs, comments).

### 7.4 Extension manifest (structure only, no code)

- `contributes.languages`: id `spex`, extensions `[".spex"]`, aliases, config
  `comments` → line `--`, block `/* */`.
- `contributes.grammars`: scopeName `source.spex`, path to the tmLanguage JSON,
  plus `embeddedLanguages` mapping (see §7.3).
- Optional niceties: `contributes.configuration` for enabling/disabling embedded
  language highlighting; a small test suite of `.spex` fixtures.

---

## 8. Edge-case checklist (verify each in the extension)

1. `--` comment at EOF without newline.
2. `/* comment */` inline, multi-line, containing token-like text; unterminated
   `/*` is an error.
3. Keywords are case-insensitive: `CREATE Todo AS string;`, `In`, `UNION`.
4. Reserved words cannot be identifiers: `create in as string;` is invalid.
5. `select { are valid -- not a comment }` — `--` inside braces is prose.
6. `select { match /* strict */ pattern }` — block comment markers inside braces are
   prose.
7. `select { a \} b }` — escaped brace does not close; `\{` and `\\` too.
8. Unterminated `select { ...` with no `}` anywhere → falls back to individual
   tokens.
9. `/\d+/`, `/create\b/i`, `/a\/b/`, `/[]']/`, empty `//` (empty pattern — is it
   valid? `//` would be… line comment! Actually `//` is *not* a comment here; only
   `--` and `/*`. An empty pattern `//` matches the custom matcher: start `/`,
   immediately `/` → returns `//`. Confirm desired rendering.), unterminated `/abc`.
10. ```` ```python ```` … ```` ``` ````; ```` ``` ```` without language (SKIT);
    fence with 4+ backticks (error); fence without trailing newline (error).
11. Strings: `'it\'s'`, `"say \"hi\""`, `'\\'`, mixed quote styles.
12. Numbers: `42`, `3.14`; non-numbers: `.5`, `1.`, `1e5`, `-1` (lex as
    punctuation/identifier/number combos).
13. `types.EmailAddress` dotted path; `Todo[][]` array suffix.
14. `@z.real`, `@types.EmailAddress` refs with dots; ref adjacent to escaped braces.
15. Product `( id: string, done: bool )` vs group `(A | B)` — `(` followed by
    `ident :` is a product.
16. Optional/trailing commas: `(a: string b: number,)`.
17. `realize TodoWeb as ( list: ListTodosHandler, ... ) in FlaskWebEnv;` — realize
    target can be a full expression.
18. `generate X in Env;` and bare `generate X;`.
19. Long NL constraint with numbered steps and bullets.

---

## 9. Concepts quick reference (for scope naming inspiration)

- **Artifact** — concrete producible thing: `string`, `number`, `bool`, `unit`,
  products `( a: T )`, coproducts `A | B`, exponentials `A -> B`, arrays `T[]`,
  literals, regex patterns.
- **Concept** — abstract spec to be realized; `from concept select { ... }`.
- **Environment** — where/how realization happens (language, deps);
  `from environment select { ... }`.
- **Subobjecting** — `from X select P` restricts membership (no decomposition).
  Three pattern kinds: natural language `{ ... }`, structured ` ``` `, code
  ` ```lang `.
- **Realization** — `realize A as B in E;` decomposes a concept into
  concepts/artifacts within an environment.
- **Set operations** — `UNION`, `INTERSECT`, `EXCEPT`.
- **Coproduct** — `A | B` ("either").
- **Exponential** — `Input -> Output` (function space).
- **`@ref`** — pulls a named object into the generation context, inside any
  constraint.
- **`include`** — imports a non-generated external resource (file/folder).
- **`generate`** — asks the compiler to produce realizations (optionally `in` one
  environment).

---

## 10. Suggested work breakdown for the new session

1. Scaffold a VS Code extension (grammar-only, no runtime code needed).
2. Write `spex.tmLanguage.json` following §3.9 order and §7.2 scopes; start with
   comments, keywords, strings, numbers, identifiers, punctuation.
3. Add select-block (`{...}`) handling with escapes + `@ref` injection (§5, §7.1.3).
4. Add regex pattern literals (§3.7) — careful with `/` vs `--` vs `/*`.
5. Add fenced blocks: generic SKIT highlighting first, then per-language embedded
   rules (§7.3).
6. Validate against `tests/props/*.spex` and the §8 checklist; optionally diff
   against `SpexLexer.tokenize()` output for tricky snippets.
7. Polish: language configuration (comment toggling, brackets), README, tests.
