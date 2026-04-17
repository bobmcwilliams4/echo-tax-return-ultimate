'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface TaxReturn {
  id: string;
  client_id: string;
  tax_year: number;
  status: string;
  return_type: string;
  is_clone: number;
  cloned_from: string | null;
  total_income: number;
  adjusted_gross_income: number;
  total_adjustments: number;
  taxable_income: number;
  total_tax: number;
  total_credits: number;
  total_payments: number;
  total_withholding: number;
  estimated_payments: number;
  refund_or_owed: number;
  effective_rate: number;
  marginal_rate: number;
  deduction_method: string | null;
  standard_deduction_amount: number;
  itemized_deduction_amount: number;
  self_employment_tax: number;
  amt_amount: number;
  niit_amount: number;
  qbi_deduction: number;
  locked_at: string | null;
  filed_at: string | null;
  created_at: string;
}

interface IncomeItem {
  id: string;
  category: string;
  description: string | null;
  payer_name: string | null;
  amount: number;
  tax_withheld: number;
  form_type: string | null;
}

interface DeductionItem {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  schedule: string | null;
}

interface Dependent {
  id: string;
  first_name: string;
  last_name: string;
  relationship: string;
  dob: string;
  qualifies_ctc: boolean;
  qualifies_eic: boolean;
}

const fmt = (n: number) => n?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) ?? '$0.00';
const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  calculated: 'bg-ept-info/20 text-ept-info',
  locked: 'bg-ept-warning/20 text-ept-warning',
  filed: 'bg-ept-success/20 text-ept-success',
  accepted: 'bg-green-500/20 text-green-400',
  rejected: 'bg-ept-danger/20 text-ept-danger',
};

export default function ReturnDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [taxReturn, setTaxReturn] = useState<TaxReturn | null>(null);
  const [income, setIncome] = useState<IncomeItem[]>([]);
  const [deductions, setDeductions] = useState<DeductionItem[]>([]);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'income' | 'deductions' | 'dependents' | 'forms'>('summary');

  // Income form
  const [incomeForm, setIncomeForm] = useState({ category: 'wages', description: '', payer_name: '', amount: '', tax_withheld: '0', form_type: 'W-2' });
  // Deduction form
  const [dedForm, setDedForm] = useState({ category: 'mortgage_interest', description: '', amount: '' });
  // Dependent form
  const [depForm, setDepForm] = useState({ first_name: '', last_name: '', relationship: 'child', dob: '' });

  const loadData = useCallback(async () => {
    try {
      const [retRes, incRes, dedRes] = await Promise.all([
        api.getReturn(id),
        api.getIncome(id),
        api.getDeductions(id),
      ]);
      if (retRes.data) setTaxReturn(retRes.data as TaxReturn);
      if (incRes.data) setIncome((Array.isArray(incRes.data) ? incRes.data : []) as IncomeItem[]);
      if (dedRes.data) setDeductions((Array.isArray(dedRes.data) ? dedRes.data : []) as DeductionItem[]);
    } catch (e) {
      setError('Failed to load return data');
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await api.calculateReturn(id);
      if (res.data) {
        setCalcResult(res.data as Record<string, unknown>);
        await loadData();
      }
    } catch { setError('Calculation failed'); }
    setCalculating(false);
  };

  const handleLock = async () => {
    await api.lockReturn(id);
    await loadData();
  };

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.addIncome({
      return_id: id,
      category: incomeForm.category,
      description: incomeForm.description || undefined,
      payer_name: incomeForm.payer_name || undefined,
      amount: parseFloat(incomeForm.amount),
      tax_withheld: parseFloat(incomeForm.tax_withheld || '0'),
      form_type: incomeForm.form_type || undefined,
    });
    setIncomeForm({ category: 'wages', description: '', payer_name: '', amount: '', tax_withheld: '0', form_type: 'W-2' });
    await loadData();
  };

  const handleAddDeduction = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.addDeduction({
      return_id: id,
      category: dedForm.category,
      description: dedForm.description || undefined,
      amount: parseFloat(dedForm.amount),
    });
    setDedForm({ category: 'mortgage_interest', description: '', amount: '' });
    await loadData();
  };

  const handleDeleteIncome = async (incomeId: string) => {
    await api.deleteIncome(incomeId);
    await loadData();
  };

  const handleDeleteDeduction = async (dedId: string) => {
    await api.deleteDeduction(dedId);
    await loadData();
  };

  if (!taxReturn) return (
    <div className="min-h-screen bg-ept-bg flex items-center justify-center">
      <div className="text-ept-text-muted">Loading return...</div>
    </div>
  );

  const isRefund = (taxReturn.refund_or_owed || 0) >= 0;
  const tabs = ['summary', 'income', 'deductions', 'dependents', 'forms'] as const;

  return (
    <div className="min-h-screen bg-ept-bg">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-ept-text">
                {taxReturn.tax_year} Tax Return
              </h1>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${statusColors[taxReturn.status] || statusColors.draft}`}>
                {taxReturn.status}
              </span>
              <span className="text-ept-text-muted text-sm font-mono">
                Form {taxReturn.return_type}
              </span>
            </div>
            <p className="text-ept-text-muted text-sm font-mono">ID: {taxReturn.id}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCalculate}
              disabled={calculating || taxReturn.status === 'locked' || taxReturn.status === 'filed'}
              className="px-5 py-2.5 bg-ept-accent text-white rounded-lg font-semibold text-sm hover:bg-ept-accent-light transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {calculating ? 'Calculating...' : 'Calculate Tax'}
            </button>
            {taxReturn.status === 'calculated' && (
              <button onClick={handleLock} className="px-5 py-2.5 border border-ept-warning text-ept-warning rounded-lg font-semibold text-sm hover:bg-ept-warning/10 transition">
                Lock for E-File
              </button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-ept-danger/10 border border-ept-danger/30 rounded-lg text-ept-danger text-sm">{error}</div>}

        {/* Refund/Owed Banner */}
        {taxReturn.status !== 'draft' && taxReturn.total_tax > 0 && (
          <div className={`glass-card p-6 mb-8 border-l-4 ${isRefund ? 'border-l-ept-success' : 'border-l-ept-danger'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-ept-text-muted text-sm">{isRefund ? 'ESTIMATED REFUND' : 'ESTIMATED TAX OWED'}</p>
                <p className={`text-4xl font-bold ${isRefund ? 'text-ept-success' : 'text-ept-danger'}`}>
                  {fmt(Math.abs(taxReturn.refund_or_owed))}
                </p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-ept-text-muted text-xs">Effective Rate: <span className="text-ept-text font-semibold">{taxReturn.effective_rate}%</span></p>
                <p className="text-ept-text-muted text-xs">Marginal Rate: <span className="text-ept-text font-semibold">{taxReturn.marginal_rate}%</span></p>
                <p className="text-ept-text-muted text-xs">Method: <span className="text-ept-text font-semibold capitalize">{taxReturn.deduction_method || 'N/A'}</span></p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-ept-border">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-ept-accent text-ept-accent'
                  : 'border-transparent text-ept-text-muted hover:text-ept-text'
              }`}
            >
              {tab}
              {tab === 'income' && income.length > 0 && <span className="ml-1.5 text-xs opacity-60">({income.length})</span>}
              {tab === 'deductions' && deductions.length > 0 && <span className="ml-1.5 text-xs opacity-60">({deductions.length})</span>}
            </button>
          ))}
        </div>

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income Breakdown */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Income & AGI</h3>
              <div className="space-y-3">
                <Row label="Total Income" value={taxReturn.total_income} />
                <Row label="Adjustments" value={-(taxReturn.total_adjustments || 0)} muted />
                <Divider />
                <Row label="Adjusted Gross Income" value={taxReturn.adjusted_gross_income} bold />
                <Row label={`${taxReturn.deduction_method === 'itemized' ? 'Itemized' : 'Standard'} Deduction`}
                     value={-(taxReturn.deduction_method === 'itemized' ? taxReturn.itemized_deduction_amount : taxReturn.standard_deduction_amount)} muted />
                {taxReturn.qbi_deduction > 0 && <Row label="QBI Deduction (§199A)" value={-taxReturn.qbi_deduction} muted />}
                <Divider />
                <Row label="Taxable Income" value={taxReturn.taxable_income} bold accent />
              </div>
            </div>

            {/* Tax Breakdown */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Tax Computation</h3>
              <div className="space-y-3">
                <Row label="Income Tax" value={taxReturn.total_tax - taxReturn.self_employment_tax - taxReturn.amt_amount - taxReturn.niit_amount} />
                {taxReturn.self_employment_tax > 0 && <Row label="Self-Employment Tax" value={taxReturn.self_employment_tax} />}
                {taxReturn.amt_amount > 0 && <Row label="AMT (Form 6251)" value={taxReturn.amt_amount} warn />}
                {taxReturn.niit_amount > 0 && <Row label="NIIT (Form 8960)" value={taxReturn.niit_amount} />}
                <Divider />
                <Row label="Total Tax" value={taxReturn.total_tax} bold />
                {taxReturn.total_credits > 0 && <Row label="Total Credits" value={-taxReturn.total_credits} success />}
                <Row label="Total Payments & Withholding" value={-taxReturn.total_payments} success />
                <Divider />
                <Row label={isRefund ? 'Refund' : 'Amount Owed'}
                     value={Math.abs(taxReturn.refund_or_owed)}
                     bold accent={isRefund} warn={!isRefund} />
              </div>
            </div>

            {/* Calculation Result Details */}
            {calcResult && (
              <div className="glass-card p-6 lg:col-span-2">
                <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Calculation Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Credits */}
                  {(calcResult.credits as Record<string, number>) && (
                    <div>
                      <h4 className="text-xs font-semibold text-ept-accent mb-2">Credits Applied</h4>
                      <div className="space-y-1 text-sm">
                        {Object.entries(calcResult.credits as Record<string, number>)
                          .filter(([k, v]) => k !== 'total' && v > 0)
                          .map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-ept-text-secondary capitalize">{k.replace(/_/g, ' ')}</span>
                              <span className="text-ept-success font-mono">{fmt(v)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {/* Forms */}
                  {(calcResult.forms_generated as string[])?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-ept-accent mb-2">Forms Generated</h4>
                      <div className="flex flex-wrap gap-2">
                        {(calcResult.forms_generated as string[]).map(f => (
                          <span key={f} className="px-2 py-1 bg-ept-surface rounded text-xs font-mono text-ept-text-secondary">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Warnings */}
                  {(calcResult.warnings as string[])?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-ept-warning mb-2">Warnings</h4>
                      <ul className="space-y-1 text-sm text-ept-warning">
                        {(calcResult.warnings as string[]).map((w, i) => <li key={i}>⚠ {w}</li>)}
                      </ul>
                    </div>
                  )}
                  {/* Suggestions */}
                  {(calcResult.optimization_suggestions as string[])?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-ept-info mb-2">Optimization Suggestions</h4>
                      <ul className="space-y-1 text-sm text-ept-info">
                        {(calcResult.optimization_suggestions as string[]).map((s, i) => <li key={i}>→ {s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Income Tab */}
        {activeTab === 'income' && (
          <div className="space-y-6">
            <form onSubmit={handleAddIncome} className="glass-card p-6">
              <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Add Income</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <select value={incomeForm.category} onChange={e => setIncomeForm({ ...incomeForm, category: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text">
                  <option value="wages">Wages (W-2)</option>
                  <option value="business">Business (1099-NEC)</option>
                  <option value="interest">Interest (1099-INT)</option>
                  <option value="dividends">Dividends (1099-DIV)</option>
                  <option value="qualified_dividends">Qualified Dividends</option>
                  <option value="capital_gains_short">Short-Term Cap Gains</option>
                  <option value="capital_gains_long">Long-Term Cap Gains</option>
                  <option value="rental">Rental Income</option>
                  <option value="social_security">Social Security</option>
                  <option value="pension">Pension/Annuity</option>
                  <option value="unemployment">Unemployment</option>
                  <option value="crypto">Crypto</option>
                  <option value="other">Other</option>
                </select>
                <input placeholder="Payer name" value={incomeForm.payer_name} onChange={e => setIncomeForm({ ...incomeForm, payer_name: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text" />
                <input type="number" step="0.01" placeholder="Amount" required value={incomeForm.amount}
                  onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text" />
                <input type="number" step="0.01" placeholder="Tax withheld" value={incomeForm.tax_withheld}
                  onChange={e => setIncomeForm({ ...incomeForm, tax_withheld: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text" />
              </div>
              <button type="submit" className="px-4 py-2 bg-ept-accent text-white rounded-lg text-sm font-semibold hover:bg-ept-accent-light transition">
                Add Income Item
              </button>
            </form>

            {income.length === 0 ? (
              <div className="glass-card p-8 text-center text-ept-text-muted">No income items yet</div>
            ) : (
              <div className="glass-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-ept-surface">
                    <tr>
                      <th className="text-left px-4 py-3 text-ept-text-muted font-medium">Category</th>
                      <th className="text-left px-4 py-3 text-ept-text-muted font-medium">Payer</th>
                      <th className="text-right px-4 py-3 text-ept-text-muted font-medium">Amount</th>
                      <th className="text-right px-4 py-3 text-ept-text-muted font-medium">Withheld</th>
                      <th className="text-right px-4 py-3 text-ept-text-muted font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {income.map(item => (
                      <tr key={item.id} className="border-t border-ept-border hover:bg-ept-surface/50">
                        <td className="px-4 py-3 text-ept-text capitalize">{item.category.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-ept-text-secondary">{item.payer_name || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-ept-text">{fmt(item.amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-ept-text-muted">{fmt(item.tax_withheld)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDeleteIncome(item.id)} className="text-ept-danger text-xs hover:underline">Delete</button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ept-accent/30 bg-ept-surface/30">
                      <td colSpan={2} className="px-4 py-3 font-semibold text-ept-text">Total</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-ept-accent">{fmt(income.reduce((s, i) => s + i.amount, 0))}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-ept-text-secondary">{fmt(income.reduce((s, i) => s + i.tax_withheld, 0))}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Deductions Tab */}
        {activeTab === 'deductions' && (
          <div className="space-y-6">
            <form onSubmit={handleAddDeduction} className="glass-card p-6">
              <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Add Deduction</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <select value={dedForm.category} onChange={e => setDedForm({ ...dedForm, category: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text">
                  <optgroup label="Itemized (Schedule A)">
                    <option value="mortgage_interest">Mortgage Interest</option>
                    <option value="state_local_taxes">State/Local Income Tax</option>
                    <option value="property_taxes">Property Taxes</option>
                    <option value="charitable_cash">Charitable (Cash)</option>
                    <option value="charitable_noncash">Charitable (Non-Cash)</option>
                    <option value="medical">Medical Expenses</option>
                    <option value="casualty_loss">Casualty Loss</option>
                    <option value="gambling_loss">Gambling Loss</option>
                  </optgroup>
                  <optgroup label="Above-the-Line">
                    <option value="student_loan_interest">Student Loan Interest</option>
                    <option value="educator_expense">Educator Expense</option>
                    <option value="hsa_contribution">HSA Contribution</option>
                    <option value="ira_contribution">IRA Contribution</option>
                    <option value="self_employment_health">SE Health Insurance</option>
                    <option value="alimony_paid">Alimony Paid</option>
                  </optgroup>
                  <optgroup label="Business">
                    <option value="home_office">Home Office</option>
                    <option value="vehicle">Vehicle/Mileage</option>
                    <option value="depreciation">Depreciation</option>
                    <option value="business_expense">Business Expense</option>
                  </optgroup>
                </select>
                <input placeholder="Description" value={dedForm.description} onChange={e => setDedForm({ ...dedForm, description: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text" />
                <input type="number" step="0.01" placeholder="Amount" required value={dedForm.amount}
                  onChange={e => setDedForm({ ...dedForm, amount: e.target.value })}
                  className="bg-ept-surface border border-ept-border rounded-lg px-3 py-2 text-sm text-ept-text" />
              </div>
              <button type="submit" className="px-4 py-2 bg-ept-accent text-white rounded-lg text-sm font-semibold hover:bg-ept-accent-light transition">
                Add Deduction
              </button>
            </form>

            {deductions.length === 0 ? (
              <div className="glass-card p-8 text-center text-ept-text-muted">No deductions yet</div>
            ) : (
              <div className="glass-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-ept-surface">
                    <tr>
                      <th className="text-left px-4 py-3 text-ept-text-muted font-medium">Category</th>
                      <th className="text-left px-4 py-3 text-ept-text-muted font-medium">Description</th>
                      <th className="text-right px-4 py-3 text-ept-text-muted font-medium">Amount</th>
                      <th className="text-right px-4 py-3 text-ept-text-muted font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deductions.map(item => (
                      <tr key={item.id} className="border-t border-ept-border hover:bg-ept-surface/50">
                        <td className="px-4 py-3 text-ept-text capitalize">{item.category.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-ept-text-secondary">{item.description || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-ept-text">{fmt(item.amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDeleteDeduction(item.id)} className="text-ept-danger text-xs hover:underline">Delete</button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ept-accent/30 bg-ept-surface/30">
                      <td colSpan={2} className="px-4 py-3 font-semibold text-ept-text">Total</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-ept-accent">{fmt(deductions.reduce((s, d) => s + d.amount, 0))}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Dependents Tab */}
        {activeTab === 'dependents' && (
          <div className="space-y-6">
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Dependents</h3>
              {dependents.length === 0 ? (
                <p className="text-ept-text-muted text-center py-4">No dependents added</p>
              ) : (
                <div className="space-y-3">
                  {dependents.map(dep => (
                    <div key={dep.id} className="flex items-center justify-between p-3 bg-ept-surface rounded-lg">
                      <div>
                        <p className="font-medium text-ept-text">{dep.first_name} {dep.last_name}</p>
                        <p className="text-xs text-ept-text-muted">{dep.relationship} • DOB: {dep.dob}</p>
                      </div>
                      <div className="flex gap-2">
                        {dep.qualifies_ctc && <span className="px-2 py-0.5 bg-ept-success/20 text-ept-success text-xs rounded">CTC</span>}
                        {dep.qualifies_eic && <span className="px-2 py-0.5 bg-ept-info/20 text-ept-info text-xs rounded">EIC</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Forms Tab */}
        {activeTab === 'forms' && (
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-ept-text-muted uppercase tracking-wider mb-4">Generated Forms & Schedules</h3>
            {calcResult?.forms_generated ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(calcResult.forms_generated as string[]).map(form => (
                  <div key={form} className="p-4 bg-ept-surface rounded-lg border border-ept-border text-center">
                    <p className="font-mono font-semibold text-ept-accent">{form}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ept-text-muted text-center py-8">Run calculation to generate forms</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper components
function Row({ label, value, bold, muted, accent, success, warn }: {
  label: string; value: number; bold?: boolean; muted?: boolean; accent?: boolean; success?: boolean; warn?: boolean;
}) {
  const fmt = (n: number) => n?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) ?? '$0.00';
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'font-semibold text-ept-text' : muted ? 'text-ept-text-muted' : 'text-ept-text-secondary'}`}>{label}</span>
      <span className={`font-mono text-sm ${
        bold ? 'font-bold text-ept-text' :
        accent ? 'font-bold text-ept-accent' :
        success ? 'text-ept-success' :
        warn ? 'text-ept-danger font-bold' :
        muted ? 'text-ept-text-muted' : 'text-ept-text'
      }`}>{fmt(value)}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-ept-border/50 my-1" />;
}
