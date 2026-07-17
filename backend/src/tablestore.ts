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

/** The one shared table: PK [account:STRING, sk:STRING], attr `data`:STRING (JSON blob).
 *  Per-account rows use the accountId as partition; global registries use a reserved
 *  partition (e.g. "_hubs"). Auto-created by ensureHomeTable() on first use. */
export const HOME_TABLE = 'hearth_home';

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
    const built = (async () => {
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
    handle = built;
    // A rejected import/config must not be cached forever: clear the singleton on failure so the
    // next call retries (e.g. after the SDK is installed or env is fixed) instead of re-throwing.
    void built.catch(() => {
      if (handle === built) handle = null;
    });
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

/** A row read back from a range scan: its primary key and attribute columns as plain maps. */
export interface TsRangeRow {
  pk: Record<string, TsScalar>;
  attrs: Record<string, TsScalar>;
}

/**
 * Scan rows in [start, end) primary-key order, paging until exhausted. `start`/`end` are
 * ordered PK maps (same shape as the single-row ops), e.g. { account: '_hubs', sk: 'h#' } →
 * { account: '_hubs', sk: 'h$' } to sweep one partition's `h#…` rows. Small collections only.
 */
export async function tsGetRange(
  tableName: string,
  start: Record<string, TsScalar>,
  end: Record<string, TsScalar>,
  limit = 500,
): Promise<TsRangeRow[]> {
  const { TableStore, client } = await getTablestore();
  const out: TsRangeRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let startPk: any = kv(TableStore, start);
  const endPk = kv(TableStore, end);
  while (startPk) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await new Promise((resolve, reject) => {
      client.getRange(
        {
          tableName,
          direction: TableStore.Direction.FORWARD,
          inclusiveStartPrimaryKey: startPk,
          exclusiveEndPrimaryKey: endPk,
          limit,
        },
        (err: unknown, d: unknown) => (err ? reject(err) : resolve(d)),
      );
    });
    for (const row of data?.rows ?? []) {
      const pk: Record<string, TsScalar> = {};
      const attrs: Record<string, TsScalar> = {};
      for (const p of row.primaryKey ?? []) pk[p.name] = fromCell(p.value);
      for (const a of row.attributes ?? []) attrs[a.columnName] = fromCell(a.columnValue);
      out.push({ pk, attrs });
    }
    startPk = data?.next_start_primary_key ?? null;
  }
  return out;
}

/**
 * Create a table if it doesn't already exist (idempotent). Reserved-CU=0, single version.
 * `timeToLive` defaults to -1 (never expires); pass a positive seconds value for tables whose
 * rows should self-expire server-side (e.g. store.ts's readings=24h, runs=365d) — no sweeper.
 */
export async function ensureTable(tableName: string, pkNames: string[], timeToLive = -1): Promise<void> {
  const { TableStore, client } = await getTablestore();
  await new Promise<void>((resolve, reject) => {
    client.createTable(
      {
        tableMeta: { tableName, primaryKey: pkNames.map((name) => ({ name, type: 'STRING' })) },
        reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
        tableOptions: { timeToLive, maxVersions: 1 },
      },
      (err: unknown) => {
        const msg = (err as { message?: string })?.message || String(err ?? '');
        if (err && !/already exist/i.test(msg)) reject(err);
        else resolve();
      },
    );
  });
}

/** Ensure the shared home table exists. Cheap + idempotent; call before first use. */
let homeTableReady: Promise<void> | null = null;
export function ensureHomeTable(): Promise<void> {
  if (!homeTableReady) {
    homeTableReady = ensureTable(HOME_TABLE, ['account', 'sk']);
    // Clear the cache on failure so a transient create error retries instead of caching a reject.
    void homeTableReady.catch(() => {
      homeTableReady = null;
    });
  }
  return homeTableReady;
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
