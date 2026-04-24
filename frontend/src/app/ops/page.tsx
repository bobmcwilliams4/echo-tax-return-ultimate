'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import {
  Activity,
  Server,
  Database,
  Cpu,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  BarChart3,
  Zap,
  HardDrive,
  Layers,
  BookOpen,
  ToggleLeft,
  ToggleRight,
  Shield,
  Wifi,
  WifiOff,
} from 'lucide-react';

const ENGINE_NAMES: Record<string, string> = {
  TIE: 'Tax Intelligence',
  FIE: 'Federal Income',
  STE: 'State Tax',
  BIE: 'Business',
  CRE: 'Credits',
  DEP: 'Depreciation',
  CRY: 'Crypto',
  AUD: 'Audit Risk',
  PLN: 'Planning',
  PIE: 'Product Intel',
  ARCS: 'Audit Calc',
  INT: 'International',
  EST: 'Estate',
  LEG: 'Legal',
};

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'up' || status === 'healthy' || status === 'ok' || status === 'connected'
      ? 'var(--ept-success, #22c55e)'
      : status === 'degraded' || status === 'slow'
        ? 'var(--ept-warning, #f59e0b)'
        : 'var(--ept-danger, #ef4444)';

  return (
    <div className="relative flex items-center justify-center">
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {(status === 'up' || status === 'healthy' || status === 'ok' || status === 'connected') && (
        <div className="absolute w-2.5 h-2.5 rounded-full animate-ping opacity-30" style={{ backgroundColor: color }} />
      )}
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-2xl border p-5 card-hover" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${color}20`, color }}>
        <Icon size={16} />
      </div>
      <div className="text-2xl font-extrabold" style={{ ...mono, color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest font-medium mt-1" style={{ color: 'var(--ept-text-muted)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--ept-text-muted)' }}>{sub}</div>}
    </div>
  );
}

export default function OpsPage() {
  const [health, setHealth] = useState<any>(null);
  const [deep, setDeep] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [runtime, setRuntime] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [h, d, m, r] = await Promise.allSettled([
        api.opsHealth(),
        api.opsDeep(),
        api.getMetrics(),
        api.runtimeStats(),
      ]);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (d.status === 'fulfilled') setDeep(d.value);
      if (m.status === 'fulfilled') setMetrics(m.value);
      if (r.status === 'fulfilled') setRuntime(r.value);
      setLastRefresh(new Date());
    } catch {
      setError('Failed to fetch operations data');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchAll, 10000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchAll]);

  const overallStatus = health?.status || deep?.status || 'unknown';
  const engines = health?.services?.engines || health?.data?.services?.engines || deep?.engines || deep?.data?.engines || {};
  const dbStatus = deep?.database || deep?.data?.database || health?.services?.database || health?.data?.services?.database || {};
  const cacheStatus = deep?.cache || deep?.data?.cache || health?.services?.cache || health?.data?.services?.cache || {};

  const metricsData = metrics?.data || metrics || {};
  const totalRequests = metricsData.total_requests ?? metricsData.requests ?? 0;
  const errorRate = metricsData.error_rate ?? metricsData.errors_percent ?? 0;
  const avgLatency = metricsData.avg_latency_ms ?? metricsData.latency_avg ?? 0;
  const endpointGroups = metricsData.endpoint_groups || metricsData.endpoints || metricsData.by_endpoint || {};

  const runtimeData = runtime?.data || runtime || {};
  const engineCount = runtimeData.engine_count ?? runtimeData.total_engines ?? 0;
  const doctrineCount = runtimeData.doctrine_count ?? runtimeData.total_doctrines ?? 0;
  const categories = runtimeData.categories ?? runtimeData.category_count ?? 0;

  const engineEntries = Object.entries(engines).length > 0
    ? Object.entries(engines)
    : Object.keys(ENGINE_NAMES).map(k => [k, 'unknown'] as [string, unknown]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
            SYSTEM OPERATIONS
          </span>
          <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
            <span className="gradient-text">Operations</span> & Monitoring
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
            Real-time system health, engine status, and performance metrics
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Auto-Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all"
            style={{
              backgroundColor: autoRefresh ? 'var(--ept-accent)' : 'var(--ept-surface)',
              borderColor: autoRefresh ? 'var(--ept-accent)' : 'var(--ept-border)',
              color: autoRefresh ? '#ffffff' : 'var(--ept-text-secondary)',
            }}
          >
            {autoRefresh ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            {autoRefresh ? 'Auto (10s)' : 'Auto Off'}
          </button>

          {/* Manual Refresh */}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--ept-accent)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-2xl border p-4 mb-6 flex items-center gap-3" style={{ backgroundColor: 'var(--ept-danger-bg, rgba(239,68,68,0.1))', borderColor: 'var(--ept-danger, #ef4444)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--ept-danger, #ef4444)' }} />
          <span className="text-sm" style={{ color: 'var(--ept-danger, #ef4444)' }}>{error}</span>
        </div>
      )}

      {/* Overall Status Banner */}
      <div
        className="rounded-2xl border p-5 mb-6 flex items-center justify-between"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: overallStatus === 'healthy' || overallStatus === 'ok' || overallStatus === 'up'
                ? 'rgba(34,197,94,0.15)'
                : overallStatus === 'degraded'
                  ? 'rgba(245,158,11,0.15)'
                  : 'rgba(239,68,68,0.15)',
            }}
          >
            {overallStatus === 'healthy' || overallStatus === 'ok' || overallStatus === 'up' ? (
              <CheckCircle size={24} style={{ color: 'var(--ept-success, #22c55e)' }} />
            ) : overallStatus === 'degraded' ? (
              <AlertTriangle size={24} style={{ color: 'var(--ept-warning, #f59e0b)' }} />
            ) : (
              <XCircle size={24} style={{ color: 'var(--ept-danger, #ef4444)' }} />
            )}
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
              System {overallStatus === 'healthy' || overallStatus === 'ok' || overallStatus === 'up' ? 'Operational' : overallStatus === 'degraded' ? 'Degraded' : overallStatus === 'unknown' ? 'Loading...' : 'Down'}
            </div>
            <div className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>
              {lastRefresh ? `Last checked: ${lastRefresh.toLocaleTimeString()}` : 'Checking...'}
              {autoRefresh && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <Wifi size={10} style={{ color: 'var(--ept-success, #22c55e)' }} />
                  Live
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ ...mono, color: 'var(--ept-text-muted)' }}>
          <span>v{health?.version || health?.data?.version || '5.0'}</span>
          <span style={{ color: 'var(--ept-border)' }}>|</span>
          <span>{health?.uptime || health?.data?.uptime || '--'}</span>
        </div>
      </div>

      {/* Top Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          icon={Activity}
          color="var(--ept-accent)"
        />
        <MetricCard
          label="Error Rate"
          value={typeof errorRate === 'number' ? `${(errorRate * 100).toFixed(2)}%` : errorRate}
          icon={AlertTriangle}
          color={errorRate > 0.05 ? 'var(--ept-danger, #ef4444)' : errorRate > 0.01 ? 'var(--ept-warning, #f59e0b)' : 'var(--ept-success, #22c55e)'}
        />
        <MetricCard
          label="Avg Latency"
          value={typeof avgLatency === 'number' ? `${avgLatency.toFixed(0)}ms` : avgLatency}
          icon={Clock}
          color={avgLatency > 1000 ? 'var(--ept-danger, #ef4444)' : avgLatency > 500 ? 'var(--ept-warning, #f59e0b)' : 'var(--ept-info, #3b82f6)'}
        />
        <MetricCard
          label="Engines"
          value={engineCount}
          sub={`${doctrineCount.toLocaleString()} doctrines`}
          icon={Cpu}
          color="var(--ept-purple, #8b5cf6)"
        />
      </div>

      {/* Engine Status Grid */}
      <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        <div className="flex items-center gap-3 mb-5">
          <Cpu size={18} style={{ color: 'var(--ept-accent)' }} />
          <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>Doctrine Engine Status</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)', ...mono }}>
            {Object.values(engines).filter((s: any) => s === 'up' || s === 'healthy' || s === 'ok').length}/{Object.keys(engines).length || 14} UP
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {engineEntries.map(([id, status]) => {
            const s = String(status);
            const isUp = s === 'up' || s === 'healthy' || s === 'ok';
            const isDegraded = s === 'degraded' || s === 'slow';

            return (
              <div
                key={id}
                className="rounded-xl border p-4 transition-all"
                style={{
                  backgroundColor: 'var(--ept-surface)',
                  borderColor: isUp
                    ? 'var(--ept-success, #22c55e)'
                    : isDegraded
                      ? 'var(--ept-warning, #f59e0b)'
                      : s === 'unknown'
                        ? 'var(--ept-border)'
                        : 'var(--ept-danger, #ef4444)',
                  borderWidth: '1px',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-extrabold" style={{ ...mono, color: 'var(--ept-text)' }}>{id}</span>
                  <StatusDot status={s} />
                </div>
                <div className="text-[10px] truncate" style={{ color: 'var(--ept-text-muted)' }}>
                  {ENGINE_NAMES[id] || id}
                </div>
                <div
                  className="text-[9px] font-bold uppercase tracking-wider mt-1"
                  style={{
                    color: isUp
                      ? 'var(--ept-success, #22c55e)'
                      : isDegraded
                        ? 'var(--ept-warning, #f59e0b)'
                        : s === 'unknown'
                          ? 'var(--ept-text-muted)'
                          : 'var(--ept-danger, #ef4444)',
                  }}
                >
                  {s}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Requests per Endpoint Group */}
        <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <div className="flex items-center gap-3 mb-5">
            <BarChart3 size={18} style={{ color: 'var(--ept-accent)' }} />
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>Requests by Endpoint</h2>
          </div>

          {Object.keys(endpointGroups).length > 0 ? (
            <div className="space-y-3">
              {(() => {
                const entries = Object.entries(endpointGroups) as [string, any][];
                const maxVal = Math.max(...entries.map(([, v]) => (typeof v === 'number' ? v : v?.count ?? v?.requests ?? 0)));
                return entries.map(([group, val]) => {
                  const count = typeof val === 'number' ? val : val?.count ?? val?.requests ?? 0;
                  const errCount = typeof val === 'object' ? (val?.errors ?? 0) : 0;
                  const pct = maxVal > 0 ? (count / maxVal) * 100 : 0;

                  return (
                    <div key={group}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--ept-text)' }}>{group}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold" style={{ ...mono, color: 'var(--ept-text)' }}>{count.toLocaleString()}</span>
                          {errCount > 0 && (
                            <span className="text-[10px]" style={{ ...mono, color: 'var(--ept-danger, #ef4444)' }}>({errCount} err)</span>
                          )}
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ept-surface)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(1, pct)}%`,
                            backgroundColor: 'var(--ept-accent)',
                            opacity: 0.75,
                          }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="py-8 text-center">
              <BarChart3 size={24} className="mx-auto mb-2" style={{ color: 'var(--ept-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>No endpoint metrics available yet</p>
            </div>
          )}
        </div>

        {/* Infrastructure Status */}
        <div className="space-y-4">
          {/* Database */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Database size={18} style={{ color: 'var(--ept-info, #3b82f6)' }} />
              <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-info, #3b82f6)' }}>Database</h3>
            </div>
            {typeof dbStatus === 'object' && Object.keys(dbStatus).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(dbStatus).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs capitalize" style={{ color: 'var(--ept-text-secondary)' }}>
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs font-bold" style={{ ...mono, color: 'var(--ept-text)' }}>
                      {typeof val === 'boolean' ? (
                        val ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle size={12} style={{ color: 'var(--ept-success, #22c55e)' }} /> OK
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <XCircle size={12} style={{ color: 'var(--ept-danger, #ef4444)' }} /> DOWN
                          </span>
                        )
                      ) : typeof val === 'string' && (val === 'up' || val === 'ok' || val === 'connected' || val === 'healthy') ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle size={12} style={{ color: 'var(--ept-success, #22c55e)' }} /> {String(val).toUpperCase()}
                        </span>
                      ) : (
                        String(val)
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <StatusDot status={typeof dbStatus === 'string' ? dbStatus : 'unknown'} />
                <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>
                  {typeof dbStatus === 'string' ? dbStatus : 'Status unavailable'}
                </span>
              </div>
            )}
          </div>

          {/* Cache */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Zap size={18} style={{ color: 'var(--ept-success, #22c55e)' }} />
              <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-success, #22c55e)' }}>Cache</h3>
            </div>
            {typeof cacheStatus === 'object' && Object.keys(cacheStatus).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(cacheStatus).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs capitalize" style={{ color: 'var(--ept-text-secondary)' }}>
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs font-bold" style={{ ...mono, color: 'var(--ept-text)' }}>
                      {typeof val === 'number' && key.toLowerCase().includes('rate')
                        ? `${(val * 100).toFixed(1)}%`
                        : typeof val === 'number'
                          ? val.toLocaleString()
                          : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <StatusDot status={typeof cacheStatus === 'string' ? cacheStatus : 'unknown'} />
                <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>
                  {typeof cacheStatus === 'string' ? cacheStatus : 'Status unavailable'}
                </span>
              </div>
            )}
          </div>

          {/* Runtime Stats */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Layers size={18} style={{ color: 'var(--ept-purple, #8b5cf6)' }} />
              <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-purple, #8b5cf6)' }}>Runtime</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu size={12} style={{ color: 'var(--ept-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>Engines Loaded</span>
                </div>
                <span className="text-sm font-extrabold" style={{ ...mono, color: 'var(--ept-accent)' }}>{engineCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen size={12} style={{ color: 'var(--ept-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>Doctrines</span>
                </div>
                <span className="text-sm font-extrabold" style={{ ...mono, color: 'var(--ept-info, #3b82f6)' }}>{doctrineCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={12} style={{ color: 'var(--ept-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>Categories</span>
                </div>
                <span className="text-sm font-extrabold" style={{ ...mono, color: 'var(--ept-purple, #8b5cf6)' }}>
                  {typeof categories === 'number' ? categories : Array.isArray(categories) ? categories.length : '--'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Deep Health Details */}
      {deep && (deep.checks || deep.data?.checks) && (
        <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <div className="flex items-center gap-3 mb-5">
            <Shield size={18} style={{ color: 'var(--ept-accent)' }} />
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>Deep Health Checks</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(deep.checks || deep.data?.checks || {}).map(([name, check]: [string, any]) => {
              const passed = check?.passed != null ? check.passed : (check?.status === 'ok' || check === true);
              const detail = typeof check === 'object' ? (check?.detail || check?.message || check?.status || '') : String(check);
              const latency = typeof check === 'object' ? check?.latency_ms : null;

              return (
                <div
                  key={name}
                  className="flex items-center gap-3 p-3 rounded-xl border"
                  style={{
                    backgroundColor: 'var(--ept-surface)',
                    borderColor: passed ? 'var(--ept-success, #22c55e)' : 'var(--ept-danger, #ef4444)',
                    borderWidth: '1px',
                  }}
                >
                  {passed ? (
                    <CheckCircle size={16} style={{ color: 'var(--ept-success, #22c55e)' }} />
                  ) : (
                    <XCircle size={16} style={{ color: 'var(--ept-danger, #ef4444)' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold capitalize truncate" style={{ color: 'var(--ept-text)' }}>
                      {name.replace(/_/g, ' ')}
                    </div>
                    {detail && (
                      <div className="text-[10px] truncate" style={{ color: 'var(--ept-text-muted)' }}>{String(detail)}</div>
                    )}
                  </div>
                  {latency != null && (
                    <span className="text-[10px] shrink-0" style={{ ...mono, color: 'var(--ept-text-muted)' }}>
                      {latency}ms
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Additional Metrics from deep or metrics */}
      {metricsData.response_times && (
        <div className="rounded-2xl border p-6 mt-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
          <div className="flex items-center gap-3 mb-5">
            <Clock size={18} style={{ color: 'var(--ept-info, #3b82f6)' }} />
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ept-info, #3b82f6)' }}>Response Time Percentiles</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(metricsData.response_times).map(([percentile, ms]) => (
              <div key={percentile} className="text-center p-4 rounded-xl" style={{ backgroundColor: 'var(--ept-surface)' }}>
                <div className="text-xl font-extrabold" style={{ ...mono, color: 'var(--ept-text)' }}>
                  {typeof ms === 'number' ? `${ms.toFixed(0)}ms` : String(ms)}
                </div>
                <div className="text-[10px] uppercase tracking-widest font-medium mt-1" style={{ color: 'var(--ept-text-muted)' }}>
                  {percentile}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
