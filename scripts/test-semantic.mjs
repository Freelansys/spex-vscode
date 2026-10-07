import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'out/semantic.test.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'src/semantic.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const { computeSemanticTokens } = await import(pathToFileURL(outfile));

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

function makeHelpers(source, tokens) {
  const slice = (t) => source.slice(t.start, t.start + t.length);
  return {
    exact: (text, pred = () => true) =>
      tokens.filter((t) => slice(t) === text).find(pred),
    has: (needle) => {
      const idx = source.indexOf(needle);
      return idx >= 0 && tokens.some((t) => t.start === idx);
    },
    at: (idx) => tokens.find((t) => t.start === idx),
  };
}

{
  const source = fs.readFileSync(path.join(root, 'test/fixtures/sample.spex'), 'utf8');
  const tokens = computeSemanticTokens(source);
  const h = makeHelpers(source, tokens);

  const decl = tokens.filter((t) => t.modifier === 'declaration');
  ok(decl.length === 8, `eight declaration sites (got ${decl.length})`);
  ok(h.exact('TodoId', (t) => t.modifier === 'declaration') !== undefined, 'create TodoId declared');
  ok(h.exact('TodoId', (t) => !t.modifier)?.type === 'type', 'TodoId reference is type');
  ok(h.exact('Todo', (t) => !t.modifier)?.type === 'type', 'Todo reference in product is type');
  ok(h.at(source.indexOf('@title') + 1)?.type === 'parameter', '@title resolves to parameter');
  ok(h.at(source.indexOf('@CreateTodo') + 1) === undefined, '@CreateTodo unresolved -> no token');
  ok(h.exact('string') === undefined, 'builtin string skipped');
  ok(h.exact('Cli') === undefined, 'unresolved Cli skipped');
  ok(h.exact('TodoWeb') === undefined, 'unresolved generate name skipped');
  ok(tokens.every((t, i) => i === 0 || tokens[i - 1].start <= t.start), 'tokens sorted by offset');
  ok(tokens.every((t) => t.length > 0 && t.start >= 0 && t.start + t.length <= source.length), 'tokens in bounds');
}

{
  const source = fs.readFileSync(path.join(root, 'test/fixtures/edges.spex'), 'utf8');
  const tokens = computeSemanticTokens(source);
  const h = makeHelpers(source, tokens);

  ok(h.exact('Email', (t) => t.modifier === 'declaration') !== undefined, 'edges: Email declared');
  ok(h.exact('Email', (t) => !t.modifier)?.type === 'type', 'edges: Email ref in Fn is type');
  ok(h.exact('config', (t) => t.modifier === 'declaration') !== undefined, 'edges: import alias declared');
  ok(!h.has('types.EmailAddress'), 'edges: unresolved dotted path skipped');
}

{
  const broken = computeSemanticTokens('create in as string;');
  ok(Array.isArray(broken) && broken.length === 0, 'parse error -> no tokens');
  const brokenMidFile = computeSemanticTokens('create Ok as string;\ncreate ??? bad;');
  ok(brokenMidFile.length === 0, 'lex error mid-file -> no tokens');
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
