'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FileText, Plus, Calculator, Lock, Copy } from 'lucide-react';

export default function ReturnsPage() {
  const [returns, setReturns] = useState<any>(null);
  const [clients, setClients] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ client_id: '', tax_year: 2025, return_type: '1040' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listReturns().then(setReturns).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await api.createReturn(form);
      const updated = await api.listReturns();
      setReturns(updated);
      setShowForm(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleCalculate = async (id: string) => {
    await api.calculateReturn(id);
    const updated = await api.listReturns();
    setReturns(updated);
  };

  const handleClone = async (id: string) => {
    await api.cloneReturn(id);
    const updated = await api.listReturns();
    setReturns(updated);
  };

  const handleLock = async (id: string) => {
    await api.lockReturn(id);
    const updated = await api.listReturns();
    setReturns(updated);
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const statusColors: Record<string, { bg: string; fg: string }> = {
    draft: { bg: 'var(--ept-accent-glow)', fg: 'var(--ept-accent)' },
    calculated: { bg: 'var(--ept-info-bg)', fg: 'var(--ept-info)' },
    locked: { bg: 'var(--ept-warning-bg)', fg: 'var(--ept-warning)' },
    filed: { bg: 'var(--ept-success-bg)', fg: 'var(--ept-success)' },
    accepted: { bg: 'var(--ept-success-bg)', fg: 'var(--ept-success)' },
    rejected: { bg: 'var(--ept-danger-bg)', fg: 'var(--ept-danger)' },
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>TAX RETURNS</span>
          <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>Returns</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
          style={{ backgroundColor: 'var(--ept-accent)' }}
        >
          <Plus size={14} /> New Return
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-2xl border p-6 mb-8" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ept-text)' }}>New Tax Return</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>Client</label>
              <select
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                <option value="">Select client...</option>
                {clients?.data?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>Tax Year</label>
              <select
                value={form.tax_year}
                onChange={(e) => setForm({ ...form, tax_year: parseInt(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                {[2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>Return Type</label>
              <select
                value={form.return_type}
                onChange={(e) => setForm({ ...form, return_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                {['1040', '1040SR', '1040NR', '1040X', '1120', '1120S', '1065'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={handleCreate} disabled={saving || !form.client_id} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--ept-accent)' }}>
              {saving ? 'Creating...' : 'Create Return'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Returns List */}
      <div className="space-y-4">
        {returns?.data?.map((ret: any) => {
          const sc = statusColors[ret.status] || statusColors.draft;
          return (
            <div
              key={ret.id}
              className="rounded-2xl border p-6 card-hover"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                    <FileText size={22} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
                        Form {ret.return_type} — {ret.tax_year}
                      </span>
                      <span className="inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: sc.bg, color: sc.fg }}>
                        {ret.status}
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--ept-text-muted)' }}>
                      ID: {ret.id?.slice(0, 12)}... | Created: {new Date(ret.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {ret.refund_or_owed !== 0 && (
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--ept-text-muted)' }}>
                      {ret.refund_or_owed > 0 ? 'REFUND' : 'OWED'}
                    </div>
                    <div className="text-2xl font-extrabold" style={{ fontFamily: "'JetBrains Mono', monospace", color: ret.refund_or_owed > 0 ? 'var(--ept-success)' : 'var(--ept-danger)' }}>
                      {fmt(Math.abs(ret.refund_or_owed))}
                    </div>
                  </div>
                )}
              </div>

              {/* Tax Summary Bar */}
              {ret.status !== 'draft' && ret.total_income > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                  {[
                    { label: 'Total Income', value: fmt(ret.total_income) },
                    { label: 'AGI', value: fmt(ret.adjusted_gross_income) },
                    { label: 'Taxable Income', value: fmt(ret.taxable_income) },
                    { label: 'Total Tax', value: fmt(ret.total_tax) },
                    { label: 'Effective Rate', value: `${ret.effective_rate}%` },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--ept-text-muted)' }}>{item.label}</div>
                      <div className="text-sm font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-text)' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                <Link href={`/returns/${ret.id}`} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: 'var(--ept-accent)', color: 'var(--ept-accent)' }}>
                  View Details
                </Link>
                {(ret.status === 'draft' || ret.status === 'in_progress') && (
                  <button onClick={() => handleCalculate(ret.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1" style={{ backgroundColor: 'var(--ept-info-bg)', color: 'var(--ept-info)' }}>
                    <Calculator size={12} /> Calculate
                  </button>
                )}
                {ret.status === 'calculated' && (
                  <button onClick={() => handleLock(ret.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1" style={{ backgroundColor: 'var(--ept-warning-bg)', color: 'var(--ept-warning)' }}>
                    <Lock size={12} /> Lock for E-File
                  </button>
                )}
                <button onClick={() => handleClone(ret.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1" style={{ backgroundColor: 'var(--ept-purple-bg)', color: 'var(--ept-purple)' }}>
                  <Copy size={12} /> Clone
                </button>
              </div>
            </div>
          );
        })}

        {(!returns?.data || returns.data.length === 0) && (
          <div className="rounded-2xl border p-12 text-center" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <FileText size={48} className="mx-auto mb-4" style={{ color: 'var(--ept-text-muted)' }} />
            <p style={{ color: 'var(--ept-text-muted)' }}>No returns yet. Create a client first, then start a return.</p>
          </div>
        )}
      </div>
    </div>
  );
}
