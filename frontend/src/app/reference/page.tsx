'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BookOpen, DollarSign, PiggyBank, Car, CalendarDays, ChevronRight, TrendingUp, AlertCircle } from 'lucide-react';

const FILING_STATUSES = [
  { id: 'single', label: 'Single' },
  { id: 'mfj', label: 'Married Filing Jointly' },
  { id: 'mfs', label: 'Married Filing Separately' },
  { id: 'hoh', label: 'Head of Household' },
];

const YEARS = [2025, 2024];
const MILEAGE_YEARS = [2025, 2024, 2023];

const ACCOUNT_TYPES = [
  { id: '', label: 'All Accounts' },
  { id: '401k', label: '401(k)' },
  { id: 'ira', label: 'IRA' },
  { id: 'hsa', label: 'HSA' },
  { id: 'fsa', label: 'FSA' },
];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const fmtRate = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

const fmtCents = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

type Section = 'brackets' | 'deductions' | 'limits' | 'mileage' | 'calendar';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'brackets', label: 'Tax Brackets', icon: <TrendingUp size={16} /> },
  { id: 'deductions', label: 'Standard Deduction', icon: <DollarSign size={16} /> },
  { id: 'limits', label: 'Contribution Limits', icon: <PiggyBank size={16} /> },
  { id: 'mileage', label: 'Mileage Rates', icon: <Car size={16} /> },
  { id: 'calendar', label: 'Tax Calendar', icon: <CalendarDays size={16} /> },
];

export default function ReferencePage() {
  const [activeSection, setActiveSection] = useState<Section>('brackets');
  const [bracketYear, setBracketYear] = useState(2025);
  const [bracketStatus, setBracketStatus] = useState('single');
  const [brackets, setBrackets] = useState<any>(null);
  const [bracketsLoading, setBracketsLoading] = useState(false);

  const [deductionYear, setDeductionYear] = useState(2025);
  const [deductions, setDeductions] = useState<any>(null);
  const [deductionsLoading, setDeductionsLoading] = useState(false);

  const [limitsYear, setLimitsYear] = useState(2025);
  const [limitsAccount, setLimitsAccount] = useState('');
  const [limits, setLimits] = useState<any>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);

  const [mileageYear, setMileageYear] = useState(2025);
  const [mileage, setMileage] = useState<any>(null);
  const [mileageLoading, setMileageLoading] = useState(false);

  const [calendar, setCalendar] = useState<any>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Load brackets
  useEffect(() => {
    if (activeSection !== 'brackets') return;
    setBracketsLoading(true);
    api.getBrackets(bracketYear, bracketStatus)
      .then(setBrackets)
      .catch(() => setBrackets(null))
      .finally(() => setBracketsLoading(false));
  }, [bracketYear, bracketStatus, activeSection]);

  // Load deductions
  useEffect(() => {
    if (activeSection !== 'deductions') return;
    setDeductionsLoading(true);
    api.getStdDeduction(deductionYear)
      .then(setDeductions)
      .catch(() => setDeductions(null))
      .finally(() => setDeductionsLoading(false));
  }, [deductionYear, activeSection]);

  // Load limits
  useEffect(() => {
    if (activeSection !== 'limits') return;
    setLimitsLoading(true);
    api.getLimits(limitsYear, limitsAccount || undefined)
      .then(setLimits)
      .catch(() => setLimits(null))
      .finally(() => setLimitsLoading(false));
  }, [limitsYear, limitsAccount, activeSection]);

  // Load mileage
  useEffect(() => {
    if (activeSection !== 'mileage') return;
    setMileageLoading(true);
    api.getMileage(mileageYear)
      .then(setMileage)
      .catch(() => setMileage(null))
      .finally(() => setMileageLoading(false));
  }, [mileageYear, activeSection]);

  // Load calendar
  useEffect(() => {
    if (activeSection !== 'calendar') return;
    setCalendarLoading(true);
    api.getCalendar(2025)
      .then(setCalendar)
      .catch(() => setCalendar(null))
      .finally(() => setCalendarLoading(false));
  }, [activeSection]);

  const renderBrackets = () => {
    const data = brackets?.data?.brackets || brackets?.brackets || brackets?.data || [];
    const bracketList = Array.isArray(data) ? data : [];

    return (
      <div>
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--ept-card-border)' }}>
            {YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setBracketYear(y)}
                className="px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: bracketYear === y ? 'var(--ept-accent)' : 'var(--ept-surface)',
                  color: bracketYear === y ? '#000' : 'var(--ept-text-secondary)',
                }}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--ept-card-border)' }}>
            {FILING_STATUSES.map((s) => (
              <button
                key={s.id}
                onClick={() => setBracketStatus(s.id)}
                className="px-3 py-2 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: bracketStatus === s.id ? 'var(--ept-accent)' : 'var(--ept-surface)',
                  color: bracketStatus === s.id ? '#000' : 'var(--ept-text-secondary)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {bracketsLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Loading brackets...</div>
        ) : bracketList.length === 0 ? (
          <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <p style={{ color: 'var(--ept-text-secondary)' }}>
              {brackets ? 'No bracket data returned. The API response:' : 'Failed to load bracket data.'}
            </p>
            {brackets && (
              <pre className="mt-3 text-xs overflow-auto p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-muted)', ...mono }}>
                {JSON.stringify(brackets, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--ept-surface)' }}>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ept-text-secondary)' }}>Rate</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ept-text-secondary)' }}>Taxable Income Range</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ept-text-secondary)' }}>Tax on Bracket</th>
                </tr>
              </thead>
              <tbody>
                {bracketList.map((b: any, i: number) => {
                  const rate = b.rate ?? b.tax_rate ?? 0;
                  const min = b.min ?? b.range_min ?? b.income_from ?? 0;
                  const max = b.max ?? b.range_max ?? b.income_to ?? null;
                  const bracketTax = max ? (max - min) * rate : null;

                  return (
                    <tr
                      key={i}
                      className="border-t"
                      style={{ borderColor: 'var(--ept-card-border)' }}
                    >
                      <td className="px-5 py-3" style={mono}>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-bold" style={{ backgroundColor: `rgba(var(--ept-accent-rgb, 59, 130, 246), ${0.1 + (rate * 0.6)})`, color: 'var(--ept-accent)' }}>
                          {(rate * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm" style={{ color: 'var(--ept-text)', ...mono }}>
                        {fmt(min)} &mdash; {max ? fmt(max) : 'and above'}
                      </td>
                      <td className="px-5 py-3 text-sm text-right" style={{ color: 'var(--ept-text-secondary)', ...mono }}>
                        {bracketTax !== null ? fmt(bracketTax) : '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
          {bracketYear} federal income tax brackets for {FILING_STATUSES.find(s => s.id === bracketStatus)?.label}. Marginal rates apply only to income within each bracket range.
        </p>
      </div>
    );
  };

  const renderDeductions = () => {
    const data = deductions?.data || deductions;
    const statuses = data?.statuses || data?.deductions || null;

    return (
      <div>
        <div className="flex rounded-lg overflow-hidden border mb-6" style={{ borderColor: 'var(--ept-card-border)' }}>
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setDeductionYear(y)}
              className="px-4 py-2 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: deductionYear === y ? 'var(--ept-accent)' : 'var(--ept-surface)',
                color: deductionYear === y ? '#000' : 'var(--ept-text-secondary)',
              }}
            >
              {y}
            </button>
          ))}
        </div>

        {deductionsLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Loading deductions...</div>
        ) : !data ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Failed to load deduction data.</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {FILING_STATUSES.map((s) => {
              const statusData = statuses?.[s.id] || data?.[s.id];
              const amount = statusData?.amount ?? statusData?.standard ?? statusData;
              const over65 = statusData?.over_65 ?? statusData?.additional_over_65 ?? statusData?.elderly_additional ?? null;
              const blind = statusData?.blind ?? statusData?.additional_blind ?? statusData?.blind_additional ?? null;

              return (
                <div
                  key={s.id}
                  className="card-hover rounded-xl border p-5"
                  style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--ept-text)' }}>{s.label}</h3>
                    <DollarSign size={16} style={{ color: 'var(--ept-accent)' }} />
                  </div>
                  <div className="text-2xl font-extrabold mb-3" style={{ color: 'var(--ept-accent)', ...mono }}>
                    {typeof amount === 'number' ? fmt(amount) : (
                      <span className="text-base" style={{ color: 'var(--ept-text-muted)' }}>N/A</span>
                    )}
                  </div>
                  {(over65 || blind) && (
                    <div className="space-y-1 pt-3 border-t" style={{ borderColor: 'var(--ept-card-border)' }}>
                      <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--ept-text-muted)' }}>Additional Amounts</p>
                      {over65 && (
                        <div className="flex justify-between text-sm">
                          <span style={{ color: 'var(--ept-text-secondary)' }}>Age 65+</span>
                          <span style={{ color: 'var(--ept-text)', ...mono }}>+{fmt(typeof over65 === 'number' ? over65 : 0)}</span>
                        </div>
                      )}
                      {blind && (
                        <div className="flex justify-between text-sm">
                          <span style={{ color: 'var(--ept-text-secondary)' }}>Blind</span>
                          <span style={{ color: 'var(--ept-text)', ...mono }}>+{fmt(typeof blind === 'number' ? blind : 0)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data && !statuses && !data?.single && (
          <div className="mt-4 rounded-xl border p-4" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--ept-text-muted)' }}>Raw API response:</p>
            <pre className="text-xs overflow-auto p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-muted)', ...mono }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
          {deductionYear} standard deduction amounts. Taxpayers who are age 65+ or blind may claim additional deduction amounts per qualifying condition.
        </p>
      </div>
    );
  };

  const renderLimits = () => {
    const data = limits?.data || limits?.limits || limits;
    const limitsList = Array.isArray(data) ? data : null;

    return (
      <div>
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--ept-card-border)' }}>
            {YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setLimitsYear(y)}
                className="px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: limitsYear === y ? 'var(--ept-accent)' : 'var(--ept-surface)',
                  color: limitsYear === y ? '#000' : 'var(--ept-text-secondary)',
                }}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--ept-card-border)' }}>
            {ACCOUNT_TYPES.map((a) => (
              <button
                key={a.id}
                onClick={() => setLimitsAccount(a.id)}
                className="px-3 py-2 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: limitsAccount === a.id ? 'var(--ept-accent)' : 'var(--ept-surface)',
                  color: limitsAccount === a.id ? '#000' : 'var(--ept-text-secondary)',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {limitsLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Loading contribution limits...</div>
        ) : limitsList ? (
          <div className="grid md:grid-cols-2 gap-4">
            {limitsList.map((item: any, i: number) => {
              const name = item.account || item.name || item.type || `Account ${i + 1}`;
              const limit = item.limit ?? item.employee_limit ?? item.annual_limit ?? item.amount ?? 0;
              const catchUp = item.catch_up ?? item.catch_up_50 ?? item.additional_catch_up ?? null;
              const employerMatch = item.employer_max ?? item.total_limit ?? item.combined_limit ?? null;

              return (
                <div
                  key={i}
                  className="card-hover rounded-xl border p-5"
                  style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--ept-text)' }}>{name}</h3>
                    <PiggyBank size={16} style={{ color: 'var(--ept-accent)' }} />
                  </div>
                  <div className="text-2xl font-extrabold mb-1" style={{ color: 'var(--ept-accent)', ...mono }}>
                    {fmt(limit)}
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--ept-text-muted)' }}>Annual contribution limit</p>

                  <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--ept-card-border)' }}>
                    {catchUp !== null && catchUp !== undefined && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--ept-text-secondary)' }}>Catch-up (50+)</span>
                        <span style={{ color: 'var(--ept-info)', ...mono }}>+{fmt(catchUp)}</span>
                      </div>
                    )}
                    {catchUp !== null && catchUp !== undefined && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--ept-text-secondary)' }}>Total w/ catch-up</span>
                        <span className="font-bold" style={{ color: 'var(--ept-success)', ...mono }}>{fmt(limit + catchUp)}</span>
                      </div>
                    )}
                    {employerMatch !== null && employerMatch !== undefined && employerMatch !== limit && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--ept-text-secondary)' }}>Combined limit</span>
                        <span style={{ color: 'var(--ept-text)', ...mono }}>{fmt(employerMatch)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : data && typeof data === 'object' && !Array.isArray(data) ? (
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(data).map(([key, val]: [string, any]) => {
              const limit = typeof val === 'number' ? val : val?.limit ?? val?.amount ?? val?.employee_limit ?? 0;
              const catchUp = typeof val === 'object' ? (val?.catch_up ?? val?.catch_up_50 ?? null) : null;

              return (
                <div
                  key={key}
                  className="card-hover rounded-xl border p-5"
                  style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--ept-text)' }}>{key}</h3>
                    <PiggyBank size={16} style={{ color: 'var(--ept-accent)' }} />
                  </div>
                  <div className="text-2xl font-extrabold mb-1" style={{ color: 'var(--ept-accent)', ...mono }}>
                    {fmt(limit)}
                  </div>
                  {catchUp !== null && (
                    <div className="flex justify-between text-sm mt-2 pt-2 border-t" style={{ borderColor: 'var(--ept-card-border)' }}>
                      <span style={{ color: 'var(--ept-text-secondary)' }}>Catch-up (50+)</span>
                      <span style={{ color: 'var(--ept-info)', ...mono }}>+{fmt(catchUp)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <p style={{ color: 'var(--ept-text-secondary)' }}>No limit data available.</p>
            {limits && (
              <pre className="mt-3 text-xs overflow-auto p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-muted)', ...mono }}>
                {JSON.stringify(limits, null, 2)}
              </pre>
            )}
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
          {limitsYear} contribution limits. Catch-up contributions available for taxpayers age 50 and older. Limits are indexed annually for inflation.
        </p>
      </div>
    );
  };

  const renderMileage = () => {
    const data = mileage?.data || mileage?.rates || mileage;
    const business = data?.business ?? data?.business_rate ?? null;
    const medical = data?.medical ?? data?.medical_rate ?? data?.medical_moving ?? null;
    const charity = data?.charity ?? data?.charity_rate ?? null;

    const allYearsData: { year: number; business: number | null; medical: number | null; charity: number | null }[] = [];

    return (
      <div>
        <div className="flex rounded-lg overflow-hidden border mb-6" style={{ borderColor: 'var(--ept-card-border)' }}>
          {MILEAGE_YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setMileageYear(y)}
              className="px-4 py-2 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: mileageYear === y ? 'var(--ept-accent)' : 'var(--ept-surface)',
                color: mileageYear === y ? '#000' : 'var(--ept-text-secondary)',
              }}
            >
              {y}
            </button>
          ))}
        </div>

        {mileageLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Loading mileage rates...</div>
        ) : !data ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Failed to load mileage data.</div>
        ) : (business !== null || medical !== null || charity !== null) ? (
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: 'Business', value: business, icon: <Car size={20} />, description: 'Standard mileage rate for business use of a vehicle', color: 'var(--ept-accent)' },
              { label: 'Medical / Moving', value: medical, icon: <AlertCircle size={20} />, description: 'Rate for medical or qualified military moving purposes', color: 'var(--ept-info)' },
              { label: 'Charity', value: charity, icon: <BookOpen size={20} />, description: 'Rate for driving in service of charitable organizations', color: 'var(--ept-success)' },
            ].map((item) => (
              <div
                key={item.label}
                className="card-hover rounded-xl border p-6 text-center"
                style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
              >
                <div className="flex justify-center mb-3" style={{ color: item.color }}>{item.icon}</div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--ept-text)' }}>{item.label}</h3>
                <div className="text-3xl font-extrabold mb-1" style={{ color: item.color, ...mono }}>
                  {item.value !== null ? `${item.value}\u00A2` : '\u2014'}
                </div>
                <p className="text-xs" style={{ color: 'var(--ept-text-muted)' }}>per mile</p>
                <p className="text-xs mt-3" style={{ color: 'var(--ept-text-secondary)' }}>{item.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--ept-text-muted)' }}>Raw API response:</p>
            <pre className="text-xs overflow-auto p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-muted)', ...mono }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
          {mileageYear} IRS standard mileage rates. Rates are per mile driven. Business rate applies to self-employed individuals and employees with unreimbursed expenses (pre-TCJA).
        </p>
      </div>
    );
  };

  const renderCalendar = () => {
    const data = calendar?.data || calendar?.deadlines || calendar?.events || calendar;
    const events = Array.isArray(data) ? data : null;

    const today = new Date();

    return (
      <div>
        {calendarLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>Loading tax calendar...</div>
        ) : events && events.length > 0 ? (
          <div className="space-y-3">
            {events.map((evt: any, i: number) => {
              const dateStr = evt.date || evt.deadline || evt.due_date || '';
              const evtDate = dateStr ? new Date(dateStr) : null;
              const isPast = evtDate ? evtDate < today : false;
              const isUpcoming = evtDate ? (evtDate >= today && evtDate.getTime() - today.getTime() < 30 * 24 * 60 * 60 * 1000) : false;
              const title = evt.title || evt.name || evt.description || evt.event || 'Tax Deadline';
              const description = evt.description || evt.details || evt.notes || '';
              const form = evt.form || evt.forms || '';

              let statusColor = 'var(--ept-text-muted)';
              let statusLabel = '';
              if (isPast) { statusColor = 'var(--ept-text-muted)'; statusLabel = 'PAST'; }
              else if (isUpcoming) { statusColor = 'var(--ept-warning)'; statusLabel = 'UPCOMING'; }
              else { statusColor = 'var(--ept-success)'; statusLabel = 'FUTURE'; }

              return (
                <div
                  key={i}
                  className="card-hover flex items-start gap-4 rounded-xl border p-4"
                  style={{
                    backgroundColor: 'var(--ept-card-bg)',
                    borderColor: isUpcoming ? 'var(--ept-warning)' : 'var(--ept-card-border)',
                    opacity: isPast ? 0.5 : 1,
                  }}
                >
                  <div className="flex-shrink-0 w-16 text-center">
                    {evtDate ? (
                      <>
                        <div className="text-xs font-semibold uppercase" style={{ color: statusColor }}>
                          {evtDate.toLocaleDateString('en-US', { month: 'short' })}
                        </div>
                        <div className="text-2xl font-extrabold" style={{ color: 'var(--ept-text)', ...mono }}>
                          {evtDate.getDate()}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>TBD</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold truncate" style={{ color: 'var(--ept-text)' }}>{title}</h3>
                      {statusLabel && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 15%, transparent)` }}
                        >
                          {statusLabel}
                        </span>
                      )}
                    </div>
                    {description && title !== description && (
                      <p className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>{description}</p>
                    )}
                    {form && (
                      <p className="text-xs mt-1" style={{ color: 'var(--ept-text-muted)', ...mono }}>Form: {form}</p>
                    )}
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--ept-text-muted)' }} className="flex-shrink-0 mt-1" />
                </div>
              );
            })}
          </div>
        ) : data && typeof data === 'object' && !Array.isArray(data) ? (
          <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--ept-text-muted)' }}>Calendar data:</p>
            <pre className="text-xs overflow-auto p-3 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-muted)', ...mono }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="text-center py-12" style={{ color: 'var(--ept-text-muted)' }}>No calendar data available.</div>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
          Key IRS tax deadlines for the 2025 tax year. Dates may shift when they fall on weekends or federal holidays.
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Page Header */}
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
          TAX REFERENCE DATA
        </span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">Federal Tax</span> Reference Guide
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Brackets, deductions, contribution limits, mileage rates, and key deadlines &mdash; all in one place.
        </p>
      </div>

      {/* Section Nav */}
      <div className="flex flex-wrap gap-2 mb-8">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeSection === s.id ? 'var(--ept-accent)' : 'var(--ept-surface)',
              color: activeSection === s.id ? '#000' : 'var(--ept-text-secondary)',
              boxShadow: activeSection === s.id ? '0 0 20px var(--ept-accent-glow)' : 'none',
            }}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="rounded-2xl border p-6 lg:p-8" style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}>
        {/* Section Heading */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--ept-surface)' }}>
            {SECTIONS.find(s => s.id === activeSection)?.icon}
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--ept-text)' }}>
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </h2>
          </div>
        </div>

        {activeSection === 'brackets' && renderBrackets()}
        {activeSection === 'deductions' && renderDeductions()}
        {activeSection === 'limits' && renderLimits()}
        {activeSection === 'mileage' && renderMileage()}
        {activeSection === 'calendar' && renderCalendar()}
      </div>
    </div>
  );
}
