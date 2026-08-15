// Gemeinsame Typen zwischen Backend und UI.

export type Coverage = 'matched' | 'no-rule' | 'port-static' | 'off-switch';

export interface Asset {
  mac: string;
  macDisplay: string;
  hostname: string;
  ipv4: string;
  vendor: string;
  type: string;
  family: string;
  os: string;
  osVersion: string;
  hostSrc: string;
  purdueLevel: string;
  dhcpStatus: string;
  detectedInterface: string;
  online: boolean;
  lastSeen: number | null;
  known: boolean;

  switchId: string;
  portName: string;
  portId: number | null;
  vlanId: number | null;
  onSwitch: boolean;

  accessMode: string;
  portPolicy: string;
  portTags: string[];

  matchedDpp: string;
  matchedRule: string;
  matchedNacPolicy: string;
  macPolicy: string;
  isDynamic: boolean;
  isNac: boolean;

  coverage: Coverage;
  raw: Record<string, unknown>;
}

export interface InventoryCounts {
  total: number;
  online: number;
  onSwitch: number;
  matched: number;
  noRule: number;
  portStatic: number;
  offSwitch: number;
  unidentified: number;
}

export interface Inventory {
  assets: Asset[];
  fields: { key: string; kind: string; count: number; sample: unknown }[];
  warnings: { source: string; status: number; message: string }[];
  counts: InventoryCounts;
  /** true, wenn das Inventar an der Obergrenze abgeschnitten wurde. */
  truncated?: boolean;
  fetchedAt: string;
}

export interface Session {
  connected: boolean;
  host?: string;
  vdom?: string;
  verifyTls?: boolean;
  readOnly?: boolean;
  demo?: boolean;
  info?: { hostname?: string; version?: string; build?: number; serial?: string; model?: string } | null;
  connectionId?: string | null;
  connectionName?: string | null;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  vdom: string;
  verifyTls: boolean;
  readOnly: boolean;
  hasToken: boolean;
  createdAt: string;
}

// --- FortiOS-Objekte -------------------------------------------------------

export interface Member {
  [k: string]: string;
}

export interface DppRule {
  name: string;
  description?: string;
  status?: 'enable' | 'disable';
  category?: 'device' | 'interface-tag';
  'match-type'?: 'dynamic' | 'override';
  'match-period'?: number;
  'match-remove'?: 'default' | 'link-down';
  'interface-tags'?: Member[];
  mac?: string;
  'hw-vendor'?: string;
  type?: string;
  family?: string;
  host?: string;
  'lldp-profile'?: string;
  'qos-policy'?: string;
  '802-1x'?: string;
  'vlan-policy'?: string;
  'bounce-port-link'?: 'enable' | 'disable';
  'bounce-port-duration'?: number;
  'poe-reset'?: 'enable' | 'disable';
  [k: string]: unknown;
}

export interface Dpp {
  name: string;
  description?: string;
  fortilink?: string;
  policy?: DppRule[];
  [k: string]: unknown;
}

export interface VlanPolicy {
  name: string;
  description?: string;
  fortilink?: string;
  vlan?: string;
  'allowed-vlans'?: Member[];
  'untagged-vlans'?: Member[];
  'allowed-vlans-all'?: 'enable' | 'disable';
  'discard-mode'?: 'none' | 'all-untagged' | 'all-tagged';
  [k: string]: unknown;
}

export interface SwitchPort {
  'port-name': string;
  description?: string;
  status?: string;
  'access-mode'?: 'static' | 'nac' | 'dynamic';
  'port-policy'?: string;
  'matched-dpp-policy'?: string;
  'matched-dpp-intf-tags'?: string;
  'interface-tags'?: Member[];
  vlan?: string;
  'poe-status'?: string;
  [k: string]: unknown;
}

export interface ManagedSwitch {
  'switch-id': string;
  sn?: string;
  description?: string;
  ports?: SwitchPort[];
  [k: string]: unknown;
}

export interface SystemInterface {
  name: string;
  /** physical | vlan | aggregate | redundant | … — es gibt KEINEN Typ "fortilink". */
  type?: string;
  vlanid?: number;
  /** Uebergeordnete Schnittstelle bei VLANs. */
  interface?: string;
  ip?: string;
  status?: string;
  alias?: string;
  description?: string;
  /** Das eigentliche FortiLink-Kennzeichen. */
  fortilink?: 'enable' | 'disable';
  role?: string;
  'switch-controller-feature'?: string;
}

/** Operativer Portzustand aus dem Monitor – nicht zu verwechseln mit ports.status aus der CMDB. */
export interface PortStatus {
  /** Link-Zustand laut FortiSwitch: "up" | "down". */
  link: string;
  /** Aushandelte Geschwindigkeit in Mbit/s. */
  speed: number | null;
  duplex: string | null;
  poeStatus: string | null;
  poeCapable: boolean;
  portPower: number | null;
  powerStatus: number | null;
  stp: string | null;
  isFortiLink: boolean;
  islPeer: string | null;
}

export interface KnownCriteria {
  name: string;
  description: string;
  device: { hw_vendor?: string; type?: string; family?: string; os?: string; host?: string };
}

export interface RefData {
  'switch-controller/dynamic-port-policy': { results: Dpp[]; error?: string };
  'switch-controller/vlan-policy': { results: VlanPolicy[]; error?: string };
  'switch-controller/lldp-profile': { results: { name: string }[]; error?: string };
  'switch-controller/switch-interface-tag': { results: { name: string }[]; error?: string };
  'switch-controller.qos/qos-policy': { results: { name: string }[]; error?: string };
  'switch-controller.security-policy/802-1X': { results: { name: string }[]; error?: string };
  'switch-controller/managed-switch': { results: ManagedSwitch[]; error?: string };
  'system/interface': { results: SystemInterface[]; error?: string };
  _nacStats: { vdom_count: number; total_count: number; max_limit: number } | null;
  _knownCriteria: KnownCriteria[];
  /** Indiziert als "switchId|portName". */
  _portStatus: Record<string, PortStatus>;
}

// --- Changeset -------------------------------------------------------------

export type OpKind = 'create' | 'modify' | 'delete' | 'move';

export interface Op {
  id: string;
  kind: OpKind;
  table: string;
  mkey: string;
  idField?: string;
  child?: { table: string; mkey: string; idField?: string } | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  move?: { position: 'before' | 'after'; ref: string } | null;
  label: string;
}

export interface ValidationIssue {
  opId: string | null;
  field?: string | null;
  message: string;
  label?: string;
}

export interface ValidateResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ordered: string[];
  cli: string;
}

export interface ApplyResultRow {
  id: string;
  label: string;
  status: 'applied' | 'failed' | 'conflict' | 'skipped';
  message: string | null;
  detail?: unknown;
  httpStatus?: number;
}

export interface ApplyResult {
  results: ApplyResultRow[];
  appliedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  revertable: Op[];
}

// --- Audit -----------------------------------------------------------------

export interface AuditOp {
  kind: OpKind;
  table: string;
  mkey: string;
  child: string | null;
  status: string;
  message: string | null;
}

export interface AuditEntry {
  at: string;
  event: string;
  host?: string | null;
  vdom?: string | null;
  profile?: string | null;
  demo?: boolean;
  from?: string | null;
  error?: string;
  counts?: { applied: number; failed: number; conflict?: number; skipped?: number };
  operations?: AuditOp[];
  cli?: string;
}

// --- Schema ----------------------------------------------------------------

export interface SchemaField {
  name: string;
  category: 'unitary' | 'table' | 'complex';
  type?: string;
  help?: string;
  size?: number;
  default?: unknown;
  required?: boolean;
  options?: { name: string; help?: string }[];
  datasource?: string[];
  'min-value'?: number;
  'max-value'?: number;
  mkey?: string;
  children?: Record<string, SchemaField>;
}

export interface SchemaTable extends SchemaField {
  max_table_size_vdom?: number;
}

export interface SchemaBundle {
  source: 'live' | 'local';
  version: string | null;
  build: number | null;
  tables: Record<string, SchemaTable>;
}
