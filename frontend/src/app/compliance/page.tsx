'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  RefreshCw,
  FileText,
  BarChart3,
  ChevronDown,
  Clock,
  TrendingUp,
} from 'lucide-react';

type SeverityLevel = 'pass' | 'warning' | 'fail' | 'info';

interface ComplianceItem {
  rule: string;
  description: string;
  severity: SeverityLevel;
  details?: string;
  code?: string;
  recommendation?: string;
}

interface ComplianceReport {
  return_id: string;
  overall_status: string;
  audit_risk_score?: number;
  audit_risk_level?: string;
  items: ComplianceItem[];
  checked_at?: string;
  total_checks?: number;
  passed?: number;
  warnings?: number;
  failures?: number;
}

const severityConfig: Record<SeverityLevel, { label: string; bg: string; fg: string; icon: typeof CheckCircle2 }> = {
  pass: { label: 'PASS', bg: 'var(--ept-success-bg)', fg: 'var(--ept-success)', icon: CheckCircle2 },
  warning: { label: 'WARNING', bg: 'var(--ept-warning-bg)', fg: 'var(--ept-warning)', icon: AlertTriangle },
  fail: { label: 'FAIL', bg: 'var(--ept-danger-bg)', fg: 'var(--ept-danger)', icon: XCircle },
  info: { label: 'INFO', bg: 'var(--ept-info-bg)', fg: 'var(--ept-info)', icon: ShieldCheck },
};

function AuditRiskGauge({ score, level }: { score: number; level?: string }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const rotation = (clampedScore / 100) * 180 - 90;
  const riskColor =
    clampedScore <= 25
      ? 'var(--ept-success)'
      : clampedScore <= 50
        ? 'var(--ept-warning)'
        : clampedScore <= 75
          ? 'var(--ept-danger)'
          : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-48 h-28 overflow-hidden">
        {/* Background arc */}
        <svg viewBox="0 0 200 110" className="w-full h-full">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style={{ stopColor: 'var(--ept-success)' }} />
              <stop offset="40%" style={{ stopColor: 'var(--ept-warning)' }} />
              <stop offset="70%" style={{ stopColor: 'var(--ept-danger)' }} />
              <stop offset="100%" style={{ stopColor: '#dc2626' }} />
            </linearGradient>
          </defs>
          {/* Track */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--ept-border)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Filled arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(clampedScore / 100) * 251.2} 251.2`}
          />
          {/* Needle */}
          <line
            x1="100"
            y1="100"
            x2={100 + 60 * Math.cos((rotation * Math.PI) / 180)}
            y2={100 - 60 * Math.sin((-rotation * Math.PI) / 180)}
            stroke={riskColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="5" fill={riskColor} />
        </svg>
      </div>
      <div
        className="text-4xl font-extrabold -mt-2"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: riskColor }}
      >
        {clampedScore}
      </div>
      <div className="text-xs font-semibold uppercase tracking-widest mt-1" style={{ color: riskColor }}>
        {level || (clampedScore <= 25 ? 'LOW RISK' : clampedScore <= 50 ? 'MODERATE' : clampedScore <= 75 ? 'HIGH RISK' : 'CRITICAL')}
      </div>
    </div>
  );
}

export default function CompliancePage() {
  const [returns, setReturns] = useState<any>(null);
  const [selectedReturnId, setSelectedReturnId] = useState('');
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<SeverityLevel | 'all'>('all');

  useEffect(() => {
    api.listReturns().then(setReturns).catch(() => {});
  }, []);

  const runComplianceCheck = async () => {
    if (!selectedReturnId) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      await api.runCompliance(selectedReturnId);
      await loadReport();
    } catch (e: any) {
      setError(e.message || 'Compliance check failed');
    }
    setRunning(false);
  };

  const loadReport = async () => {
    if (!selectedReturnId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getComplianceReport(selectedReturnId);
      if (res?.data) {
        setReport(res.data);
      } else if (res?.report) {
        setReport(res.report);
      } else {
        setReport(res);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load compliance report');
    }
    setLoading(false);
  };

  const handleReturnSelect = async (id: string) => {
    setSelectedReturnId(id);
    setReport(null);
    setError(null);
    setExpandedItems(new Set());
    if (id) {
      setLoading(true);
      try {
        const res = await api.getComplianceReport(id);
        if (res?.data || res?.report || res?.items) {
          setReport(res.data || res.report || res);
        }
      } catch {
        // No existing report, that's fine
      }
      setLoading(false);
    }
  };

  const toggleExpand = (idx: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const items = report?.items || [];
  const filteredItems = filterSeverity === 'all' ? items : items.filter((i) => i.severity === filterSeverity);

  const passCount = items.filter((i) => i.severity === 'pass').length;
  const warnCount = items.filter((i) => i.severity === 'warning').length;
  const failCount = items.filter((i) => i.severity === 'fail').length;
  const totalCount = items.length;

  const selectedReturn = returns?.data?.find((r: any) => r.id === selectedReturnId);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
          COMPLIANCE & AUDIT
        </span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">Compliance</span> & Audit Risk
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Run IRS compliance checks, identify audit triggers, and receive actionable recommendations.
        </p>
      </div>

      {/* Return Selector + Action */}
      <div
        className="rounded-2xl border p-6 mb-8"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck size={20} style={{ color: 'var(--ept-accent)' }} />
          <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
            Select Return
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>
              Tax Return
            </label>
            <select
              value={selectedReturnId}
              onChange={(e) => handleReturnSelect(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{
                backgroundColor: 'var(--ept-surface)',
                borderColor: 'var(--ept-border)',
                color: 'var(--ept-text)',
              }}
            >
              <option value="">Select a return...</option>
              {returns?.data?.map((r: any) => (
                <option key={r.id} value={r.id}>
                  Form {r.return_type} {r.tax_year} &mdash; {r.status} ({r.id?.slice(0, 8)}...)
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <button
              onClick={runComplianceCheck}
              disabled={running || !selectedReturnId}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: 'var(--ept-accent)' }}
            >
              {running ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              {running ? 'Running...' : 'Run Compliance Check'}
            </button>
            {report && (
              <button
                onClick={loadReport}
                disabled={loading}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold border flex items-center gap-2"
                style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* Selected return info */}
        {selectedReturn && (
          <div
            className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4"
            style={{ borderColor: 'var(--ept-border)' }}
          >
            {[
              { label: 'Form', value: selectedReturn.return_type },
              { label: 'Tax Year', value: selectedReturn.tax_year },
              { label: 'Status', value: selectedReturn.status?.toUpperCase() },
              {
                label: 'AGI',
                value: selectedReturn.adjusted_gross_income
                  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(selectedReturn.adjusted_gross_income)
                  : 'N/A',
              },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--ept-text-muted)' }}>
                  {item.label}
                </div>
                <div
                  className="text-sm font-bold"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-text)' }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-xl border p-4 mb-6 flex items-center gap-3"
          style={{ backgroundColor: 'var(--ept-danger-bg)', borderColor: 'var(--ept-danger)' }}
        >
          <XCircle size={18} style={{ color: 'var(--ept-danger)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--ept-danger)' }}>
            {error}
          </span>
        </div>
      )}

      {/* Report Content */}
      {report && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main checklist */}
          <div className="lg:col-span-2 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: 'Total Checks',
                  value: report.total_checks ?? totalCount,
                  icon: FileText,
                  color: 'var(--ept-accent)',
                  bgColor: 'var(--ept-accent-glow)',
                },
                {
                  label: 'Passed',
                  value: report.passed ?? passCount,
                  icon: CheckCircle2,
                  color: 'var(--ept-success)',
                  bgColor: 'var(--ept-success-bg)',
                },
                {
                  label: 'Warnings',
                  value: report.warnings ?? warnCount,
                  icon: AlertTriangle,
                  color: 'var(--ept-warning)',
                  bgColor: 'var(--ept-warning-bg)',
                },
                {
                  label: 'Failures',
                  value: report.failures ?? failCount,
                  icon: XCircle,
                  color: 'var(--ept-danger)',
                  bgColor: 'var(--ept-danger-bg)',
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border p-4 card-hover"
                  style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: card.bgColor, color: card.color }}
                    >
                      <card.icon size={14} />
                    </div>
                  </div>
                  <div
                    className="text-2xl font-extrabold"
                    style={{ fontFamily: "'JetBrains Mono', monospace", color: card.color }}
                  >
                    {card.value}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest mt-1" style={{ color: 'var(--ept-text-muted)' }}>
                    {card.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {(['all', 'fail', 'warning', 'pass', 'info'] as const).map((sev) => {
                const isActive = filterSeverity === sev;
                const count =
                  sev === 'all' ? totalCount : items.filter((i) => i.severity === sev).length;
                return (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider border transition-all"
                    style={{
                      backgroundColor: isActive ? 'var(--ept-accent-glow)' : 'transparent',
                      borderColor: isActive ? 'var(--ept-accent)' : 'var(--ept-border)',
                      color: isActive ? 'var(--ept-accent)' : 'var(--ept-text-muted)',
                    }}
                  >
                    {sev === 'all' ? 'All' : sev} ({count})
                  </button>
                );
              })}
            </div>

            {/* Checklist */}
            <div className="space-y-3">
              {filteredItems.length === 0 && (
                <div
                  className="rounded-2xl border p-8 text-center"
                  style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
                >
                  <ShieldCheck size={40} className="mx-auto mb-3" style={{ color: 'var(--ept-text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>
                    No items match the selected filter.
                  </p>
                </div>
              )}

              {filteredItems.map((item, idx) => {
                const config = severityConfig[item.severity] || severityConfig.info;
                const IconComp = config.icon;
                const isExpanded = expandedItems.has(idx);

                return (
                  <div
                    key={idx}
                    className="rounded-xl border overflow-hidden transition-all"
                    style={{
                      backgroundColor: 'var(--ept-card-bg)',
                      borderColor: 'var(--ept-card-border)',
                      borderLeftWidth: '4px',
                      borderLeftColor: config.fg,
                    }}
                  >
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="w-full flex items-center gap-3 p-4 text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: config.bg, color: config.fg }}
                      >
                        <IconComp size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold truncate" style={{ color: 'var(--ept-text)' }}>
                            {item.rule}
                          </span>
                          <span
                            className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0"
                            style={{ backgroundColor: config.bg, color: config.fg }}
                          >
                            {config.label}
                          </span>
                        </div>
                        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--ept-text-secondary)' }}>
                          {item.description}
                        </div>
                      </div>
                      <ChevronDown
                        size={16}
                        className="shrink-0 transition-transform"
                        style={{
                          color: 'var(--ept-text-muted)',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      />
                    </button>

                    {isExpanded && (item.details || item.recommendation || item.code) && (
                      <div className="px-4 pb-4 pt-0 space-y-3" style={{ borderTop: '1px solid var(--ept-border)' }}>
                        {item.details && (
                          <div>
                            <div
                              className="text-[10px] uppercase tracking-widest font-semibold mb-1"
                              style={{ color: 'var(--ept-text-muted)' }}
                            >
                              Details
                            </div>
                            <div className="text-xs leading-relaxed" style={{ color: 'var(--ept-text-secondary)' }}>
                              {item.details}
                            </div>
                          </div>
                        )}
                        {item.code && (
                          <div>
                            <div
                              className="text-[10px] uppercase tracking-widest font-semibold mb-1"
                              style={{ color: 'var(--ept-text-muted)' }}
                            >
                              IRC Reference
                            </div>
                            <span
                              className="inline-flex px-2 py-1 rounded text-xs"
                              style={{
                                backgroundColor: 'var(--ept-surface)',
                                color: 'var(--ept-accent)',
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {item.code}
                            </span>
                          </div>
                        )}
                        {item.recommendation && (
                          <div>
                            <div
                              className="text-[10px] uppercase tracking-widest font-semibold mb-1"
                              style={{ color: 'var(--ept-text-muted)' }}
                            >
                              Recommendation
                            </div>
                            <div
                              className="text-xs leading-relaxed p-3 rounded-lg"
                              style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text)' }}
                            >
                              {item.recommendation}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Audit Risk Gauge */}
            {report.audit_risk_score != null && (
              <div
                className="rounded-2xl border p-6 card-hover"
                style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 size={16} style={{ color: 'var(--ept-accent)' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    Audit Risk Score
                  </h3>
                </div>
                <AuditRiskGauge score={report.audit_risk_score} level={report.audit_risk_level} />
                <p className="text-xs text-center mt-4 leading-relaxed" style={{ color: 'var(--ept-text-muted)' }}>
                  Score based on DIF criteria, statistical norms, and known IRS audit triggers.
                </p>
              </div>
            )}

            {/* Overall Status */}
            <div
              className="rounded-2xl border p-6 card-hover"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} style={{ color: 'var(--ept-accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                  Overall Status
                </h3>
              </div>
              <div className="text-center">
                <div
                  className="inline-flex px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor:
                      report.overall_status === 'pass' || report.overall_status === 'compliant'
                        ? 'var(--ept-success-bg)'
                        : report.overall_status === 'warning'
                          ? 'var(--ept-warning-bg)'
                          : 'var(--ept-danger-bg)',
                    color:
                      report.overall_status === 'pass' || report.overall_status === 'compliant'
                        ? 'var(--ept-success)'
                        : report.overall_status === 'warning'
                          ? 'var(--ept-warning)'
                          : 'var(--ept-danger)',
                  }}
                >
                  {report.overall_status}
                </div>
              </div>
              {report.checked_at && (
                <div className="flex items-center justify-center gap-1 mt-3">
                  <Clock size={12} style={{ color: 'var(--ept-text-muted)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                    {new Date(report.checked_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Pass Rate */}
            {totalCount > 0 && (
              <div
                className="rounded-2xl border p-6 card-hover"
                style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={16} style={{ color: 'var(--ept-accent)' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    Pass Rate
                  </h3>
                </div>
                <div className="text-center mb-3">
                  <span
                    className="text-3xl font-extrabold"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: passCount / totalCount >= 0.8 ? 'var(--ept-success)' : passCount / totalCount >= 0.5 ? 'var(--ept-warning)' : 'var(--ept-danger)',
                    }}
                  >
                    {Math.round((passCount / totalCount) * 100)}%
                  </span>
                </div>
                {/* Stacked bar */}
                <div className="w-full h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--ept-border)' }}>
                  {passCount > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(passCount / totalCount) * 100}%`,
                        backgroundColor: 'var(--ept-success)',
                      }}
                    />
                  )}
                  {warnCount > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(warnCount / totalCount) * 100}%`,
                        backgroundColor: 'var(--ept-warning)',
                      }}
                    />
                  )}
                  {failCount > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(failCount / totalCount) * 100}%`,
                        backgroundColor: 'var(--ept-danger)',
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--ept-success)' }}>{passCount} pass</span>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--ept-warning)' }}>{warnCount} warn</span>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--ept-danger)' }}>{failCount} fail</span>
                </div>
              </div>
            )}

            {/* Common Audit Triggers */}
            <div
              className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--ept-text)' }}>
                Common Audit Triggers
              </h3>
              <div className="space-y-2">
                {[
                  'High deductions relative to income',
                  'Large charitable contributions',
                  'Home office deductions',
                  'Unreported 1099 income',
                  'Round number entries',
                  'Schedule C losses (3+ years)',
                  'Foreign accounts (FBAR)',
                  'Crypto transactions',
                ].map((trigger) => (
                  <div
                    key={trigger}
                    className="flex items-center gap-2 text-xs"
                    style={{ color: 'var(--ept-text-secondary)' }}
                  >
                    <AlertTriangle size={10} style={{ color: 'var(--ept-warning)' }} />
                    {trigger}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!report && !running && !loading && (
        <div
          className="rounded-2xl border p-16 text-center"
          style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
        >
          <ShieldCheck size={56} className="mx-auto mb-4" style={{ color: 'var(--ept-text-muted)' }} />
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--ept-text)' }}>
            No Compliance Report
          </h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--ept-text-muted)' }}>
            Select a tax return above and run a compliance check to identify potential audit triggers,
            filing errors, and optimization opportunities.
          </p>
        </div>
      )}

      {/* Loading state */}
      {(loading || running) && !report && (
        <div
          className="rounded-2xl border p-16 text-center"
          style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
        >
          <RefreshCw size={40} className="mx-auto mb-4 animate-spin" style={{ color: 'var(--ept-accent)' }} />
          <h3 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
            {running ? 'Running Compliance Checks...' : 'Loading Report...'}
          </h3>
          <p className="text-sm mt-2" style={{ color: 'var(--ept-text-muted)' }}>
            Analyzing return against IRS compliance rules and audit risk factors.
          </p>
        </div>
      )}
    </div>
  );
}
