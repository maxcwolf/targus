import { getTableName, type Table } from 'drizzle-orm';
import { getTableConfig as postgresConfig, type PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as sqliteConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as sqlite from '../../src/db/schema.ts';
import * as postgres from '../../src/postgres/schema.ts';

// The two schemas are written by hand, one per dialect (ADR 0044). This is what keeps them the
// same database: a table, column, index or foreign key added to one and not the other fails here.

/** What both dialects' `getTableConfig` return, as far as this comparison reads it. */
interface TableConfig {
  readonly name: string;
  readonly columns: readonly {
    readonly name: string;
    readonly notNull: boolean;
    readonly primary: boolean;
    readonly hasDefault: boolean;
  }[];
  readonly indexes: readonly {
    readonly config: {
      readonly name?: string;
      readonly unique?: boolean;
      readonly where?: unknown;
      readonly columns: readonly object[];
    };
  }[];
  readonly primaryKeys: readonly { readonly columns: readonly { readonly name: string }[] }[];
  readonly foreignKeys: readonly {
    readonly reference: () => {
      readonly columns: readonly { readonly name: string }[];
      readonly foreignColumns: readonly { readonly name: string }[];
      readonly foreignTable: Table;
    };
  }[];
}

const nameOf = (column: object): string =>
  'name' in column && typeof column.name === 'string' ? column.name : 'expression';

function shapeOf(config: TableConfig) {
  return {
    columns: Object.fromEntries(
      config.columns.map(({ name, notNull, primary, hasDefault }) => [
        name,
        { notNull, primary, hasDefault },
      ]),
    ),
    indexes: Object.fromEntries(
      config.indexes.map(({ config: index }) => [
        index.name ?? 'unnamed',
        {
          unique: index.unique === true,
          partial: index.where !== undefined,
          columns: index.columns.map(nameOf),
        },
      ]),
    ),
    primaryKeys: config.primaryKeys.map((key) => key.columns.map(nameOf)),
    foreignKeys: config.foreignKeys
      .map((key) => {
        const { columns, foreignColumns, foreignTable } = key.reference();
        const from = columns.map(nameOf).join(',');
        const to = foreignColumns.map(nameOf).join(',');
        return `${from} -> ${getTableName(foreignTable)}(${to})`;
      })
      .sort(),
  };
}

type Rows<Schema> = {
  [Name in keyof Schema]: Schema[Name] extends { $inferSelect: infer Row } ? Row : never;
};

const tables = Object.keys(sqlite) as (keyof typeof sqlite)[];

describe('the Postgres schema', () => {
  it('declares the tables of the SQLite schema, under the same exports and row types', () => {
    expect(Object.keys(postgres).sort()).toEqual([...tables].sort());
    expectTypeOf<Rows<typeof postgres>>().toEqualTypeOf<Rows<typeof sqlite>>();
  });

  it.each(tables)('gives %s the same name, columns, indexes and keys', (table) => {
    const sqliteTable: TableConfig = sqliteConfig(sqlite[table] as SQLiteTable);
    const postgresTable: TableConfig = postgresConfig(postgres[table] as PgTable);

    expect(postgresTable.name).toBe(sqliteTable.name);
    expect(shapeOf(postgresTable)).toEqual(shapeOf(sqliteTable));
  });
});
