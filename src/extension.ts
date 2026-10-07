import * as vscode from 'vscode';
import {
  computeSemanticTokens,
  TOKEN_MODIFIERS,
  TOKEN_TYPES,
} from './semantic';
import { registerDiagnostics } from './diagnostics';

export function activate(context: vscode.ExtensionContext): void {
  registerDiagnostics(context);
  const legend: vscode.SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
  };

  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(document) {
      const builder = new vscode.SemanticTokensBuilder(legend);
      for (const token of computeSemanticTokens(document.getText())) {
        const start = document.positionAt(token.start);
        const end = document.positionAt(token.start + token.length);
        if (start.line !== end.line) continue;
        builder.push(
          new vscode.Range(start, end),
          token.type,
          token.modifier ? [token.modifier] : []
        );
      }
      return builder.build();
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      'spex',
      provider,
      legend
    )
  );
}

export function deactivate(): void {}
