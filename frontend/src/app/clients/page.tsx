'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Plus, Search, User, ArrowRight } from 'lucide-react';

export default function ClientsPage() {
  const [clients, setClients] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ user_id: 'demo-user', first_name: '', last_name: '', email: '', filing_status: 'single', address_state: '', address_zip: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await api.createClient(form);
      const updated = await api.listClients();
      setClients(updated);
      setShowForm(false);
      setForm({ user_id: 'demo-user', first_name: '', last_name: '', email: '', filing_status: 'single', address_state: '', address_zip: '' });
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const filingLabels: Record<string, string> = { single: 'Single', mfj: 'Married Filing Jointly', mfs: 'Married Filing Separately', hoh: 'Head of Household', qss: 'Qualifying Surviving Spouse' };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>CLIENT MANAGEMENT</span>
          <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>Clients</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
          style={{ backgroundColor: 'var(--ept-accent)' }}
        >
          <Plus size={14} /> New Client
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-2xl border p-6 mb-8" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ept-text)' }}>New Client</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { key: 'first_name', label: 'First Name', type: 'text' },
              { key: 'last_name', label: 'Last Name', type: 'text' },
              { key: 'email', label: 'Email', type: 'email' },
              { key: 'address_state', label: 'State (2-letter)', type: 'text' },
              { key: 'address_zip', label: 'ZIP Code', type: 'text' },
            ].map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>{field.label}</label>
                <input
                  type={field.type}
                  value={(form as any)[field.key]}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-1"
                  style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', '--tw-ring-color': 'var(--ept-accent)' } as any}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>Filing Status</label>
              <select
                value={form.filing_status}
                onChange={(e) => setForm({ ...form, filing_status: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                {Object.entries(filingLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleCreate}
              disabled={saving || !form.first_name || !form.last_name}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--ept-accent)' }}
            >
              {saving ? 'Creating...' : 'Create Client'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Client List */}
      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        {clients?.data?.length > 0 ? (
          <div className="divide-y" style={{ borderColor: 'var(--ept-border)' }}>
            {clients.data.map((client: any) => (
              <div key={client.id} className="flex items-center justify-between p-4 px-6 hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                    <User size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--ept-text)' }}>
                      {client.first_name} {client.last_name}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                      {client.filing_status ? filingLabels[client.filing_status] || client.filing_status : 'No status'} {client.address_state ? `| ${client.address_state}` : ''} {client.ssn_last4 ? `| SSN ***-**-${client.ssn_last4}` : ''}
                    </div>
                  </div>
                </div>
                <Link href={`/returns?client_id=${client.id}`} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--ept-accent)' }}>
                  Returns <ArrowRight size={12} />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <User size={48} className="mx-auto mb-4" style={{ color: 'var(--ept-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>No clients yet. Click "New Client" to get started.</p>
          </div>
        )}
      </div>

      {clients?.total > 0 && (
        <div className="mt-4 text-xs text-center" style={{ color: 'var(--ept-text-muted)' }}>
          Showing {clients.data.length} of {clients.total} clients
        </div>
      )}
    </div>
  );
}
