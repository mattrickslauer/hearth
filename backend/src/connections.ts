/**
 * Realtime connection registry — maps an API Gateway WebSocket `deviceId` to the account
 * (and hub) it belongs to, so that when a hub pushes readings we know which connected
 * browsers to fan them out to.
 *
 * Why this must be shared across instances: on Function Compute the /live/register call
 * (a browser connecting) and the /hub/devices call (its hub pushing) can land on DIFFERENT
 * instances. A per-instance Map would mean the pushing instance can't see the connection.
 * So the production path is Tablestore (durable, multi-instance-safe) — same reasoning that
 * moved authored watches there. Memory is the dev/default fallback and works only within a
 * single instance (documented; fine for local dev and low-concurrency demos).
 *
 * Lifecycle: register on connect, remove on the gateway's UNREGISTER, and self-heal — the
 * push bridge drops any deviceId the gateway reports as gone. A long backstop TTL guards
 * against a missed unregister leaking a row forever.
 */

const CONN_TTL_MS = 2 * 60 * 60_000; // backstop: forget a connection unheard-of for 2h

export interface Connection {
  deviceId: string;
  accountId: string;
  hubId: string;
  ts: number;
}

export interface ConnectionStore {
  register(deviceId: string, accountId: string, hubId: string): Promise<void>;
  remove(deviceId: string): Promise<void>;
  /** Live (non-stale) device ids currently connected for an account. */
  listDevices(accountId: string): Promise<string[]>;
}

class MemoryConnectionStore implements ConnectionStore {
  private byDevice = new Map<string, Connection>();

  async register(deviceId: string, accountId: string, hubId: string) {
    this.byDevice.set(deviceId, { deviceId, accountId, hubId, ts: Date.now() });
  }
  async remove(deviceId: string) {
    this.byDevice.delete(deviceId);
  }
  async listDevices(accountId: string) {
    const cutoff = Date.now() - CONN_TTL_MS;
    const out: string[] = [];
    for (const c of this.byDevice.values()) {
      if (c.ts < cutoff) {
        this.byDevice.delete(c.deviceId);
        continue;
      }
      if (c.accountId === accountId) out.push(c.deviceId);
    }
    return out;
  }
}

/* -------------------------------------------------------------- Tablestore adapter */

const TS_TABLE = 'hearth_home'; // shares the existing table; rows keyed sk = conn#<deviceId>

type TsAttr = { columnName: string; columnValue: unknown };
type TsModule = {
  Client: new (opts: object) => TsClient;
  Condition: new (existence: unknown, columnCondition: unknown) => unknown;
  RowExistenceExpectation: { IGNORE: unknown };
  Direction: { FORWARD: unknown };
};
type TsClient = {
  putRow(p: object): Promise<unknown>;
  deleteRow(p: object): Promise<unknown>;
  getRange(p: object): Promise<{ rows?: { primaryKey?: TsAttr[]; attributes: TsAttr[] }[]; next_start_primary_key?: unknown[] | null }>;
};

/**
 * Connections live under each account's partition (account = accountId, sk = conn#<deviceId>),
 * so listing an account's devices is one range scan — mirroring store.ts's watch rows.
 */
class TablestoreConnectionStore implements ConnectionStore {
  constructor(
    private readonly ts: TsModule,
    private readonly client: TsClient,
  ) {}

  private ignore() {
    return new this.ts.Condition(this.ts.RowExistenceExpectation.IGNORE, null);
  }

  async register(deviceId: string, accountId: string, hubId: string) {
    await this.client.putRow({
      tableName: TS_TABLE,
      condition: this.ignore(),
      primaryKey: [{ account: accountId }, { sk: `conn#${deviceId}` }],
      attributeColumns: [{ data: JSON.stringify({ hubId, ts: Date.now() }) }],
    });
  }

  async remove(deviceId: string) {
    // deviceId is UUID@AppKey; we don't know the account here, so a targeted delete needs
    // the account. The register path stores under the account partition, and unregister
    // carries the same ticket → account (server.ts passes it). See removeFor below.
    void deviceId;
  }

  /** Account-scoped delete (unregister knows the account from the ticket). */
  async removeFor(accountId: string, deviceId: string) {
    await this.client.deleteRow({
      tableName: TS_TABLE,
      condition: this.ignore(),
      primaryKey: [{ account: accountId }, { sk: `conn#${deviceId}` }],
    });
  }

  async listDevices(accountId: string) {
    const out: string[] = [];
    const cutoff = Date.now() - CONN_TTL_MS;
    // '$' (0x24) sorts just after '#' (0x23): [conn#, conn$) captures exactly the conn# rows.
    let start: unknown[] | null = [{ account: accountId }, { sk: 'conn#' }];
    const end = [{ account: accountId }, { sk: 'conn$' }];
    while (start) {
      const res = await this.client.getRange({
        tableName: TS_TABLE,
        direction: this.ts.Direction.FORWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        limit: 200,
      });
      for (const row of res.rows ?? []) {
        const sk = row.primaryKey?.find((a) => a.columnName === 'sk')?.columnValue;
        const data = row.attributes?.find((a) => a.columnName === 'data')?.columnValue;
        if (typeof sk !== 'string') continue;
        const deviceId = sk.slice('conn#'.length);
        let ts = 0;
        try {
          ts = typeof data === 'string' ? (JSON.parse(data).ts ?? 0) : 0;
        } catch {
          /* treat unparseable as stale */
        }
        if (ts >= cutoff) out.push(deviceId);
      }
      start = res.next_start_primary_key ?? null;
    }
    return out;
  }
}

let store: ConnectionStore | null = null;

/**
 * Singleton connection store, chosen by HEARTH_STORE (tablestore → durable/shared, else
 * memory). Tablestore uses the same credentials/instance as the home store.
 */
export async function getConnectionStore(): Promise<ConnectionStore> {
  if (store) return store;
  if (process.env.HEARTH_STORE === 'tablestore') {
    const mod = (await import('tablestore')) as unknown;
    const ts = ((mod as { default?: unknown }).default ?? mod) as TsModule;
    const client = new ts.Client({
      accessKeyId: envOne('ALI_ACCESS_KEY_ID', 'ALIBABA_ACCESS_KEY_ID'),
      secretAccessKey: envOne('ALI_ACCESS_KEY_SECRET', 'ALIBABA_ACCESS_KEY_SECRET'),
      endpoint: envOne('TABLESTORE_ENDPOINT'),
      instancename: envOne('TABLESTORE_INSTANCE'),
    });
    store = new TablestoreConnectionStore(ts, client);
  } else {
    store = new MemoryConnectionStore();
  }
  return store;
}

/** Account-scoped removal that works for both stores (memory ignores the account). */
export async function removeConnection(accountId: string, deviceId: string): Promise<void> {
  const s = await getConnectionStore();
  if (s instanceof TablestoreConnectionStore) return s.removeFor(accountId, deviceId);
  return s.remove(deviceId);
}

function envOne(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`missing env ${names.join('/')} (required for HEARTH_STORE=tablestore)`);
}
