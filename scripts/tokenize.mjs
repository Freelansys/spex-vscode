import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const { createOnigScanner, createOnigString, loadWASM } = oniguruma;
const { Registry, INITIAL } = textmate;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm');
const grammarPath = path.join(root, 'syntaxes/spex.tmLanguage.json');

const wasmBin = fs.readFileSync(wasmPath).buffer;
await loadWASM(wasmBin);

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => createOnigScanner(patterns),
    createOnigString: (str) => createOnigString(str),
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName === 'source.spex') {
      return JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
    }
    return { scopeName, patterns: [], repository: {} };
  },
});

export async function tokenize(text) {
  const grammar = await registry.loadGrammar('source.spex');
  const lines = text.split('\n');
  let ruleStack = INITIAL;
  const result = [];
  for (const line of lines) {
    const { tokens, ruleStack: nextStack } = grammar.tokenizeLine(line, ruleStack);
    ruleStack = nextStack;
    result.push(
      tokens.map((t) => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
      }))
    );
  }
  return result;
}

export function printTokens(lines) {
  for (let i = 0; i < lines.length; i++) {
    console.log(`--- line ${i + 1}`);
    for (const t of lines[i]) {
      if (!t.text.trim()) continue;
      console.log(`  ${JSON.stringify(t.text).padEnd(30)} ${t.scopes.join(' ')}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const text = arg ? fs.readFileSync(path.resolve(arg), 'utf8') : process.argv[3] ?? '';
  printTokens(await tokenize(text));
}
