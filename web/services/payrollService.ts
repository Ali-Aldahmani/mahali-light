import { apiDelete, apiGet, apiPost, apiPut } from './http';

const key = (k?: string) => (k ? { headers: { 'Idempotency-Key': k } } : undefined);

export const listPaySettings = () => apiGet('/payroll/employees');
export const setPaySettings = (employeeId: string, body: any) => apiPut(`/payroll/employees/${employeeId}/pay`, body);
export const listPayrollRuns = () => apiGet('/payroll/runs');
export const getPayrollRun = (id: string) => apiGet(`/payroll/runs/${id}`);
export const createPayrollRun = (body: { year: number; month: number }, requestKey: string) =>
  apiPost('/payroll/runs', body, key(requestKey));
export const updatePayrollLine = (runId: string, lineId: string, body: any) => apiPut(`/payroll/runs/${runId}/lines/${lineId}`, body);
export const deletePayrollDraft = (runId: string) => apiDelete(`/payroll/runs/${runId}`);
export const approvePayrollRun = (runId: string) => apiPost(`/payroll/runs/${runId}/approve`);
export const payPayrollRun = (runId: string, body: any, requestKey: string) => apiPost(`/payroll/runs/${runId}/pay`, body, key(requestKey));
export const voidPayrollRun = (runId: string, reason: string) => apiPost(`/payroll/runs/${runId}/void`, { reason });
export const listAdvances = () => apiGet('/payroll/advances');
export const issueAdvance = (body: any, requestKey: string) => apiPost('/payroll/advances', body, key(requestKey));
