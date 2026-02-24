import { Parser, Language, type Node as SyntaxNode } from "web-tree-sitter";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAMMARS_DIR = join(__dirname, "../../grammars");

export interface ParsedSymbol {
  name: string;
  type: "function" | "class" | "interface" | "type_alias" | "variable";
  startLine: number;
  endLine: number;
  signature: string;
  body: string;
  exported: boolean;
}

export interface ParsedFile {
  path: string;
  symbols: ParsedSymbol[];
  imports: ImportInfo[];
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  startLine: number;
}

let parserReady: Promise<void> | null = null;
let tsLanguage: InstanceType<typeof Language> | null = null;
let tsxLanguage: InstanceType<typeof Language> | null = null;

async function ensureInit(): Promise<void> {
  if (parserReady) return parserReady;
  parserReady = (async () => {
    await Parser.init({
      locateFile: (scriptName: string) => {
        return join(
          dirname(fileURLToPath(import.meta.url)),
          "../../node_modules/web-tree-sitter",
          scriptName
        );
      },
    });
    tsLanguage = await Language.load(join(GRAMMARS_DIR, "tree-sitter-typescript.wasm"));
    tsxLanguage = await Language.load(join(GRAMMARS_DIR, "tree-sitter-tsx.wasm"));
  })();
  return parserReady;
}

export async function parseFile(filePath: string, content?: string): Promise<ParsedFile> {
  await ensureInit();

  const source = content ?? await readFile(filePath, "utf-8");
  const isTsx = filePath.endsWith(".tsx");

  const parser = new Parser();
  parser.setLanguage(isTsx ? tsxLanguage! : tsLanguage!);

  const tree = parser.parse(source);
  const root = tree.rootNode;

  const symbols: ParsedSymbol[] = [];
  const imports: ImportInfo[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;
    extractFromNode(node, symbols, imports);
  }

  return { path: filePath, symbols, imports };
}

function extractFromNode(
  node: SyntaxNode,
  symbols: ParsedSymbol[],
  imports: ImportInfo[]
): void {
  const type = node.type;

  if (type === "import_statement") {
    const imp = extractImport(node);
    if (imp) imports.push(imp);
    return;
  }

  if (type === "export_statement") {
    const declaration = node.childForFieldName("declaration") ?? findDeclarationChild(node);
    if (declaration) {
      const sym = extractDeclaration(declaration, true);
      if (sym) symbols.push(...sym);
    }
    return;
  }

  const sym = extractDeclaration(node, false);
  if (sym) symbols.push(...sym);
}

function findDeclarationChild(node: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    const t = child.type;
    if (
      t === "function_declaration" ||
      t === "class_declaration" ||
      t === "interface_declaration" ||
      t === "type_alias_declaration" ||
      t === "lexical_declaration" ||
      t === "variable_declaration"
    ) {
      return child;
    }
  }
  return null;
}

function extractDeclaration(
  node: SyntaxNode,
  exported: boolean
): ParsedSymbol[] | null {
  const t = node.type;

  if (t === "function_declaration") {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    return [{
      name,
      type: "function",
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: extractFunctionSignature(node),
      body: node.text,
      exported,
    }];
  }

  if (t === "class_declaration") {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    return [{
      name,
      type: "class",
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: extractClassSignature(node),
      body: node.text,
      exported,
    }];
  }

  if (t === "interface_declaration") {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    return [{
      name,
      type: "interface",
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `interface ${name}`,
      body: node.text,
      exported,
    }];
  }

  if (t === "type_alias_declaration") {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    return [{
      name,
      type: "type_alias",
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: node.text.split("=")[0]?.trim() ?? `type ${name}`,
      body: node.text,
      exported,
    }];
  }

  if (t === "lexical_declaration" || t === "variable_declaration") {
    const results: ParsedSymbol[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === "variable_declarator") {
        const name = child.childForFieldName("name")?.text ?? "anonymous";
        const value = child.childForFieldName("value");
        const isArrowFn = value?.type === "arrow_function";

        results.push({
          name,
          type: isArrowFn ? "function" : "variable",
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: extractVariableSignature(node, child),
          body: node.text,
          exported,
        });
      }
    }
    return results.length > 0 ? results : null;
  }

  return null;
}

function extractFunctionSignature(node: SyntaxNode): string {
  const name = node.childForFieldName("name")?.text ?? "";
  const params = node.childForFieldName("parameters")?.text ?? "()";
  const returnType = node.childForFieldName("return_type")?.text ?? "";
  return `function ${name}${params}${returnType ? `: ${returnType.replace(/^:\s*/, "")}` : ""}`;
}

function extractClassSignature(node: SyntaxNode): string {
  const name = node.childForFieldName("name")?.text ?? "";
  let sig = `class ${name}`;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "class_heritage") {
      sig += ` ${child.text}`;
      break;
    }
  }
  return sig;
}

function extractVariableSignature(
  declNode: SyntaxNode,
  declaratorNode: SyntaxNode
): string {
  const kind = declNode.child(0)?.text ?? "const";
  const name = declaratorNode.childForFieldName("name")?.text ?? "";
  const typeAnnotation = declaratorNode.childForFieldName("type")?.text;
  return `${kind} ${name}${typeAnnotation ? `: ${typeAnnotation.replace(/^:\s*/, "")}` : ""}`;
}

function extractImport(node: SyntaxNode): ImportInfo | null {
  let source = "";
  const specifiers: string[] = [];
  let isTypeOnly = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "string" || child.type === "string_fragment") {
      source = child.text.replace(/['"]/g, "");
    }
    if (child.type === "import_clause") {
      for (let j = 0; j < child.childCount; j++) {
        const sub = child.child(j)!;
        if (sub.type === "named_imports") {
          for (let k = 0; k < sub.childCount; k++) {
            const spec = sub.child(k)!;
            if (spec.type === "import_specifier") {
              const name = spec.childForFieldName("name")?.text ?? spec.text;
              specifiers.push(name);
            }
          }
        }
        if (sub.type === "identifier") {
          specifiers.push(sub.text);
        }
      }
    }
    if (child.text === "type") {
      isTypeOnly = true;
    }
  }

  const sourceNode = node.childForFieldName("source");
  if (sourceNode) {
    source = sourceNode.text.replace(/['"]/g, "");
  }

  if (!source) return null;

  return { source, specifiers, isTypeOnly, startLine: node.startPosition.row + 1 };
}
