// @ts-check
// Reads a port's methods from its TypeScript source, so a generated adapter stubs exactly the
// methods the port has today and the generator never keeps a copy of them.
import { readFileSync } from 'node:fs';

import ts from 'typescript';

/**
 * @typedef {{ readonly name: string; readonly async: boolean }} PortMethod
 * `async` when the port's return type is a `Promise`.
 */

/**
 * @param {ts.TypeElement} member
 * @param {ts.SourceFile} source
 * @param {string} type
 * @returns {PortMethod}
 */
function toMethod(member, source, type) {
  if (!ts.isMethodSignature(member) || member.type === undefined) {
    throw new Error(
      `${type}: only methods with a return type can be stubbed, found "${member.getText(source)}"`,
    );
  }
  return {
    name: member.name.getText(source),
    async: /^Promise\s*</.test(member.type.getText(source)),
  };
}

/**
 * The methods of interface `type` in `file`, those of the interfaces it extends first, each
 * name once; optional properties are skipped (a redeclared or overloaded method keeps its first position).
 * @param {string} file absolute path
 * @param {string} type
 * @param {(base: string) => PortMethod[]} methodsOfBase methods of an extended interface
 * @returns {PortMethod[]}
 */
export function portMethods(file, type, methodsOfBase) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements
    .filter(ts.isInterfaceDeclaration)
    .find((statement) => statement.name.text === type);
  if (declaration === undefined) throw new Error(`no interface ${type} in ${file}`);
  const inherited = (declaration.heritageClauses ?? [])
    .flatMap((clause) => clause.types)
    .flatMap((base) => methodsOfBase(base.expression.getText(source)));
  // An optional property (a capability flag such as `supportsModes`) can be left out of an
  // adapter, so there is nothing to stub.
  const own = declaration.members
    .filter((member) => !(ts.isPropertySignature(member) && member.questionToken !== undefined))
    .map((member) => toMethod(member, source, type));
  /** @type {Map<string, PortMethod>} */
  const byName = new Map();
  for (const method of [...inherited, ...own]) byName.set(method.name, method);
  return [...byName.values()];
}
