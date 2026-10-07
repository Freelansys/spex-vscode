import { parseToAst } from 'spex-parser';
import type {
  Decomposition,
  Location,
  ObjectExpression,
  SpexFile,
} from 'spex-parser';

export const TOKEN_TYPES = ['type', 'parameter', 'property'] as const;
export const TOKEN_MODIFIERS = ['declaration'] as const;

export type SemanticToken = {
  start: number;
  length: number;
  type: string;
  modifier?: string;
};

const BUILTINS = new Set([
  'artifact',
  'concept',
  'environment',
  'string',
  'number',
  'bool',
  'unit',
]);

const IDENT = '[a-zA-Z_][a-zA-Z0-9_]*';

function identifierAfter(
  source: string,
  location: Location,
  pattern: string
): { start: number; name: string } | null {
  const slice = source.slice(location.start.offset, location.end.offset);
  const m = new RegExp(pattern, 'i').exec(slice);
  if (!m || m[1] === undefined) return null;
  const name = m[1];
  const start = location.start.offset + m.index + m[0].length - name.length;
  return { start, name };
}

export function computeSemanticTokens(source: string): SemanticToken[] {
  let file: SpexFile;
  try {
    file = parseToAst(source);
  } catch {
    return [];
  }

  const tokens: SemanticToken[] = [];
  const objectNames = new Set<string>();
  const fieldNames = new Set<string>();

  const push = (start: number, length: number, type: string, modifier?: string) => {
    tokens.push({ start, length, type, modifier });
  };

  const resolves = (name: string): boolean => {
    const head = name.split('.')[0];
    return objectNames.has(name) || objectNames.has(head);
  };

  const addDeclIdent = (
    location: Location,
    pattern: string,
    registry: Set<string>
  ) => {
    const id = identifierAfter(source, location, pattern);
    if (!id) return;
    push(id.start, id.name.length, 'type', 'declaration');
    registry.add(id.name);
  };

  const addRefIdent = (location: Location, pattern: string) => {
    const id = identifierAfter(source, location, pattern);
    if (!id || !resolves(id.name)) return;
    push(id.start, id.name.length, 'type');
  };

  const visitExpr = (expr: ObjectExpression): void => {
    switch (expr.kind) {
      case 'NamedObject':
        if (!BUILTINS.has(expr.name.toLowerCase()) && resolves(expr.name)) {
          push(
            expr.location.start.offset,
            expr.location.end.offset - expr.location.start.offset,
            'type'
          );
        }
        break;
      case 'ProductObject':
        for (const field of Object.keys(expr.fields)) fieldNames.add(field);
        for (const value of Object.values(expr.fields)) visitExpr(value);
        break;
      case 'ExponentialObject':
        visitExpr(expr.base);
        visitExpr(expr.exponent);
        break;
      case 'SubObject':
        visitExpr(expr.base);
        break;
      case 'ArrayObject':
        visitExpr(expr.base);
        break;
      case 'SetUnionObject':
      case 'SetIntersectionObject':
      case 'SetDifferenceObject':
      case 'CoproductObject':
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      default:
        break;
    }
  };

  const visitDecomposition = (decomposition: Decomposition): void => {
    for (const part of decomposition.parts) {
      const id = identifierAfter(source, part.location, `^\\s*(${IDENT})`);
      if (id) {
        push(id.start, id.name.length, 'property', 'declaration');
        fieldNames.add(id.name);
      }
      if (part.object.kind === 'Decomposition') {
        visitDecomposition(part.object);
      } else {
        visitExpr(part.object);
      }
    }
  };

  for (const decl of file.declarations) {
    if (decl.kind === 'ObjectDeclaration') {
      addDeclIdent(decl.location, `^\\s*create\\s+(${IDENT})`, objectNames);
    } else if (decl.kind === 'ImportDeclaration') {
      if (decl.name) {
        addDeclIdent(decl.location, `^\\s*(${IDENT})`, objectNames);
      }
      if (decl.alias) {
        addDeclIdent(decl.location, `\\bas\\s+(${IDENT})`, objectNames);
      }
    } else if (decl.kind === 'IncludeDeclaration') {
      addDeclIdent(decl.location, `\\bas\\s+(${IDENT})`, objectNames);
    }
  }

  for (const decl of file.declarations) {
    switch (decl.kind) {
      case 'ObjectDeclaration':
        visitExpr(decl.object);
        break;
      case 'RealizeDeclaration':
        visitExpr(decl.object);
        visitExpr(decl.environment);
        if (decl.target.kind === 'Decomposition') {
          visitDecomposition(decl.target);
        } else {
          visitExpr(decl.target);
        }
        break;
      case 'GenerateDeclaration':
        addRefIdent(decl.location, `^\\s*generate\\s+(${IDENT})`);
        visitExpr(decl.environment);
        break;
      default:
        break;
    }
  }

  const refPattern = new RegExp(`@(${IDENT}(?:\\.${IDENT})*)`, 'g');
  for (const m of source.matchAll(refPattern)) {
    const name = m[1];
    const start = m.index + 1;
    const head = name.split('.')[0];
    if (objectNames.has(name) || objectNames.has(head)) {
      push(start, name.length, 'type');
    } else if (fieldNames.has(name) || fieldNames.has(head)) {
      push(start, name.length, 'parameter');
    }
  }

  tokens.sort((a, b) => a.start - b.start || b.length - a.length);
  return tokens;
}
