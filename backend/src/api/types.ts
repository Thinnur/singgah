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
  // leases/minutes = all-time history (minutes used, not booked); activeLeases = ACTIVE now
  perLab: { labId: string; labName: string; leases: number; activeLeases: number; minutes: number }[];
  wg0: { rxBps: number; txBps: number } | null;
};
export type AdminLab = { id: string; name: string; targetCidr: string; maxHours: number; isActive: boolean; createdAt: number };
export type SshStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type SshLabView = {
  labId: string; labName: string; host: string;
  account: { id: number; status: SshStatus; username: string; reason: string | null;
             requestedAt: number; decidedAt: number | null; passwordSet: boolean } | null;
};
export type SshPasswordResponse = { username: string; host: string; password: string };
export type AdminSshAccount = {
  id: number; email: string; username: string; labId: string; labName: string; status: SshStatus;
  requestedAt: number; decidedAt: number | null; decidedBy: string | null; reason: string | null; passwordSet: boolean;
};
export type SshAuditEntry = {
  id: number; accountId: number; action: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'PASSWORD_SET';
  actor: string; at: number; detail: Record<string, unknown>;
};
