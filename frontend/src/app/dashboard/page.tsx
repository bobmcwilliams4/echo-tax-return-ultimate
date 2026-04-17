'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Users, FileText, Calculator, Brain, Plus, ArrowRight, Activity } from 'lucide-react';

export default function DashboardPage() {
  const [health, setHealth] = useState<any>(null);
  const [clients, setClients] = useState<any>(null);
  const [returns, setReturns] = useState<any>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
    api.listReturns().then(setReturns).catch(() => {});
  }, []);

  const stats = [
    { icon: Users, label: 'Clients', value: clients?.total || 0, href: '/clients', color: 'var(--ept-info)' },
    { icon: FileText, label: 'Returns', value: returns?.total || 0, href: '/returns', color: 'var(--ept-accent)' },
    { icon: Calculator, label: 'Calculated', value: returns?.data?.filter((r: any) => r.status === 'calculated').length || 0, href: '/returns?status=calculated', color: 'var(--ept-success)' },
    { icon: Activity, label: 'Engines', value: health?.services?.engines ? Object.keys(health.services.engines).length : 0, href: '/engine', color: 'var(--ept-purple)' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>COMMAND CENTER</span>
          <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>Dashboard</h1>
        </div>
        <div className="flex gap-3">
          <Link
            href="/clients?new=1"
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
            style={{ backgroundColor: 'var(--ept-accent)' }}
          >
            <Plus size={14} /> New Client
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="p-6 rounded-2xl border card-hover"
            style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${stat.color}20`, color: stat.color }}>
              <stat.icon size={20} />
            </div>
            <div className="text-3xl font-extrabold" style={{ fontFamily: "'JetBrains Mono', monospace", color: stat.color }}>
              {stat.value}
            </div>
            <div className="text-xs uppercase tracking-widest font-medium mt-1" style={{ color: 'var(--ept-text-muted)' }}>
              {stat.label}
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Returns */}
      <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--ept-border)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>Recent Returns</h2>
          <Link href="/returns" className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--ept-accent)' }}>
            View All <ArrowRight size={12} />
          </Link>
        </div>

        {returns?.data?.length > 0 ? (
          <div className="divide-y" style={{ borderColor: 'var(--ept-border)' }}>
            {returns.data.slice(0, 5).map((ret: any) => (
              <Link
                key={ret.id}
                href={`/returns/${ret.id}`}
                className="flex items-center justify-between p-4 px-6 hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--ept-border)' }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {ret.return_type}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--ept-text)' }}>
                      Tax Year {ret.tax_year}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                      {ret.client_id?.slice(0, 8)}...
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {ret.refund_or_owed !== 0 && (
                    <span className="text-sm font-bold" style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: ret.refund_or_owed > 0 ? 'var(--ept-success)' : 'var(--ept-danger)',
                    }}>
                      {ret.refund_or_owed > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ret.refund_or_owed)}
                    </span>
                  )}
                  <span
                    className="inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      backgroundColor: ret.status === 'calculated' ? 'var(--ept-info-bg)' : ret.status === 'filed' ? 'var(--ept-success-bg)' : ret.status === 'rejected' ? 'var(--ept-danger-bg)' : 'var(--ept-accent-glow)',
                      color: ret.status === 'calculated' ? 'var(--ept-info)' : ret.status === 'filed' ? 'var(--ept-success)' : ret.status === 'rejected' ? 'var(--ept-danger)' : 'var(--ept-accent)',
                    }}
                  >
                    {ret.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <p className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>No returns yet. Create a client and start a return.</p>
          </div>
        )}
      </div>

      {/* Engine Status */}
      <div className="mt-8 rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ept-text)' }}>Engine Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-7 gap-3">
          {health?.services?.engines && Object.entries(health.services.engines).map(([id, status]) => (
            <div key={id} className="flex items-center gap-2 p-2 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: status === 'up' ? 'var(--ept-success)' : 'var(--ept-danger)' }} />
              <span className="text-xs font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-text)' }}>{id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
