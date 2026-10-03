import type { ServerStatus, ServerNode } from '@aimindmesh/api-types';

/** GET /api/admin/status as used by the admin views: the server contract with the credits shape refined. */
export type AdminServerStatus = Omit<ServerStatus, 'openrouterCredits'> & {
  openrouterCredits?: {
    balance: number;
    total_usage: number;
    total_credits: number;
    lastChecked: number;
  } | null;
};

export type AdminServerNode = ServerNode & { capabilities?: string[] };
