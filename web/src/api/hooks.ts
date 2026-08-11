// React-Query-Schicht. Server-State lebt hier, nicht in einem globalen Store –
// die FortiGate ist die Wahrheit, der Browser haelt nur den Changeset.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Op } from './types';

export const keys = {
  session: ['session'] as const,
  connections: ['connections'] as const,
  schema: ['schema'] as const,
  inventory: ['inventory'] as const,
  refdata: ['refdata'] as const,
};

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: api.session, staleTime: 30_000 });
}

export function useConnections() {
  return useQuery({ queryKey: keys.connections, queryFn: api.connections });
}

export function useSchema(enabled = true) {
  return useQuery({ queryKey: keys.schema, queryFn: api.schema, enabled, staleTime: 10 * 60_000 });
}

export function useInventory(enabled = true) {
  return useQuery({
    queryKey: keys.inventory,
    queryFn: api.inventory,
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useRefData(enabled = true) {
  return useQuery({ queryKey: keys.refdata, queryFn: api.refdata, enabled, staleTime: 30_000 });
}

/** Nach einem Apply muss alles neu gelesen werden – die FortiGate ist die Wahrheit. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.inventory });
    qc.invalidateQueries({ queryKey: keys.refdata });
  };
}

export function useApply() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ ops, force }: { ops: Op[]; force?: boolean }) => api.apply(ops, { force }),
    onSettled: refresh,
  });
}

export function useRevert() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (ops: Op[]) => api.revert(ops), onSettled: refresh });
}

export function useValidate() {
  return useMutation({ mutationFn: (ops: Op[]) => api.validate(ops) });
}

export function useBouncePort() {
  return useMutation({
    mutationFn: ({ switchId, port, duration }: { switchId: string; port: string; duration?: number }) =>
      api.bouncePort(switchId, port, duration),
  });
}

export function useConnectionMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.connections });
  return {
    create: useMutation({ mutationFn: api.createConnection, onSuccess: inv }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateConnection(id, body),
      onSuccess: inv,
    }),
    remove: useMutation({ mutationFn: api.deleteConnection, onSuccess: inv }),
    test: useMutation({ mutationFn: api.testConnection }),
  };
}

export function useSessionMutations() {
  const qc = useQueryClient();
  const after = () => {
    qc.invalidateQueries({ queryKey: keys.session });
    qc.removeQueries({ queryKey: keys.inventory });
    qc.removeQueries({ queryKey: keys.refdata });
    qc.removeQueries({ queryKey: keys.schema });
  };
  return {
    connect: useMutation({ mutationFn: api.connect, onSuccess: after }),
    connectProfile: useMutation({ mutationFn: api.connectProfile, onSuccess: after }),
    disconnect: useMutation({ mutationFn: api.disconnect, onSuccess: after }),
  };
}
