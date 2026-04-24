'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Send,
  FileCode2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  FileText,
  ShieldCheck,
  Upload,
  ChevronRight,
  AlertTriangle,
  Calendar,
  ArrowRight,
} from 'lucide-react';

type EfileStage = 'draft' | 'generated' | 'validated' | 'submitted' | 'accepted' | 'rejected';

const STAGE_ORDER: EfileStage[] = ['draft', 'generated', 'validated', 'submitted', 'accepted'];

const stageConfig: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'var(--ept-text-muted)', bg: 'var(--ept-surface)', icon: FileText },
  generated: { label: 'XML Generated', color: 'var(--ept-info)', bg: 'var(--ept-info-bg)', icon: FileCode2 },
  validated: { label: 'Validated', color: 'var(--ept-warning)', bg: 'var(--ept-warning-bg)', icon: ShieldCheck },
  submitted: { label: 'Submitted', color: 'var(--ept-accent)', bg: 'var(--ept-accent-glow)', icon: Send },
  accepted: { label: 'Accepted', color: 'var(--ept-success)', bg: 'var(--ept-success-bg)', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'var(--ept-danger)', bg: 'var(--ept-danger-bg)', icon: XCircle },
  pending: { label: 'Pending', color: 'var(--ept-warning)', bg: 'var(--ept-warning-bg)', icon: Clock },
};

function StatusTimeline({ currentStage }: { currentStage: string }) {
  const isRejected = currentStage === 'rejected';
  const stages = isRejected ? [...STAGE_ORDER.slice(0, 3), 'rejected' as EfileStage] : STAGE_ORDER;
  const currentIdx = stages.indexOf(currentStage as EfileStage);

  return (
    <div className="flex items-center justify-between w-full">
      {stages.map((stage, idx) => {
        const config = stageConfig[stage];
        const IconComp = config.icon;
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isFuture = idx > currentIdx;

        return (
          <div key={stage} className="flex items-center flex-1 last:flex-initial">
            <div className="flex flex-col items-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all"
                style={{
                  backgroundColor: isCompleted || isCurrent ? config.bg : 'transparent',
                  borderColor: isCompleted || isCurrent ? config.color : 'var(--ept-border)',
                  color: isCompleted || isCurrent ? config.color : 'var(--ept-text-muted)',
                }}
              >
                {isCompleted ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <IconComp size={16} />
                )}
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider mt-2 text-center whitespace-nowrap"
                style={{ color: isCurrent ? config.color : isFuture ? 'var(--ept-text-muted)' : 'var(--ept-text-secondary)' }}
              >
                {config.label}
              </span>
            </div>
            {idx < stages.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-2 rounded-full mt-[-20px]"
                style={{
                  backgroundColor: idx < currentIdx ? stageConfig[stages[idx + 1]]?.color || 'var(--ept-accent)' : 'var(--ept-border)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EfilePage() {
  const [returns, setReturns] = useState<any>(null);
  const [selectedReturnId, setSelectedReturnId] = useState('');
  const [efileStatus, setEfileStatus] = useState<any>(null);
  const [xmlPreview, setXmlPreview] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExtension, setShowExtension] = useState(false);
  const [extensionForm, setExtensionForm] = useState({
    reason: '',
    estimated_tax_liability: '',
    payment_amount: '',
  });
  const [extensionResult, setExtensionResult] = useState<any>(null);
  const [filingExtension, setFilingExtension] = useState(false);
  const [xmlExpanded, setXmlExpanded] = useState(false);

  useEffect(() => {
    api.listReturns().then(setReturns).catch(() => {});
  }, []);

  const handleReturnSelect = async (id: string) => {
    setSelectedReturnId(id);
    setXmlPreview(null);
    setValidationResult(null);
    setSubmitResult(null);
    setError(null);
    setEfileStatus(null);
    setExtensionResult(null);
    setShowExtension(false);
    if (id) {
      await loadEfileStatus(id);
    }
  };

  const loadEfileStatus = async (id?: string) => {
    const returnId = id || selectedReturnId;
    if (!returnId) return;
    setLoadingStatus(true);
    try {
      const res = await api.efileStatus(returnId);
      setEfileStatus(res?.data || res);
    } catch {
      // No status yet
    }
    setLoadingStatus(false);
  };

  const handleGenerateXml = async () => {
    if (!selectedReturnId) return;
    setGenerating(true);
    setError(null);
    setXmlPreview(null);
    try {
      const res = await api.efileMeF(selectedReturnId);
      if (res?.data?.xml) {
        setXmlPreview(res.data.xml);
      } else if (res?.xml) {
        setXmlPreview(res.xml);
      } else if (typeof res?.data === 'string') {
        setXmlPreview(res.data);
      } else {
        setXmlPreview(JSON.stringify(res?.data || res, null, 2));
      }
      await loadEfileStatus();
    } catch (e: any) {
      setError(e.message || 'Failed to generate MeF XML');
    }
    setGenerating(false);
  };

  const handleValidate = async () => {
    if (!selectedReturnId) return;
    setValidating(true);
    setError(null);
    setValidationResult(null);
    try {
      const res = await api.efileValidate(selectedReturnId);
      setValidationResult(res?.data || res);
      await loadEfileStatus();
    } catch (e: any) {
      setError(e.message || 'Validation failed');
    }
    setValidating(false);
  };

  const handleSubmit = async () => {
    if (!selectedReturnId) return;
    setSubmitting(true);
    setError(null);
    setSubmitResult(null);
    try {
      const res = await api.submitEfile(selectedReturnId);
      setSubmitResult(res?.data || res);
      await loadEfileStatus();
    } catch (e: any) {
      setError(e.message || 'E-file submission failed');
    }
    setSubmitting(false);
  };

  const handleFileExtension = async () => {
    if (!selectedReturnId) return;
    setFilingExtension(true);
    setError(null);
    setExtensionResult(null);
    try {
      const payload = {
        reason: extensionForm.reason,
        estimated_tax_liability: extensionForm.estimated_tax_liability
          ? parseFloat(extensionForm.estimated_tax_liability)
          : undefined,
        payment_amount: extensionForm.payment_amount
          ? parseFloat(extensionForm.payment_amount)
          : undefined,
      };
      const res = await api.fileExtension(selectedReturnId, payload);
      setExtensionResult(res?.data || res);
    } catch (e: any) {
      setError(e.message || 'Extension filing failed');
    }
    setFilingExtension(false);
  };

  const currentStage: string =
    efileStatus?.stage || efileStatus?.status || efileStatus?.efile_status || 'draft';

  const selectedReturn = returns?.data?.find((r: any) => r.id === selectedReturnId);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
          ELECTRONIC FILING
        </span>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ept-text)' }}>
          <span className="gradient-text">E-File</span> Management
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ept-text-secondary)' }}>
          Generate MeF XML, validate against IRS schemas, and submit electronically.
        </p>
      </div>

      {/* Return Selector */}
      <div
        className="rounded-2xl border p-6 mb-8"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        <div className="flex items-center gap-3 mb-4">
          <Send size={20} style={{ color: 'var(--ept-accent)' }} />
          <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
            Select Return to E-File
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
          <div className="flex items-end">
            <button
              onClick={() => loadEfileStatus()}
              disabled={!selectedReturnId || loadingStatus}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
            >
              <RefreshCw size={14} className={loadingStatus ? 'animate-spin' : ''} />
              Refresh Status
            </button>
          </div>
        </div>

        {/* Selected return details */}
        {selectedReturn && (
          <div
            className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-5 gap-4"
            style={{ borderColor: 'var(--ept-border)' }}
          >
            {[
              { label: 'Form', value: selectedReturn.return_type },
              { label: 'Tax Year', value: selectedReturn.tax_year },
              { label: 'Status', value: selectedReturn.status?.toUpperCase() },
              {
                label: 'Total Tax',
                value: selectedReturn.total_tax != null
                  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(selectedReturn.total_tax)
                  : 'N/A',
              },
              {
                label: 'Refund/Owed',
                value: selectedReturn.refund_or_owed != null
                  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(selectedReturn.refund_or_owed)
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

      {selectedReturnId && (
        <div className="space-y-6">
          {/* Status Timeline */}
          <div
            className="rounded-2xl border p-6"
            style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
          >
            <div className="flex items-center gap-2 mb-6">
              <Clock size={16} style={{ color: 'var(--ept-accent)' }} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                Filing Progress
              </h3>
              {efileStatus?.submission_id && (
                <span
                  className="ml-auto text-xs px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: 'var(--ept-surface)',
                    color: 'var(--ept-text-muted)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  ID: {efileStatus.submission_id}
                </span>
              )}
            </div>
            <StatusTimeline currentStage={currentStage} />
            {efileStatus?.submitted_at && (
              <div className="flex items-center justify-center gap-1 mt-4">
                <Calendar size={12} style={{ color: 'var(--ept-text-muted)' }} />
                <span className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                  Submitted: {new Date(efileStatus.submitted_at).toLocaleString()}
                </span>
              </div>
            )}
            {efileStatus?.accepted_at && (
              <div className="flex items-center justify-center gap-1 mt-1">
                <CheckCircle2 size={12} style={{ color: 'var(--ept-success)' }} />
                <span className="text-[10px]" style={{ color: 'var(--ept-success)' }}>
                  Accepted: {new Date(efileStatus.accepted_at).toLocaleString()}
                </span>
              </div>
            )}
            {efileStatus?.rejection_reason && (
              <div
                className="mt-4 p-3 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--ept-danger-bg)', color: 'var(--ept-danger)' }}
              >
                <span className="font-bold">Rejection Reason: </span>
                {efileStatus.rejection_reason}
              </div>
            )}
          </div>

          {/* Action Cards */}
          <div className="grid md:grid-cols-3 gap-4">
            {/* Generate MeF XML */}
            <div
              className="rounded-2xl border p-6 card-hover"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--ept-info-bg)', color: 'var(--ept-info)' }}
                >
                  <FileCode2 size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    Generate MeF XML
                  </h3>
                  <p className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                    IRS Modernized e-File format
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--ept-text-secondary)' }}>
                Generate the complete MeF XML document from return data for electronic submission to the IRS.
              </p>
              <button
                onClick={handleGenerateXml}
                disabled={generating}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--ept-info)' }}
              >
                {generating ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <FileCode2 size={14} />
                )}
                {generating ? 'Generating...' : 'Generate XML'}
              </button>
            </div>

            {/* Validate XML */}
            <div
              className="rounded-2xl border p-6 card-hover"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--ept-warning-bg)', color: 'var(--ept-warning)' }}
                >
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    Validate XML
                  </h3>
                  <p className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                    Schema & business rules
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--ept-text-secondary)' }}>
                Validate the generated XML against IRS MeF schemas and business rule checks before submission.
              </p>
              <button
                onClick={handleValidate}
                disabled={validating}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--ept-warning)' }}
              >
                {validating ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                {validating ? 'Validating...' : 'Validate XML'}
              </button>
            </div>

            {/* Submit E-File */}
            <div
              className="rounded-2xl border p-6 card-hover"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}
                >
                  <Send size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    Submit E-File
                  </h3>
                  <p className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                    Transmit to IRS
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--ept-text-secondary)' }}>
                Electronically submit the validated return to the IRS via the MeF transmission system.
              </p>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--ept-success)' }}
              >
                {submitting ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                {submitting ? 'Submitting...' : 'Submit E-File'}
              </button>
            </div>
          </div>

          {/* XML Preview */}
          {xmlPreview && (
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="flex items-center gap-2">
                  <FileCode2 size={16} style={{ color: 'var(--ept-accent)' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    MeF XML Preview
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(xmlPreview);
                    }}
                    className="px-3 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider border"
                    style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setXmlExpanded(!xmlExpanded)}
                    className="px-3 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider border"
                    style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
                  >
                    {xmlExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
              <div
                className="overflow-auto"
                style={{ maxHeight: xmlExpanded ? 'none' : '400px' }}
              >
                <pre
                  className="p-6 text-xs leading-relaxed overflow-x-auto"
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    color: 'var(--ept-text-secondary)',
                    backgroundColor: 'var(--ept-surface)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {xmlPreview}
                </pre>
              </div>
            </div>
          )}

          {/* Validation Results */}
          {validationResult && (
            <div
              className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} style={{ color: 'var(--ept-accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                  Validation Results
                </h3>
                {(validationResult.valid || validationResult.is_valid) && (
                  <span
                    className="ml-auto inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}
                  >
                    VALID
                  </span>
                )}
                {validationResult.valid === false && (
                  <span
                    className="ml-auto inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: 'var(--ept-danger-bg)', color: 'var(--ept-danger)' }}
                  >
                    INVALID
                  </span>
                )}
              </div>

              {/* Errors */}
              {validationResult.errors?.length > 0 && (
                <div className="space-y-2 mb-4">
                  <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--ept-danger)' }}>
                    Errors ({validationResult.errors.length})
                  </div>
                  {validationResult.errors.map((err: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-3 rounded-lg text-xs"
                      style={{ backgroundColor: 'var(--ept-danger-bg)' }}
                    >
                      <XCircle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--ept-danger)' }} />
                      <div>
                        <span className="font-bold" style={{ color: 'var(--ept-danger)' }}>
                          {typeof err === 'string' ? err : err.rule || err.code || `Error ${i + 1}`}
                        </span>
                        {typeof err !== 'string' && err.message && (
                          <div style={{ color: 'var(--ept-text-secondary)' }}>{err.message}</div>
                        )}
                        {typeof err !== 'string' && err.path && (
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-text-muted)' }}>
                            {err.path}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {validationResult.warnings?.length > 0 && (
                <div className="space-y-2 mb-4">
                  <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--ept-warning)' }}>
                    Warnings ({validationResult.warnings.length})
                  </div>
                  {validationResult.warnings.map((warn: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-3 rounded-lg text-xs"
                      style={{ backgroundColor: 'var(--ept-warning-bg)' }}
                    >
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--ept-warning)' }} />
                      <span style={{ color: 'var(--ept-text)' }}>
                        {typeof warn === 'string' ? warn : warn.message || warn.rule || JSON.stringify(warn)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Schema check details */}
              {validationResult.schema_checks && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--ept-text-muted)' }}>
                    Schema Checks
                  </div>
                  {(Array.isArray(validationResult.schema_checks)
                    ? validationResult.schema_checks
                    : Object.entries(validationResult.schema_checks).map(([k, v]) => ({ name: k, passed: v }))
                  ).map((check: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1">
                      {check.passed ? (
                        <CheckCircle2 size={14} style={{ color: 'var(--ept-success)' }} />
                      ) : (
                        <XCircle size={14} style={{ color: 'var(--ept-danger)' }} />
                      )}
                      <span style={{ color: 'var(--ept-text-secondary)' }}>
                        {check.name || check.check || check.rule}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* No errors/warnings — all clear */}
              {(!validationResult.errors || validationResult.errors.length === 0) &&
                (!validationResult.warnings || validationResult.warnings.length === 0) &&
                !validationResult.schema_checks && (
                  <div className="text-center py-4">
                    <CheckCircle2 size={32} className="mx-auto mb-2" style={{ color: 'var(--ept-success)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--ept-success)' }}>
                      All validation checks passed
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--ept-text-muted)' }}>
                      This return is ready for electronic filing.
                    </p>
                  </div>
                )}
            </div>
          )}

          {/* Submit Result */}
          {submitResult && (
            <div
              className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Send size={16} style={{ color: 'var(--ept-accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                  Submission Result
                </h3>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { label: 'Submission ID', value: submitResult.submission_id || submitResult.id || 'N/A' },
                  { label: 'Status', value: submitResult.status || submitResult.efile_status || 'submitted' },
                  { label: 'Timestamp', value: submitResult.submitted_at ? new Date(submitResult.submitted_at).toLocaleString() : new Date().toLocaleString() },
                  { label: 'Confirmation', value: submitResult.confirmation_number || submitResult.tracking_number || 'Pending' },
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
              {submitResult.message && (
                <div
                  className="mt-4 p-3 rounded-lg text-xs"
                  style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}
                >
                  {submitResult.message}
                </div>
              )}
            </div>
          )}

          {/* Extension Filing */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
          >
            <button
              onClick={() => setShowExtension(!showExtension)}
              className="w-full flex items-center justify-between px-6 py-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}
                >
                  <Calendar size={20} />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-bold" style={{ color: 'var(--ept-text)' }}>
                    File Extension (Form 4868)
                  </h3>
                  <p className="text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                    Request automatic 6-month extension
                  </p>
                </div>
              </div>
              <ChevronRight
                size={18}
                className="transition-transform"
                style={{
                  color: 'var(--ept-text-muted)',
                  transform: showExtension ? 'rotate(90deg)' : 'rotate(0deg)',
                }}
              />
            </button>

            {showExtension && (
              <div className="px-6 pb-6 pt-0 space-y-4 border-t" style={{ borderColor: 'var(--ept-border)' }}>
                <div className="pt-4 grid md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>
                      Reason for Extension
                    </label>
                    <textarea
                      value={extensionForm.reason}
                      onChange={(e) => setExtensionForm({ ...extensionForm, reason: e.target.value })}
                      placeholder="Reason for filing extension..."
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                      style={{
                        backgroundColor: 'var(--ept-surface)',
                        borderColor: 'var(--ept-border)',
                        color: 'var(--ept-text)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>
                      Estimated Tax Liability ($)
                    </label>
                    <input
                      type="number"
                      value={extensionForm.estimated_tax_liability}
                      onChange={(e) => setExtensionForm({ ...extensionForm, estimated_tax_liability: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--ept-surface)',
                        borderColor: 'var(--ept-border)',
                        color: 'var(--ept-text)',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ept-text-muted)' }}>
                      Payment Amount ($)
                    </label>
                    <input
                      type="number"
                      value={extensionForm.payment_amount}
                      onChange={(e) => setExtensionForm({ ...extensionForm, payment_amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--ept-surface)',
                        borderColor: 'var(--ept-border)',
                        color: 'var(--ept-text)',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ backgroundColor: 'var(--ept-warning-bg)' }}>
                  <AlertTriangle size={14} className="shrink-0" style={{ color: 'var(--ept-warning)' }} />
                  <span style={{ color: 'var(--ept-text)' }}>
                    An extension to file is not an extension to pay. Estimated taxes are still due by the original deadline.
                  </span>
                </div>

                <button
                  onClick={handleFileExtension}
                  disabled={filingExtension}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: 'var(--ept-accent)' }}
                >
                  {filingExtension ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {filingExtension ? 'Filing Extension...' : 'File Extension'}
                </button>

                {extensionResult && (
                  <div
                    className="p-4 rounded-lg border"
                    style={{
                      backgroundColor: extensionResult.success !== false ? 'var(--ept-success-bg)' : 'var(--ept-danger-bg)',
                      borderColor: extensionResult.success !== false ? 'var(--ept-success)' : 'var(--ept-danger)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {extensionResult.success !== false ? (
                        <CheckCircle2 size={16} style={{ color: 'var(--ept-success)' }} />
                      ) : (
                        <XCircle size={16} style={{ color: 'var(--ept-danger)' }} />
                      )}
                      <span
                        className="text-sm font-bold"
                        style={{
                          color: extensionResult.success !== false ? 'var(--ept-success)' : 'var(--ept-danger)',
                        }}
                      >
                        {extensionResult.success !== false ? 'Extension Filed' : 'Extension Failed'}
                      </span>
                    </div>
                    {extensionResult.confirmation_number && (
                      <div className="text-xs" style={{ color: 'var(--ept-text-secondary)' }}>
                        Confirmation:{' '}
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                          {extensionResult.confirmation_number}
                        </span>
                      </div>
                    )}
                    {extensionResult.new_deadline && (
                      <div className="text-xs mt-1" style={{ color: 'var(--ept-text-secondary)' }}>
                        New deadline:{' '}
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                          {new Date(extensionResult.new_deadline).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    {extensionResult.message && (
                      <div className="text-xs mt-1" style={{ color: 'var(--ept-text-secondary)' }}>
                        {extensionResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedReturnId && (
        <div
          className="rounded-2xl border p-16 text-center"
          style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
        >
          <Send size={56} className="mx-auto mb-4" style={{ color: 'var(--ept-text-muted)' }} />
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--ept-text)' }}>
            E-File a Tax Return
          </h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--ept-text-muted)' }}>
            Select a tax return above to generate MeF XML, validate against IRS schemas,
            and submit electronically.
          </p>
          <div className="flex items-center justify-center gap-2 mt-6 text-xs" style={{ color: 'var(--ept-text-muted)' }}>
            <span
              className="px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--ept-surface)' }}
            >
              Generate
            </span>
            <ArrowRight size={12} />
            <span
              className="px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--ept-surface)' }}
            >
              Validate
            </span>
            <ArrowRight size={12} />
            <span
              className="px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--ept-surface)' }}
            >
              Submit
            </span>
            <ArrowRight size={12} />
            <span
              className="px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--ept-success-bg)', color: 'var(--ept-success)' }}
            >
              Accepted
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
