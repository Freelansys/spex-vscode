import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './tokenize.mjs';
import { checkText } from './check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function ok(cond, label) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

const flat = (lines) => lines.flat();
const has = (t, scope) => t.scopes.includes(scope);
const find = (tokens, pred) => flat(tokens).find(pred);
const lineScopes = (lines, i) => lines[i].map((t) => t.scopes.join(' ')).join(' ');

// 1. line comment at EOF without newline
{
  const t = await tokenize('a b\n-- eof');
  ok(has(find(t, (x) => x.text === '-- eof'), 'comment.line.double-dash.spex'), 'line comment at EOF');
}

// 2. multiline block comment
{
  const t = await tokenize('/* a\n b */ y');
  ok(has(find(t, (x) => x.text === '*/'), 'comment.block.spex'), 'block comment ends');
  ok(!has(find(t, (x) => x.text === ' y'), 'comment.block.spex'), 'code after block comment');
}

// 3. keywords case-insensitive
{
  const t = await tokenize('CREATE Todo AS string;');
  ok(has(find(t, (x) => x.text === 'CREATE'), 'keyword.control.declaration.spex'), 'keyword upper-case');
  ok(has(find(t, (x) => x.text === 'Todo'), 'entity.name.type.spex'), 'create name');
  ok(has(find(t, (x) => x.text === 'string'), 'storage.type.builtin.spex'), 'base type');
}

// 4. reserved words are not type names
{
  const t = await tokenize('create in as string;');
  ok(!find(t, (x) => has(x, 'entity.name.type.spex')), 'reserved word not a type name');
}

// 5/6. comment markers inside select block are prose
{
  const t = await tokenize('create A as from string select {\n  are valid -- not a comment\n  match /* strict */ pattern\n};');
  const l1 = lineScopes(t, 1);
  const l2 = lineScopes(t, 2);
  ok(l1.includes('meta.constraint.natural-language.spex') && !l1.includes('comment.line'), '-- inside braces is prose');
  ok(l2.includes('meta.constraint.natural-language.spex') && !l2.includes('comment.block'), '/* */ inside braces is prose');
}

// 7. escaped brace does not close the block
{
  const t = await tokenize('create A as from string select {\n  a \\} b\n};\nrealize X as Y;');
  ok(has(find(t, (x) => x.text === '\\}'), 'constant.character.escape.spex'), 'escaped brace scope');
  ok(has(find(t, (x) => x.text === '}' && x.scopes.some((s) => s.includes('select'))), 'punctuation.definition.select.end.spex'), 'block closes at unescaped brace');
  ok(!lineScopes(t, 3).includes('natural-language'), 'tokenization resumes after block');
}

// 8. regex literal: no keyword highlighting inside, flags scoped
{
  const t = await tokenize('create R as /create\\b/i;');
  const inRegex = find(t, (x) => x.text === 'create' && has(x, 'string.regexp.spex'));
  ok(inRegex && !has(inRegex, 'keyword.control.declaration.spex'), 'keyword inside regex is not a keyword');
  ok(has(find(t, (x) => x.text === 'i' && has(x, 'string.regexp.spex')), 'keyword.other.regexp.flag.spex'), 'regex flags');
  ok(has(find(t, (x) => x.text === '\\b'), 'constant.character.escape.spex'), 'regex escape');
}

// 9. empty pattern // and character class with quote
{
  const t = await tokenize('create R as //;\ncreate S as /[]\']/;');
  ok(find(t, (x) => has(x, 'string.regexp.spex')), 'empty pattern is regex');
  ok(!lineScopes(t, 0).includes('comment.line'), '// is not a line comment');
  ok(lineScopes(t, 1).includes('string.regexp.spex'), 'class with quote stays regex');
}

// 10. fences
{
  const t = await tokenize('create A as from number select ```python\nreturn 1\n```;\ncreate B as from number select ````\nnope\n````;');
  ok(lineScopes(t, 1).includes('meta.embedded.block.python'), 'fence embeds language');
  ok(has(find(t, (x) => x.text === '```'), 'punctuation.definition.fenced.spex'), 'closing fence');
  ok(!lineScopes(t, 4).includes('punctuation.definition.fenced.spex'), '4+ backticks is not a fence');
}
{
  const t = await tokenize('create A as from number select ```\nif x {\n}\n```;');
  ok(!lineScopes(t, 1).includes('keyword.control.declaration.spex'), 'SKIT content not Spex-keyworded');
  ok(has(find(t, (x) => x.text === '```'), 'punctuation.definition.fenced.spex'), 'SKIT fence opens and closes');
}

// 11. strings
{
  const t = await tokenize("x = 'it\\'s' and \"say \\\"hi\\\"\"");
  ok(has(find(t, (x) => x.text === "\\'"), 'constant.character.escape.spex'), 'single-quote escape');
  ok(lineScopes(t, 0).includes('string.quoted.single.spex') && lineScopes(t, 0).includes('string.quoted.double.spex'), 'both quote styles');
}

// 12. numbers
{
  const t = await tokenize('42 3.14 1. .5');
  ok(has(find(t, (x) => x.text === '42'), 'constant.numeric.spex'), 'integer');
  ok(has(find(t, (x) => x.text === '3.14'), 'constant.numeric.spex'), 'decimal');
  const dot = flat(t).filter((x) => x.text === '.');
  ok(dot.length === 2 && dot.every((x) => has(x, 'punctuation.accessor.spex')), '1. and .5 split at dot');
}

// 13. dotted refs and array suffix
{
  const t = await tokenize('create A as from string select {\n  see @types.EmailAddress\n};\ncreate B as string[][];');
  ok(has(find(t, (x) => x.text === '@types.EmailAddress'), 'variable.other.reference.spex'), 'dotted ref');
  ok(has(find(t, (x) => x.text === '['), 'punctuation.definition.bracket.spex'), 'array suffix');
}

// 14. import names
{
  const t = await tokenize('import Todo from "todo.spex";\ninclude "c.json" as config;');
  ok(has(find(t, (x) => x.text === 'Todo'), 'entity.name.import.spex'), 'imported name');
  ok(has(find(t, (x) => x.text === 'config'), 'entity.name.import.spex'), 'include alias');
}

// 15. set operators
{
  const t = await tokenize('A UNION B EXCEPT C;');
  ok(has(find(t, (x) => x.text === 'UNION'), 'keyword.operator.word.spex'), 'set operator');
}

// 16. comment markers inside strings are string content
{
  const t = await tokenize("x = '-- not a comment'");
  ok(!lineScopes(t, 0).includes('comment.line'), '-- inside string');
}

// parser accepts the fixture corpus
{
  const dir = path.join(root, 'test/fixtures');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.spex'))) {
    const error = checkText(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    ok(error === null, `parses ${f}${error ? ` (${error})` : ''}`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
