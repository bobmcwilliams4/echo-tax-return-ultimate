'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MapPin, BarChart3, ArrowRight, TrendingDown, DollarSign, Calculator, Search } from 'lucide-react';

const STATE_TYPES = [
  { id: '', label: 'All States' },
  { id: 'progressive', label: 'Progressive' },
  { id: 'flat', label: 'Flat Tax' },
  { id: 'none', label: 'No Income Tax' },
];

export default function StateTaxPage() {
  const [states, setStates] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedState, setSelectedState] = useState<any>(null);
  const [selectedStateCode, setSelectedStateCode] = useState('');
  const [comparison, setComparison] = useState<any>(null);
  const [compareStates, setCompareStates] = useState<string[]>(['TX', 'CA', 'NY', 'FL', 'WA', 'IL', 'PA']);
  const [returnId, setReturnId] = useState('');
  const [returns, setReturns] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadStates('');
    api.listReturns().then(setReturns).catch(() => {});
  }, []);

  const loadStates = async (type: string) => {
    setFilter(type);
    const res = await api.listStates(type || undefined);
    setStates(res);
  };

  const selectState = async (code: string) => {
    setSelectedStateCode(code);
    const res = await api.stateInfo(code);
    setSelectedState(res);
  };

  const runComparison = async () => {
    if (!returnId || compareStates.length === 0) return;
    setLoading(true);
    try {
      const res = await api.compareStates({ return_id: returnId, states: compareStates });
      setComparison(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const toggleCompareState = (code: string) => {
    setCompareStates(prev =>
      prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]
    );
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

  const filteredStates = states?.data?.filter((s: any) =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>STATE TAX ANALYSIS</span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">50-State</span> Tax Comparison
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Compare income tax across all 50 states. Calculate your liability in any state, compare side-by-side.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* State List */}
        <div>
          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {STATE_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => loadStates(t.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: filter === t.id ? 'var(--ept-accent)' : 'var(--ept-surface)',
                  color: filter === t.id ? '#fff' : 'var(--ept-text-secondary)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ept-text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search states..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-xs outline-none"
              style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
            />
          </div>

          {/* State list */}
          <div className="rounded-2xl border overflow-hidden max-h-[500px] overflow-y-auto" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            {filteredStates?.map((s: any) => {
              const isSelected = selectedStateCode === s.code;
              const isComparing = compareStates.includes(s.code);
              return (
                <div
                  key={s.code}
                  className="flex items-center justify-between p-3 px-4 border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--ept-border)',
                    backgroundColor: isSelected ? 'var(--ept-accent-glow)' : 'transparent',
                  }}
                  onClick={() => selectState(s.code)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-accent)' }}>
                      {s.code}
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'var(--ept-text)' }}>{s.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{
                      backgroundColor: s.type === 'none' ? 'var(--ept-success-bg)' : s.type === 'flat' ? 'var(--ept-info-bg)' : 'var(--ept-warning-bg)',
                      color: s.type === 'none' ? 'var(--ept-success)' : s.type === 'flat' ? 'var(--ept-info)' : 'var(--ept-warning)',
                    }}>
                      {s.type === 'none' ? 'No Tax' : s.type === 'flat' ? `${s.rate || s.flat_rate}%` : 'Progressive'}
                    </span>
                    <input
                      type="checkbox"
                      checked={isComparing}
                      onChange={(e) => { e.stopPropagation(); toggleCompareState(s.code); }}
                      className="rounded"
                      title="Include in comparison"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* State Detail + Compare */}
        <div className="lg:col-span-2 space-y-6">
          {/* State Detail */}
          {selectedState?.data && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                  <MapPin size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
                    {selectedState.data.name} ({selectedState.data.code})
                  </h2>
                  <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                    Type: {selectedState.data.type} | {selectedState.data.tax_year || 2025}
                  </span>
                </div>
              </div>

              {selectedState.data.type === 'none' && (
                <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ept-success-bg)' }}>
                  <div className="flex items-center gap-2">
                    <DollarSign size={16} style={{ color: 'var(--ept-success)' }} />
                    <span className="text-sm font-bold" style={{ color: 'var(--ept-success)' }}>No State Income Tax</span>
                  </div>
                </div>
              )}

              {selectedState.data.type === 'flat' && (
                <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ept-info-bg)' }}>
                  <div className="flex items-center gap-2">
                    <TrendingDown size={16} style={{ color: 'var(--ept-info)' }} />
                    <span className="text-sm font-bold" style={{ color: 'var(--ept-info)' }}>
                      Flat Rate: {selectedState.data.flat_rate || selectedState.data.rate}%
                    </span>
                  </div>
                </div>
              )}

              {selectedState.data.brackets && selectedState.data.brackets.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--ept-accent)' }}>Tax Brackets</h3>
                  <div className="space-y-1">
                    {selectedState.data.brackets.map((b: any, i: number) => (
                      <div key={i} className="flex justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
                        <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                          {fmt(b.min || b.from || 0)} - {b.max || b.to ? fmt(b.max || b.to) : 'and up'}
                        </span>
                        <span className="text-xs font-bold" style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>
                          {b.rate}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedState.data.standard_deduction && (
                <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
                  <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>Standard Deduction: </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmt(selectedState.data.standard_deduction.single || selectedState.data.standard_deduction)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Comparison Tool */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 size={20} style={{ color: 'var(--ept-accent)' }} />
              <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>State Comparison</h2>
            </div>

            <div className="flex gap-3 mb-4">
              <select
                value={returnId}
                onChange={(e) => setReturnId(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                <option value="">Select a return...</option>
                {returns?.data?.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.return_type} {r.tax_year} — {r.id.slice(0, 8)}...
                  </option>
                ))}
              </select>
              <button
                onClick={runComparison}
                disabled={loading || !returnId || compareStates.length === 0}
                className="px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                <Calculator size={14} />
                {loading ? 'Calculating...' : 'Compare'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1 mb-4">
              {compareStates.map((code) => (
                <span key={code} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {code}
                  <button onClick={() => toggleCompareState(code)} className="hover:opacity-60">x</button>
                </span>
              ))}
            </div>

            {/* Comparison Results */}
            {comparison?.data && (
              <div className="space-y-3">
                {comparison.data.results?.sort((a: any, b: any) => (a.state_tax || 0) - (b.state_tax || 0)).map((result: any, i: number) => {
                  const maxTax = Math.max(...(comparison.data.results?.map((r: any) => r.state_tax || 0) || [1]));
                  const pct = maxTax > 0 ? ((result.state_tax || 0) / maxTax) * 100 : 0;
                  return (
                    <div key={result.state} className="p-3 rounded-xl" style={{ backgroundColor: 'var(--ept-surface)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: i === 0 ? 'var(--ept-success)' : 'var(--ept-accent)' }}>
                            {i === 0 ? '1st' : `${i + 1}`} {result.state}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
                            {result.type === 'none' ? 'No Tax' : result.type}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: (result.state_tax || 0) === 0 ? 'var(--ept-success)' : 'var(--ept-text)' }}>
                            {fmt(result.state_tax || 0)}
                          </span>
                          {result.effective_rate != null && (
                            <span className="text-[10px] ml-2" style={{ color: 'var(--ept-text-muted)' }}>
                              ({result.effective_rate}%)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ept-bg)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: i === 0 ? 'var(--ept-success)' : 'var(--ept-accent)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                {comparison.data.savings_vs_highest != null && (
                  <div className="mt-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--ept-success-bg)' }}>
                    <div className="flex items-center gap-2">
                      <TrendingDown size={16} style={{ color: 'var(--ept-success)' }} />
                      <span className="text-sm font-bold" style={{ color: 'var(--ept-success)' }}>
                        Potential Savings: {fmt(comparison.data.savings_vs_highest)} by choosing {comparison.data.best_state || 'lowest-tax state'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
