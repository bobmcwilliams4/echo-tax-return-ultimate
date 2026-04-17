'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Brain, Send, Search, BookOpen, Zap, Clock } from 'lucide-react';

const ENGINE_OPTIONS = [
  { id: 'TIE', name: 'Tax Intelligence' },
  { id: 'FIE', name: 'Federal Income' },
  { id: 'STE', name: 'State Tax' },
  { id: 'BIE', name: 'Business' },
  { id: 'CRE', name: 'Credits' },
  { id: 'DEP', name: 'Depreciation' },
  { id: 'CRY', name: 'Crypto' },
  { id: 'AUD', name: 'Audit Risk' },
  { id: 'PLN', name: 'Planning' },
  { id: 'PIE', name: 'Product Intel' },
  { id: 'ARCS', name: 'Audit Calc' },
  { id: 'INT', name: 'International' },
  { id: 'EST', name: 'Estate' },
  { id: 'LEG', name: 'Legal' },
];

const SAMPLE_QUERIES = [
  'What is the QBI deduction for a sole proprietor with $150K of qualified business income?',
  'Calculate self-employment tax on $80,000 of Schedule C net profit',
  'What are the 2025 CTC requirements and phase-out thresholds?',
  'Should I take the standard deduction or itemize with $18K in mortgage interest?',
  'What is the NIIT threshold for married filing jointly?',
];

export default function EnginePage() {
  const [query, setQuery] = useState('');
  const [engineId, setEngineId] = useState('TIE');
  const [forceClaude, setForceClaude] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [ircQuery, setIrcQuery] = useState('');
  const [ircResults, setIrcResults] = useState<any>(null);
  const [doctrines, setDoctrines] = useState<any>(null);

  const handleQuery = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.queryEngine({ query, engine_id: engineId, force_claude: forceClaude });
      setResult(res);
    } catch (e) {
      setResult({ success: false, error: 'Failed to query engine' });
    }
    setLoading(false);
  };

  const handleIRCSearch = async () => {
    if (!ircQuery.trim()) return;
    const res = await api.searchIRC(ircQuery);
    setIrcResults(res);
  };

  const loadDoctrines = async () => {
    const res = await api.getDoctrines();
    setDoctrines(res);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>AI TAX ENGINE</span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">Three-Layer</span> Tax Intelligence
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Doctrine Cache (0-50ms) &rarr; Semantic FTS5 (50-200ms) &rarr; Claude Deep Analysis (1-15s)
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Query Panel */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Brain size={20} style={{ color: 'var(--ept-accent)' }} />
              <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>Query Engine</h2>
            </div>

            <div className="flex gap-3 mb-4">
              <select
                value={engineId}
                onChange={(e) => setEngineId(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
              >
                {ENGINE_OPTIONS.map((e) => (
                  <option key={e.id} value={e.id}>{e.id} — {e.name}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: 'var(--ept-text-secondary)' }}>
                <input type="checkbox" checked={forceClaude} onChange={(e) => setForceClaude(e.target.checked)} className="rounded" />
                Force Claude Deep
              </label>
            </div>

            <div className="relative">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask any tax question..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none resize-none focus:ring-1"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleQuery(); }}
              />
              <button
                onClick={handleQuery}
                disabled={loading || !query.trim()}
                className="absolute bottom-3 right-3 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                {loading ? <Clock size={14} className="animate-spin" /> : <Send size={14} />}
                {loading ? 'Analyzing...' : 'Query'}
              </button>
            </div>

            {/* Sample Queries */}
            <div className="mt-3 flex flex-wrap gap-2">
              {SAMPLE_QUERIES.map((sq) => (
                <button
                  key={sq}
                  onClick={() => setQuery(sq)}
                  className="px-3 py-1 rounded-full text-[10px] font-medium border truncate max-w-[300px]"
                  style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-muted)' }}
                >
                  {sq}
                </button>
              ))}
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className="mt-6 rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
              {result.success === false ? (
                <p style={{ color: 'var(--ept-danger)' }}>{result.error}</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                        {result.data?.response_layer || result.data?.layer || 'response'}
                      </span>
                      {result.data?.confidence && (
                        <span className="inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}>
                          {result.data.confidence}
                        </span>
                      )}
                      {result.data?.latency_ms != null && (
                        <span className="text-xs" style={{ color: 'var(--ept-text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                          {result.data.latency_ms}ms
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ept-text)' }}>
                    {result.data?.analysis || result.data?.response || JSON.stringify(result.data, null, 2)}
                  </div>

                  {result.data?.citations?.length > 0 && (
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                      <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--ept-accent)' }}>CITATIONS</div>
                      <div className="flex flex-wrap gap-2">
                        {result.data.citations.map((c: string, i: number) => (
                          <span key={i} className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* IRC Search */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Search size={16} style={{ color: 'var(--ept-accent)' }} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>IRC Search</h3>
            </div>
            <div className="flex gap-2">
              <input
                value={ircQuery}
                onChange={(e) => setIrcQuery(e.target.value)}
                placeholder="Search IRC sections..."
                className="flex-1 px-3 py-2 rounded-lg border text-xs outline-none"
                style={{ backgroundColor: 'var(--ept-surface)', borderColor: 'var(--ept-border)', color: 'var(--ept-text)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleIRCSearch(); }}
              />
              <button onClick={handleIRCSearch} className="px-3 py-2 rounded-lg text-white" style={{ backgroundColor: 'var(--ept-accent)' }}>
                <Search size={14} />
              </button>
            </div>
            {ircResults?.data?.length > 0 && (
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {ircResults.data.map((r: any, i: number) => (
                  <div key={i} className="p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--ept-surface)' }}>
                    <div className="font-bold" style={{ color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>{r.section}</div>
                    <div className="font-semibold" style={{ color: 'var(--ept-text)' }}>{r.title}</div>
                    <div className="mt-1 line-clamp-2" style={{ color: 'var(--ept-text-muted)' }}>{r.full_text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Doctrine Blocks */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookOpen size={16} style={{ color: 'var(--ept-accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>Doctrine Blocks</h3>
              </div>
              <button onClick={loadDoctrines} className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ept-accent)' }}>
                Load
              </button>
            </div>
            {doctrines?.data?.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {doctrines.data.map((d: any) => (
                  <div key={d.id} className="p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--ept-surface)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-bold" style={{ color: 'var(--ept-accent)', fontFamily: "'JetBrains Mono', monospace" }}>{d.id}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>{d.engine_id}</span>
                    </div>
                    <div className="font-semibold mt-1" style={{ color: 'var(--ept-text)' }}>{d.topic}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Layer Legend */}
          <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--ept-text)' }}>Response Layers</h3>
            <div className="space-y-3">
              {[
                { layer: 'Doctrine Cache', time: '0-50ms', icon: Zap, desc: 'Pre-compiled expert reasoning blocks' },
                { layer: 'Semantic FTS5', time: '50-200ms', icon: Search, desc: 'Full-text search over IRC authority' },
                { layer: 'Claude Deep', time: '1-15s', icon: Brain, desc: 'Claude Opus CPA-grade analysis' },
              ].map((l) => (
                <div key={l.layer} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}>
                    <l.icon size={14} />
                  </div>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--ept-text)' }}>{l.layer}</div>
                    <div className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>{l.time} — {l.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
