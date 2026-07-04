/**
 * Shared Alibaba Tablestore client + tiny promisified row helpers.
 *
 * The `tablestore` SDK (v5) is an optional dependency, callback-based, and ships
 * no types (see src/types/optional-deps.d.ts → declared `any`). This module is the
 * one place that touches it: it lazily imports the SDK, builds a singleton client
 * from env, and exposes four promisified row ops that speak plain JS values —
 * integers are wrapped as int64 (`Long`) on write and coerced back to `number` on
 * read, so callers (auth.ts, store.ts) never see SDK internals.
 *
 * Config comes from the same env vars store.ts already documents:
 *   TABLESTORE_ENDPOINT, TABLESTORE_INSTANCE, ALI_ACCESS_KEY_ID/ALIBABA_ACCESS_KEY_ID,
 *   ALI_ACCESS_KEY_SECRET/ALIBABA_ACCESS_KEY_SECRET.
 *
 * We do NOT create tables — they're provisioned at deploy (see backend/README.md).
 * A missing table surfaces as a loud SDK error rather than silent fake behavior.
 */

export type TsScalar = number | string | boolean;

export interface TablestoreConfig {
  endpoint: string;
  instance: string;
  accessKeyId: string;
  accessKeySecret: string;
}

/** First present env var among the given names, else throw with a clear hint. */
function must(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`missing env ${names.join('/')} (required for HEARTH_STORE=tablestore)`);
}

export function tablestoreConfig(): TablestoreConfig {
  return {
    endpoint: must('TABLESTORE_ENDPOINT'),
    instance: must('TABLESTORE_INSTANCE'),
    accessKeyId: must('ALI_ACCESS_KEY_ID', 'ALIBABA_ACCESS_KEY_ID'),
    accessKeySecret: must('ALI_ACCESS_KEY_SECRET', 'ALIBABA_ACCESS_KEY_SECRET'),
  };
}

interface Handle {
  TableStore: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  client: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let handle: Promise<Handle> | null = null;

/** Lazily import the SDK and build a singleton client. */
export function getTablestore(): Promise<Handle> {
  if (!handle) {
    handle = (async () => {
      let mod: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        mod = await import('tablestore');
      } catch {
        throw new Error(
          "Tablestore selected but the 'tablestore' SDK is not installed. Run `npm i tablestore` in backend/, " +
            'or unset HEARTH_STORE=tablestore to use the in-memory store.',
        );
      }
      const TableStore = mod?.default ?? mod;
      const cfg = tablestoreConfig();
      const client = new TableStore.Client({
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.accessKeySecret,
        endpoint: cfg.endpoint,
        instancename: cfg.instance,
      });
      return { TableStore, client };
    })();
  }
  return handle;
}

/** Wrap a JS scalar for the SDK: integers → int64 (Long), everything else as-is. */
function toCell(TableStore: any, v: TsScalar): unknown {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return typeof v === 'number' && Number.isInteger(v) ? TableStore.Long.fromNumber(v) : v;
}

/** Coerce a value read back from the SDK: int64 objects → number, else pass through. */
function fromCell(v: unknown): TsScalar {
  if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    return (v as { toNumber(): number }).toNumber();
  }
  return v as TsScalar;
}

const kv = (TableStore: any, o: Record<string, TsScalar>) =>
  // eslint-disable-line @typescript-eslint/no-explicit-any
  Object.entries(o).map(([k, v]) => ({ [k]: toCell(TableStore, v) }));

/** Read a row; returns its attribute columns as a plain map, or null if absent. */
export async function tsGetRow(
  tableName: string,
  primaryKey: Record<string, TsScalar>,
): Promise<Record<string, TsScalar> | null> {
  const { TableStore, client } = await getTablestore();
  const data: any = await new Promise((resolve, reject) => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    client.getRow(
      { tableName, primaryKey: kv(TableStore, primaryKey), maxVersions: 1 },
      (err: unknown, d: unknown) => (err ? reject(err) : resolve(d)),
    );
  });
  const attrs: Array<{ columnName: string; columnValue: unknown }> | undefined = data?.row?.attributes;
  if (!attrs || attrs.length === 0) return null;
  const out: Record<string, TsScalar> = {};
  for (const a of attrs) out[a.columnName] = fromCell(a.columnValue);
  return out;
}

/** Insert-or-overwrite a row (RowExistenceExpectation.IGNORE). */
export async function tsPutRow(
  tableName: string,
  primaryKey: Record<string, TsScalar>,
  attributes: Record<string, TsScalar>,
): Promise<void> {
  const { TableStore, client } = await getTablestore();
  await new Promise<void>((resolve, reject) => {
    client.putRow(
      {
        tableName,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
        primaryKey: kv(TableStore, primaryKey),
        attributeColumns: kv(TableStore, attributes),
      },
      (err: unknown) => (err ? reject(err) : resolve()),
    );
  });
}

/** PUT a subset of attribute columns on an existing (or new) row. */
export async function tsUpdatePut(
  tableName: string,
  primaryKey: Record<string, TsScalar>,
  attributes: Record<string, TsScalar>,
): Promise<void> {
  const { TableStore, client } = await getTablestore();
  await new Promise<void>((resolve, reject) => {
    client.updateRow(
      {
        tableName,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
        primaryKey: kv(TableStore, primaryKey),
        updateOfAttributeColumns: [{ PUT: kv(TableStore, attributes) }],
      },
      (err: unknown) => (err ? reject(err) : resolve()),
    );
  });
}

/** Delete a row (no-op if absent). */
export async function tsDeleteRow(tableName: string, primaryKey: Record<string, TsScalar>): Promise<void> {
  const { TableStore, client } = await getTablestore();
  await new Promise<void>((resolve, reject) => {
    client.deleteRow(
      {
        tableName,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
        primaryKey: kv(TableStore, primaryKey),
      },
      (err: unknown) => (err ? reject(err) : resolve()),
    );
  });
}
