// Duenner Fetch-Wrapper. Fehler kommen als ApiError mit Hinweistext aus dem
// Backend, damit die UI ueberall dieselbe Fehlerdarstellung nutzen kann.
import type {
  ApplyResult,
  ConnectionProfile,
  Inventory,
  Op,
  RefData,
  SchemaBundle,
  Session,
  ValidateResult,
} from './types';

export class ApiError extends Error {
  status: number;
  hint: string | null;
  detail: unknown;

  constructor(message: string, status: number, hint: string | null = null, detail: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.detail = detail;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (HTTP ${res.status})`, res.status, data?.hint ?? null, data);
  }
  return data as T;
}

const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  // App-Zugang
  authState: () => req<{ required: boolean; authed: boolean }>('/api/auth'),
  login: (password: string) => post<{ authed: boolean; required: boolean }>('/api/login', { password }),
  logout: () => post<{ authed: false }>('/api/logout'),

  // Session & Verbindungen
  session: () => req<Session>('/api/session'),
  connect: (body: { host: string; apiKey?: string; vdom?: string; verifyTls?: boolean; readOnly?: boolean }) =>
    post<Session>('/api/connect', body),
  connectProfile: (id: string) => post<Session>(`/api/connections/${id}/connect`),
  disconnect: () => post<{ connected: false }>('/api/disconnect'),

  connections: () => req<ConnectionProfile[]>('/api/connections'),
  createConnection: (body: Partial<ConnectionProfile> & { apiKey?: string }) =>
    post<ConnectionProfile>('/api/connections', body),
  updateConnection: (id: string, body: Partial<ConnectionProfile> & { apiKey?: string }) =>
    req<ConnectionProfile>(`/api/connections/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteConnection: (id: string) => req<void>(`/api/connections/${id}`, { method: 'DELETE' }),
  testConnection: (body: { host?: string; apiKey?: string; vdom?: string; verifyTls?: boolean; id?: string }) =>
    post<{ ok: boolean; info?: unknown; error?: string; hint?: string }>('/api/connections/test', body),

  // Daten
  schema: () => req<SchemaBundle>('/api/schema'),
  inventory: () => req<Inventory>('/api/inventory'),
  refdata: () => req<RefData>('/api/refdata'),
  objects: <T,>(table: string) => req<{ results: T[] }>(`/api/objects/${encodeURIComponent(table)}`),

  // Changeset
  validate: (ops: Op[]) => post<ValidateResult>('/api/changeset/validate', { ops }),
  cli: (ops: Op[]) => post<{ cli: string }>('/api/changeset/cli', { ops }),
  apply: (ops: Op[], opts?: { force?: boolean; stopOnError?: boolean }) =>
    post<ApplyResult>('/api/changeset/apply', { ops, ...opts }),
  revert: (ops: Op[]) => post<ApplyResult>('/api/changeset/revert', { ops }),

  // Aktionen
  bouncePort: (switchId: string, port: string, duration = 1) =>
    post<{ ok: true }>('/api/ports/bounce', { switchId, port, duration }),
};
