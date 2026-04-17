const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'echo-tax-ultimate-dev-key';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Echo-API-Key': API_KEY,
      ...options.headers,
    },
  });
  return res.json();
}

export const api = {
  // Health
  health: () => request<any>('/health'),

  // Clients
  createClient: (data: any) => request<any>('/api/v5/clients', { method: 'POST', body: JSON.stringify(data) }),
  getClient: (id: string) => request<any>(`/api/v5/clients/${id}`),
  listClients: (params?: string) => request<any>(`/api/v5/clients${params ? `?${params}` : ''}`),
  updateClient: (id: string, data: any) => request<any>(`/api/v5/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id: string) => request<any>(`/api/v5/clients/${id}`, { method: 'DELETE' }),
  taxHistory: (id: string) => request<any>(`/api/v5/clients/${id}/tax-history`),

  // Returns
  createReturn: (data: any) => request<any>('/api/v5/returns', { method: 'POST', body: JSON.stringify(data) }),
  getReturn: (id: string) => request<any>(`/api/v5/returns/${id}`),
  listReturns: (params?: string) => request<any>(`/api/v5/returns${params ? `?${params}` : ''}`),
  updateReturn: (id: string, data: any) => request<any>(`/api/v5/returns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReturn: (id: string) => request<any>(`/api/v5/returns/${id}`, { method: 'DELETE' }),
  calculateReturn: (id: string) => request<any>(`/api/v5/returns/${id}/calculate`, { method: 'POST' }),
  returnSummary: (id: string) => request<any>(`/api/v5/returns/${id}/summary`),
  returnHealth: (id: string) => request<any>(`/api/v5/returns/${id}/health`),
  lockReturn: (id: string) => request<any>(`/api/v5/returns/${id}/lock`, { method: 'POST' }),
  unlockReturn: (id: string) => request<any>(`/api/v5/returns/${id}/unlock`, { method: 'POST' }),
  cloneReturn: (id: string) => request<any>(`/api/v5/returns/${id}/clone`, { method: 'POST' }),

  // Income
  addIncome: (data: any) => request<any>('/api/v5/income', { method: 'POST', body: JSON.stringify(data) }),
  getIncome: (returnId: string) => request<any>(`/api/v5/income/${returnId}`),
  updateIncome: (id: string, data: any) => request<any>(`/api/v5/income/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIncome: (id: string) => request<any>(`/api/v5/income/${id}`, { method: 'DELETE' }),

  // Deductions
  addDeduction: (data: any) => request<any>('/api/v5/deductions', { method: 'POST', body: JSON.stringify(data) }),
  getDeductions: (returnId: string) => request<any>(`/api/v5/deductions/${returnId}`),
  updateDeduction: (id: string, data: any) => request<any>(`/api/v5/deductions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeduction: (id: string) => request<any>(`/api/v5/deductions/${id}`, { method: 'DELETE' }),

  // Dependents
  addDependent: (data: any) => request<any>('/api/v5/dependents', { method: 'POST', body: JSON.stringify(data) }),
  getDependents: (returnId: string) => request<any>(`/api/v5/dependents/${returnId}`),

  // Engine
  queryEngine: (data: any) => request<any>('/api/v5/engine/query', { method: 'POST', body: JSON.stringify(data) }),
  getDoctrines: () => request<any>('/api/v5/engine/doctrines'),
  searchIRC: (q: string) => request<any>(`/api/v5/engine/irc/search?q=${encodeURIComponent(q)}`),

  // E-File
  submitEfile: (returnId: string) => request<any>(`/api/v5/efile/${returnId}`, { method: 'POST' }),
  efileStatus: (returnId: string) => request<any>(`/api/v5/efile/${returnId}/status`),
  fileExtension: (returnId: string, data: any) => request<any>(`/api/v5/efile/${returnId}/extension`, { method: 'POST', body: JSON.stringify(data) }),

  // Calculations
  calcAMT: (returnId: string) => request<any>(`/api/v5/calc/amt/${returnId}`, { method: 'POST' }),
  calcNIIT: (returnId: string) => request<any>(`/api/v5/calc/niit/${returnId}`, { method: 'POST' }),
  calcEstimatedPayments: (returnId: string, data?: any) => request<any>(`/api/v5/calc/estimated-payments/${returnId}`, { method: 'POST', body: JSON.stringify(data || {}) }),

  // Reference
  getBrackets: (year: number, status?: string) => request<any>(`/api/v5/reference/brackets/${year}${status ? `?filing_status=${status}` : ''}`),
  getStdDeduction: (year: number, status?: string) => request<any>(`/api/v5/reference/standard-deduction/${year}${status ? `?filing_status=${status}` : ''}`),
  getLimits: (year: number, account?: string) => request<any>(`/api/v5/reference/contribution-limits/${year}${account ? `?account=${account}` : ''}`),
  getMileage: (year: number) => request<any>(`/api/v5/reference/mileage-rate/${year}`),
  getCalendar: (year?: number) => request<any>(`/api/v5/reference/calendar${year ? `?year=${year}` : ''}`),

  // Documents
  uploadDocument: (data: any) => request<any>('/api/v5/documents', { method: 'POST', body: JSON.stringify(data) }),
  getDocuments: (returnId: string) => request<any>(`/api/v5/documents/${returnId}`),

  // Compliance
  runCompliance: (returnId: string) => request<any>(`/api/v5/compliance/check/${returnId}`, { method: 'POST' }),
  getComplianceReport: (returnId: string) => request<any>(`/api/v5/compliance/report/${returnId}`),

  // Planning
  get10YearProjection: (clientId: string, data?: any) => request<any>(`/api/v5/planning/10-year/${clientId}`, { method: 'POST', body: JSON.stringify(data || {}) }),
  getRothLadder: (clientId: string, data: any) => request<any>(`/api/v5/planning/roth-ladder/${clientId}`, { method: 'POST', body: JSON.stringify(data) }),

  // Ops
  getMetrics: () => request<any>('/api/v5/ops/metrics'),
  getAuditTrail: (returnId: string) => request<any>(`/api/v5/ops/audit/${returnId}`),
};
