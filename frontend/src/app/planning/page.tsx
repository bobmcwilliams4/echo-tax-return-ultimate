'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  ArrowRight,
  BarChart3,
  RefreshCw,
  ChevronDown,
  Landmark,
  PiggyBank,
  Clock,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  ssn_last4?: string;
}

interface ProjectionYear {
  year: number;
  age: number;
  income: number;
  federal_tax: number;
  state_tax: number;
  total_tax: number;
  effective_rate: number;
  marginal_rate: number;
  cumulative_tax: number;
  after_tax_income: number;
}

interface ProjectionResult {
  success: boolean;
  data?: {
    projections: ProjectionYear[];
    summary?: {
      total_income: number;
      total_tax: number;
      avg_effective_rate: number;
      peak_tax_year: number;
    };
  };
  error?: string;
}

interface RothYear {
  year: number;
  age: number;
  traditional_balance: number;
  conversion_amount: number;
  tax_on_conversion: number;
  roth_balance: number;
  net_savings: number;
  cumulative_tax: number;
}

interface RothResult {
  success: boolean;
  data?: {
    schedule: RothYear[];
    breakeven?: {
      year: number;
      age: number;
      years_to_breakeven: number;
      total_conversion_tax: number;
      total_rmd_tax_avoided: number;
      net_benefit: number;
    };
    summary?: {
      total_converted: number;
      total_tax_paid: number;
      projected_roth_balance: number;
      tax_free_growth: number;
    };
  };
  error?: string;
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

export default function PlanningPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [activeTab, setActiveTab] = useState<'projection' | 'roth'>('projection');

  // 10-Year Projection state
  const [projBaseIncome, setProjBaseIncome] = useState('100000');
  const [projCurrentAge, setProjCurrentAge] = useState('40');
  const [projGrowthRate, setProjGrowthRate] = useState('3');
  const [projFilingStatus, setProjFilingStatus] = useState('single');
  const [projResult, setProjResult] = useState<ProjectionResult | null>(null);
  const [projLoading, setProjLoading] = useState(false);

  // Roth Conversion state
  const [rothBalance, setRothBalance] = useState('500000');
  const [rothIncome, setRothIncome] = useState('60000');
  const [rothAge, setRothAge] = useState('55');
  const [rothYears, setRothYears] = useState('5');
  const [rothResult, setRothResult] = useState<RothResult | null>(null);
  const [rothLoading, setRothLoading] = useState(false);

  useEffect(() => {
    api.listClients().then((res: any) => {
      if (res?.data) setClients(res.data);
    }).catch(() => {});
  }, []);

  const run10YearProjection = async () => {
    if (!selectedClient) return;
    setProjLoading(true);
    setProjResult(null);
    try {
      const res = await api.get10YearProjection(selectedClient, {
        base_income: parseFloat(projBaseIncome),
        current_age: parseInt(projCurrentAge),
        growth_rate: parseFloat(projGrowthRate) / 100,
        filing_status: projFilingStatus,
      });
      setProjResult(res);
    } catch {
      setProjResult({ success: false, error: 'Failed to generate projection' });
    }
    setProjLoading(false);
  };

  const runRothLadder = async () => {
    if (!selectedClient) return;
    setRothLoading(true);
    setRothResult(null);
    try {
      const res = await api.getRothLadder(selectedClient, {
        traditional_balance: parseFloat(rothBalance),
        annual_income: parseFloat(rothIncome),
        current_age: parseInt(rothAge),
        conversion_years: parseInt(rothYears),
      });
      setRothResult(res);
    } catch {
      setRothResult({ success: false, error: 'Failed to generate Roth ladder' });
    }
    setRothLoading(false);
  };

  const projections = projResult?.data?.projections || [];
  const maxIncome = projections.length > 0 ? Math.max(...projections.map(p => p.income)) : 1;
  const maxTax = projections.length > 0 ? Math.max(...projections.map(p => p.total_tax)) : 1;

  const rothSchedule = rothResult?.data?.schedule || [];
  const maxConversion = rothSchedule.length > 0 ? Math.max(...rothSchedule.map(r => r.conversion_amount)) : 1;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
          STRATEGIC PLANNING
        </span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">Tax Planning</span> & Projections
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Long-range tax projections, Roth conversion ladders, and strategic optimization
        </p>
      </div>

      {/* Client Selector */}
      <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ChevronDown size={16} style={{ color: 'var(--ept-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--ept-text)' }}>Client</span>
          </div>
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="flex-1 min-w-[240px] px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
          >
            <option value="">Select a client...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name} {c.ssn_last4 ? `(***-**-${c.ssn_last4})` : `(${c.id.slice(0, 8)})`}
              </option>
            ))}
          </select>
          {!selectedClient && (
            <span className="text-xs" style={{ color: 'var(--ept-warning, var(--ept-accent))' }}>
              Select a client to begin planning
            </span>
          )}
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 mb-6">
        {([
          { key: 'projection' as const, label: '10-Year Projection', icon: TrendingUp },
          { key: 'roth' as const, label: 'Roth Conversion Ladder', icon: Landmark },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === tab.key ? 'var(--ept-accent)' : 'var(--ept-surface)',
              color: activeTab === tab.key ? '#ffffff' : 'var(--ept-text-secondary)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: activeTab === tab.key ? 'var(--ept-accent)' : 'var(--ept-border)',
            }}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ 10-YEAR PROJECTION ============ */}
      {activeTab === 'projection' && (
        <div className="space-y-6">
          {/* Input Form */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                <BarChart3 size={16} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>10-Year Income & Tax Projection</h2>
                <p className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>Forecast income growth, tax liability, and effective rates over the next decade</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Base Income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--ept-text-muted)' }}>$</span>
                  <input
                    type="number"
                    value={projBaseIncome}
                    onChange={(e) => setProjBaseIncome(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm outline-none"
                    style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Current Age
                </label>
                <input
                  type="number"
                  value={projCurrentAge}
                  onChange={(e) => setProjCurrentAge(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Growth Rate %
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    value={projGrowthRate}
                    onChange={(e) => setProjGrowthRate(e.target.value)}
                    className="w-full px-3 pr-7 py-2.5 rounded-lg border text-sm outline-none"
                    style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--ept-text-muted)' }}>%</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Filing Status
                </label>
                <select
                  value={projFilingStatus}
                  onChange={(e) => setProjFilingStatus(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
                >
                  <option value="single">Single</option>
                  <option value="married_jointly">Married Filing Jointly</option>
                  <option value="married_separately">Married Separately</option>
                  <option value="head_of_household">Head of Household</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={run10YearProjection}
                disabled={projLoading || !selectedClient}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                {projLoading ? <RefreshCw size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                {projLoading ? 'Projecting...' : 'Generate Projection'}
              </button>
            </div>
          </div>

          {/* Projection Error */}
          {projResult?.success === false && (
            <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--ept-danger-bg, rgba(239,68,68,0.1))', borderColor: 'var(--ept-danger, #ef4444)' }}>
              <AlertTriangle size={18} style={{ color: 'var(--ept-danger, #ef4444)' }} />
              <span className="text-sm" style={{ color: 'var(--ept-danger, #ef4444)' }}>{projResult.error}</span>
            </div>
          )}

          {/* Projection Summary Cards */}
          {projResult?.success && projResult?.data?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Income', value: fmt.format(projResult.data.summary.total_income), icon: DollarSign, clr: 'var(--ept-accent)' },
                { label: 'Total Tax', value: fmt.format(projResult.data.summary.total_tax), icon: Landmark, clr: 'var(--ept-danger, #ef4444)' },
                { label: 'Avg Effective Rate', value: fmtPct(projResult.data.summary.avg_effective_rate), icon: BarChart3, clr: 'var(--ept-info, #3b82f6)' },
                { label: 'Peak Tax Year', value: String(projResult.data.summary.peak_tax_year), icon: Calendar, clr: 'var(--ept-purple, #8b5cf6)' },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border p-5 card-hover" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${card.clr}20`, color: card.clr }}>
                    <card.icon size={16} />
                  </div>
                  <div className="text-xl font-extrabold" style={{ ...mono, color: card.clr }}>{card.value}</div>
                  <div className="text-[10px] uppercase tracking-widest font-medium mt-1" style={{ color: 'var(--ept-text-muted)' }}>{card.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Projection Visualization */}
          {projections.length > 0 && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-5" style={{ color: 'var(--ept-accent)' }}>
                Year-by-Year Visualization
              </h3>
              <div className="space-y-3">
                {projections.map((p) => (
                  <div key={p.year} className="flex items-center gap-4">
                    <div className="w-16 text-right shrink-0">
                      <span className="text-xs font-bold" style={{ ...mono, color: 'var(--ept-text)' }}>{p.year}</span>
                      <div className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>age {p.age}</div>
                    </div>
                    <div className="flex-1 space-y-1">
                      {/* Income bar */}
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 rounded-r-md transition-all"
                          style={{
                            width: `${Math.max(2, (p.income / maxIncome) * 100)}%`,
                            backgroundColor: 'var(--ept-accent)',
                            opacity: 0.7,
                          }}
                        />
                        <span className="text-[10px] shrink-0" style={{ ...mono, color: 'var(--ept-text-secondary)' }}>
                          {fmt.format(p.income)}
                        </span>
                      </div>
                      {/* Tax bar */}
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 rounded-r-md transition-all"
                          style={{
                            width: `${Math.max(1, (p.total_tax / maxIncome) * 100)}%`,
                            backgroundColor: 'var(--ept-danger, #ef4444)',
                            opacity: 0.6,
                          }}
                        />
                        <span className="text-[10px] shrink-0" style={{ ...mono, color: 'var(--ept-text-muted)' }}>
                          {fmt.format(p.total_tax)} ({fmtPct(p.effective_rate)})
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-6 mt-4 pt-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--ept-accent)', opacity: 0.7 }} />
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ept-text-muted)' }}>Income</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--ept-danger, #ef4444)', opacity: 0.6 }} />
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ept-text-muted)' }}>Tax</span>
                </div>
              </div>
            </div>
          )}

          {/* Projection Table */}
          {projections.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <div className="p-5 border-b" style={{ borderColor: 'var(--ept-border)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>Detailed Projection Table</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={mono}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--ept-surface)' }}>
                      {['Year', 'Age', 'Income', 'Federal Tax', 'State Tax', 'Total Tax', 'Eff. Rate', 'Marginal', 'Cumulative Tax', 'After Tax'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-wider" style={{ color: 'var(--ept-text-secondary)', fontSize: '10px' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((p, i) => (
                      <tr
                        key={p.year}
                        className="border-t"
                        style={{
                          borderColor: 'var(--ept-border)',
                          backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--ept-surface)',
                        }}
                      >
                        <td className="px-4 py-3 font-bold" style={{ color: 'var(--ept-accent)' }}>{p.year}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-text)' }}>{p.age}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ept-text)' }}>{fmt.format(p.income)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-danger, #ef4444)' }}>{fmt.format(p.federal_tax)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-danger, #ef4444)' }}>{fmt.format(p.state_tax)}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: 'var(--ept-danger, #ef4444)' }}>{fmt.format(p.total_tax)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-info, #3b82f6)' }}>{fmtPct(p.effective_rate)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-purple, #8b5cf6)' }}>{fmtPct(p.marginal_rate)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-text-secondary)' }}>{fmt.format(p.cumulative_tax)}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ept-success, #22c55e)' }}>{fmt.format(p.after_tax_income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ ROTH CONVERSION LADDER ============ */}
      {activeTab === 'roth' && (
        <div className="space-y-6">
          {/* Input Form */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                <Landmark size={16} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>Roth Conversion Ladder Analysis</h2>
                <p className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>Model systematic Roth conversions to minimize lifetime tax burden and eliminate RMDs</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Traditional Balance
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--ept-text-muted)' }}>$</span>
                  <input
                    type="number"
                    value={rothBalance}
                    onChange={(e) => setRothBalance(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm outline-none"
                    style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Annual Income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--ept-text-muted)' }}>$</span>
                  <input
                    type="number"
                    value={rothIncome}
                    onChange={(e) => setRothIncome(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm outline-none"
                    style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Current Age
                </label>
                <input
                  type="number"
                  value={rothAge}
                  onChange={(e) => setRothAge(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ept-text-secondary)' }}>
                  Conversion Years
                </label>
                <input
                  type="number"
                  value={rothYears}
                  onChange={(e) => setRothYears(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                  style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)', ...mono }}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={runRothLadder}
                disabled={rothLoading || !selectedClient}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                {rothLoading ? <RefreshCw size={14} className="animate-spin" /> : <Landmark size={14} />}
                {rothLoading ? 'Analyzing...' : 'Analyze Roth Ladder'}
              </button>
            </div>
          </div>

          {/* Roth Error */}
          {rothResult?.success === false && (
            <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--ept-danger-bg, rgba(239,68,68,0.1))', borderColor: 'var(--ept-danger, #ef4444)' }}>
              <AlertTriangle size={18} style={{ color: 'var(--ept-danger, #ef4444)' }} />
              <span className="text-sm" style={{ color: 'var(--ept-danger, #ef4444)' }}>{rothResult.error}</span>
            </div>
          )}

          {/* Roth Summary + Breakeven */}
          {rothResult?.success && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Summary */}
              {rothResult.data?.summary && (
                <div className="rounded-2xl border p-6 card-hover" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <PiggyBank size={18} style={{ color: 'var(--ept-accent)' }} />
                    <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>Conversion Summary</h3>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: 'Total Converted', value: fmt.format(rothResult.data.summary.total_converted), clr: 'var(--ept-text)' },
                      { label: 'Tax Paid on Conversions', value: fmt.format(rothResult.data.summary.total_tax_paid), clr: 'var(--ept-danger, #ef4444)' },
                      { label: 'Projected Roth Balance', value: fmt.format(rothResult.data.summary.projected_roth_balance), clr: 'var(--ept-success, #22c55e)' },
                      { label: 'Tax-Free Growth', value: fmt.format(rothResult.data.summary.tax_free_growth), clr: 'var(--ept-accent)' },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between">
                        <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>{row.label}</span>
                        <span className="text-sm font-bold" style={{ ...mono, color: row.clr }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Breakeven */}
              {rothResult.data?.breakeven && (
                <div className="rounded-2xl border p-6 card-hover" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock size={18} style={{ color: 'var(--ept-info, #3b82f6)' }} />
                    <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-info, #3b82f6)' }}>Breakeven Analysis</h3>
                  </div>
                  <div className="mb-4">
                    <div className="text-3xl font-extrabold" style={{ ...mono, color: 'var(--ept-success, #22c55e)' }}>
                      {rothResult.data.breakeven.years_to_breakeven} years
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--ept-text-muted)' }}>
                      Breakeven at age {rothResult.data.breakeven.age} (Year {rothResult.data.breakeven.year})
                    </div>
                  </div>
                  <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>Conversion Tax Paid</span>
                      <span className="text-sm font-bold" style={{ ...mono, color: 'var(--ept-danger, #ef4444)' }}>
                        {fmt.format(rothResult.data.breakeven.total_conversion_tax)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>RMD Tax Avoided</span>
                      <span className="text-sm font-bold" style={{ ...mono, color: 'var(--ept-success, #22c55e)' }}>
                        {fmt.format(rothResult.data.breakeven.total_rmd_tax_avoided)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--ept-text)' }}>Net Benefit</span>
                      <span className="text-lg font-extrabold" style={{ ...mono, color: rothResult.data.breakeven.net_benefit >= 0 ? 'var(--ept-success, #22c55e)' : 'var(--ept-danger, #ef4444)' }}>
                        {rothResult.data.breakeven.net_benefit >= 0 ? '+' : ''}{fmt.format(rothResult.data.breakeven.net_benefit)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Roth Schedule Visualization */}
          {rothSchedule.length > 0 && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <h3 className="text-sm font-bold uppercase tracking-widest mb-5" style={{ color: 'var(--ept-accent)' }}>
                Conversion Schedule
              </h3>
              <div className="space-y-3">
                {rothSchedule.map((r) => (
                  <div key={r.year} className="flex items-center gap-4">
                    <div className="w-16 text-right shrink-0">
                      <span className="text-xs font-bold" style={{ ...mono, color: 'var(--ept-text)' }}>{r.year}</span>
                      <div className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>age {r.age}</div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div
                          className="h-5 rounded-r-md flex items-center pl-2 transition-all"
                          style={{
                            width: `${Math.max(4, (r.conversion_amount / maxConversion) * 100)}%`,
                            backgroundColor: 'var(--ept-accent)',
                            opacity: 0.75,
                          }}
                        >
                          <span className="text-[9px] font-bold text-white whitespace-nowrap">{fmt.format(r.conversion_amount)}</span>
                        </div>
                      </div>
                      <div className="flex gap-4 text-[10px]" style={mono}>
                        <span style={{ color: 'var(--ept-danger, #ef4444)' }}>Tax: {fmt.format(r.tax_on_conversion)}</span>
                        <span style={{ color: 'var(--ept-success, #22c55e)' }}>Roth: {fmt.format(r.roth_balance)}</span>
                        <span style={{ color: 'var(--ept-text-muted)' }}>Trad: {fmt.format(r.traditional_balance)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Roth Schedule Table */}
          {rothSchedule.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <div className="p-5 border-b" style={{ borderColor: 'var(--ept-border)' }}>
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>Detailed Conversion Schedule</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={mono}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--ept-surface)' }}>
                      {['Year', 'Age', 'Trad. Balance', 'Conversion', 'Tax Owed', 'Roth Balance', 'Net Savings', 'Cumulative Tax'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-wider" style={{ color: 'var(--ept-text-secondary)', fontSize: '10px' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rothSchedule.map((r, i) => (
                      <tr
                        key={r.year}
                        className="border-t"
                        style={{
                          borderColor: 'var(--ept-border)',
                          backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--ept-surface)',
                        }}
                      >
                        <td className="px-4 py-3 font-bold" style={{ color: 'var(--ept-accent)' }}>{r.year}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-text)' }}>{r.age}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-text-secondary)' }}>{fmt.format(r.traditional_balance)}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ept-accent)' }}>{fmt.format(r.conversion_amount)}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-danger, #ef4444)' }}>{fmt.format(r.tax_on_conversion)}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ept-success, #22c55e)' }}>{fmt.format(r.roth_balance)}</td>
                        <td className="px-4 py-3" style={{ color: r.net_savings >= 0 ? 'var(--ept-success, #22c55e)' : 'var(--ept-danger, #ef4444)' }}>
                          {r.net_savings >= 0 ? '+' : ''}{fmt.format(r.net_savings)}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--ept-text-muted)' }}>{fmt.format(r.cumulative_tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Educational Info */}
          {!rothResult && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--ept-text)' }}>How Roth Conversion Ladders Work</h3>
              <div className="space-y-3 text-xs leading-relaxed" style={{ color: 'var(--ept-text-secondary)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>1</div>
                  <p>Convert a portion of your Traditional IRA/401(k) to Roth IRA each year during low-income periods (early retirement, gap years, or sabbaticals).</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>2</div>
                  <p>Pay taxes now at lower rates to avoid higher taxes on Required Minimum Distributions (RMDs) at age 73+.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>3</div>
                  <p>After a 5-year seasoning period, converted Roth funds can be withdrawn tax-free and penalty-free, regardless of age.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>4</div>
                  <p>Roth IRAs have no RMDs, making them ideal for estate planning and tax-free legacy wealth transfer.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
