import * as vscode from 'vscode';
import { parseError } from './semantic';

const DEBOUNCE_MS = 300;

export function registerDiagnostics(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection('spex');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const update = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'spex') return;
    const error = parseError(document.getText());
    if (!error) {
      collection.set(document.uri, []);
      return;
    }
    const start = document.positionAt(error.start.offset);
    const end = document.positionAt(
      Math.max(error.end.offset, error.start.offset + 1)
    );
    collection.set(document.uri, [
      new vscode.Diagnostic(
        new vscode.Range(start, end),
        error.message,
        vscode.DiagnosticSeverity.Error
      ),
    ]);
  };

  const schedule = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'spex') return;
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === key
        );
        if (doc) update(doc);
      }, DEBOUNCE_MS)
    );
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidOpenTextDocument((d) => update(d)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      const key = d.uri.toString();
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      collection.delete(d.uri);
    }),
    {
      dispose: () => {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      },
    }
  );

  for (const document of vscode.workspace.textDocuments) update(document);

  return collection;
}
