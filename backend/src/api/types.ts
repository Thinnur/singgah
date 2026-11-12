// Times = epoch ms, durations = minutes.
export type Me = { email: string; name: string; role: 'student' | 'admin'; quotaMinutesLeft: number; quotaResetsAt: number };
export type LabOption = { id: string; name: string; maxHours: number; durations: number[] };
export type LeaseView = {
  id: number; labId: string; labName: string; tunnelIp: string; status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  startsAt: number; expiresAt: number; revokedAt: number | null; reason: string | null;
  peerActive: boolean; bytesRx: number; bytesTx: number;
};
export type IssueResponse = { lease: LeaseView; config: string; filename: string };
export type ApiError = { code: string; message: string };
export type AdminLease = LeaseView & { email: string; requesterIp: string | null };
export type AuditEntry = {
  id: number; leaseId: number | null; action: 'ISSUED' | 'REVOKED' | 'EXPIRED' | 'CLOSED';
  actor: string; at: number; detail: Record<string, unknown>;
};
export type Stats = {
  activeLeases: number;
  perLab: { labId: string; labName: string; leases: number; minutes: number }[];
  wg0: { rxBps: number; txBps: number } | null;
};
export type AdminLab = { id: string; name: string; targetCidr: string; maxHours: number; isActive: boolean; createdAt: number };
