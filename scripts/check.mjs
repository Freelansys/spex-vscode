import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToAst } from 'spex-parser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkText(text, label = '<input>') {
  try {
    parseToAst(text);
    return null;
  } catch (err) {
    const loc = err?.location ?? err?.underlying?.location;
    const where = loc ? `:${loc.start.line}:${loc.start.column}` : '';
    return `${label}${where}: ${err.message}`;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const files = arg
    ? [path.resolve(arg)]
    : fs
        .readdirSync(path.join(root, 'test/fixtures'))
        .filter((f) => f.endsWith('.spex'))
        .map((f) => path.join(root, 'test/fixtures', f));
  let failed = 0;
  for (const file of files) {
    const error = checkText(fs.readFileSync(file, 'utf8'), path.relative(root, file));
    if (error) {
      failed++;
      console.error(`FAIL ${error}`);
    } else {
      console.log(`OK   ${path.relative(root, file)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
