import { apiGet, apiPost } from './http';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releasedAt: string | null;
  releaseName: string | null;
  notes: string | null;
  downloadUrl: string | null;
}

export type UpdateState =
  | 'idle'
  | 'downloading'
  | 'installing'
  | 'swapping'
  | 'restarting'
  | 'done'
  | 'failed';

export interface UpdateInstallStatus {
  state: UpdateState;
  version: string | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** 0-99 while downloading, null once the byte-level phase is over. */
  progress: number | null;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
}

export const UPDATE_ACTIVE_STATES: UpdateState[] = [
  'downloading',
  'installing',
  'swapping',
  'restarting',
];

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  return apiGet<UpdateCheckResult>('/app-updates/check');
}

export async function getUpdateInstallStatus(): Promise<UpdateInstallStatus> {
  return apiGet<UpdateInstallStatus>('/app-updates/status');
}

export async function installAppUpdate(version: string): Promise<UpdateInstallStatus> {
  return apiPost<UpdateInstallStatus>('/app-updates/install', { version });
}