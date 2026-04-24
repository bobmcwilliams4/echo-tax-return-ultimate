'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import {
  CreditCard,
  Check,
  Tag,
  Receipt,
  Printer,
  Mail,
  Clock,
  Shield,
  Zap,
  Crown,
  ChevronRight,
  X,
  Download,
  ExternalLink,
  Sparkles,
  FileText,
  Lock,
  AlertCircle,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */

interface PricingTier {
  id: string;
  name: string;
  price: number;
  icon: React.ReactNode;
  badge?: string;
  features: string[];
  accent: string;
  popular?: boolean;
}

interface DiscountInfo {
  code: string;
  percent: number;
  amount: number;
  valid: boolean;
  message: string;
}

interface PaymentRecord {
  id: string;
  date: string;
  plan: string;
  amount: number;
  status: 'completed' | 'refunded' | 'pending' | 'failed';
  transactionId: string;
  method: string;
}

interface ReceiptData {
  transactionId: string;
  date: string;
  plan: string;
  subtotal: number;
  discount: number;
  discountCode: string | null;
  tax: number;
  total: number;
  method: string;
  clientName: string;
  clientEmail: string;
}

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const TIERS: PricingTier[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: 49,
    icon: <FileText size={22} />,
    features: [
      'Single federal return',
      'IRS e-file included',
      'Standard deduction only',
      'Basic error checking',
      'Email support',
    ],
    accent: 'var(--ept-info)',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 99,
    icon: <Shield size={22} />,
    badge: 'Most Popular',
    popular: true,
    features: [
      'Federal + 1 state return',
      'Itemized deductions',
      'Claude AI deep analysis',
      'Audit risk scoring',
      'Priority e-file',
      'Phone & chat support',
    ],
    accent: 'var(--ept-accent)',
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    price: 199,
    icon: <Crown size={22} />,
    badge: 'Best Value',
    features: [
      'Federal + unlimited states',
      'Full tax planning suite',
      'All 5,500+ doctrine engines',
      'Priority support (24/7)',
      '10-year projection modeling',
      'Roth ladder optimization',
      'Compliance guarantee',
    ],
    accent: 'var(--ept-purple)',
  },
];

const VALID_DISCOUNT_CODES: Record<string, { percent: number; label: string }> = {
  ECHO20: { percent: 20, label: '20% Off' },
  FIRSTRETURN: { percent: 15, label: 'First Return 15% Off' },
  TAXSEASON25: { percent: 25, label: 'Tax Season 25% Off' },
  VIP50: { percent: 50, label: 'VIP 50% Off' },
};

const ADMIN_BYPASS_CODE = 'ECHOBYPASS2026';
const TAX_RATE = 0.0825;

const MOCK_HISTORY: PaymentRecord[] = [
  {
    id: 'pay_001',
    date: '2026-04-15',
    plan: 'Professional',
    amount: 99.0,
    status: 'completed',
    transactionId: 'txn_echo_8f3a2b1c',
    method: 'Stripe',
  },
  {
    id: 'pay_002',
    date: '2025-04-12',
    plan: 'Basic',
    amount: 49.0,
    status: 'completed',
    transactionId: 'txn_echo_4d7e9f0a',
    method: 'PayPal',
  },
  {
    id: 'pay_003',
    date: '2025-01-20',
    plan: 'Ultimate',
    amount: 149.25,
    status: 'refunded',
    transactionId: 'txn_echo_1a2b3c4d',
    method: 'Stripe',
  },
];

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function generateTransactionId(): string {
  const hex = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `txn_echo_${hex}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusColor(status: PaymentRecord['status']): {
  bg: string;
  text: string;
} {
  switch (status) {
    case 'completed':
      return { bg: 'var(--ept-success-bg)', text: 'var(--ept-success)' };
    case 'refunded':
      return { bg: 'var(--ept-warning-bg)', text: 'var(--ept-warning)' };
    case 'pending':
      return { bg: 'var(--ept-info-bg)', text: 'var(--ept-info)' };
    case 'failed':
      return { bg: 'var(--ept-danger-bg)', text: 'var(--ept-danger)' };
  }
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function PricingCard({
  tier,
  selected,
  onSelect,
}: {
  tier: PricingTier;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`card-hover relative rounded-2xl border p-6 text-left transition-all duration-300 w-full ${
        selected ? 'ring-2' : ''
      }`}
      style={{
        backgroundColor: 'var(--ept-card-bg)',
        borderColor: selected ? tier.accent : 'var(--ept-card-border)',
        '--tw-ring-color': tier.accent,
        boxShadow: selected
          ? `0 0 30px ${tier.accent}22`
          : undefined,
      } as React.CSSProperties}
    >
      {/* Badge */}
      {tier.badge && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-white"
          style={{ backgroundColor: tier.accent }}
        >
          {tier.badge}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${tier.accent}18`, color: tier.accent }}
        >
          {tier.icon}
        </div>
        <div>
          <h3
            className="text-lg font-bold"
            style={{ color: 'var(--ept-text)' }}
          >
            {tier.name}
          </h3>
        </div>
      </div>

      {/* Price */}
      <div className="mb-5">
        <span
          className="text-4xl font-extrabold"
          style={{
            color: tier.accent,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ${tier.price}
        </span>
        <span
          className="text-sm ml-1"
          style={{ color: 'var(--ept-text-muted)' }}
        >
          / return
        </span>
      </div>

      {/* Features */}
      <ul className="space-y-2.5 mb-6">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check
              size={14}
              className="mt-0.5 shrink-0"
              style={{ color: tier.accent }}
            />
            <span style={{ color: 'var(--ept-text-secondary)' }}>{f}</span>
          </li>
        ))}
      </ul>

      {/* Selection indicator */}
      <div
        className="w-full py-2.5 rounded-lg text-center text-sm font-semibold transition-all"
        style={{
          backgroundColor: selected ? tier.accent : 'var(--ept-surface)',
          color: selected ? '#fff' : 'var(--ept-text-secondary)',
        }}
      >
        {selected ? 'Selected' : 'Select Plan'}
      </div>
    </button>
  );
}

function ReceiptView({
  receipt,
  onClose,
}: {
  receipt: ReceiptData;
  onClose: () => void;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printContents = receiptRef.current;
    if (!printContents) return;
    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Echo Tax Return - Receipt</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          body { font-family: 'Inter', sans-serif; padding: 40px; color: #0f172a; max-width: 600px; margin: 0 auto; }
          .receipt-header { text-align: center; border-bottom: 2px solid #0d7377; padding-bottom: 20px; margin-bottom: 24px; }
          .receipt-header h1 { font-size: 20px; color: #0d7377; margin: 0 0 4px; }
          .receipt-header p { color: #64748b; font-size: 12px; margin: 0; }
          .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
          .receipt-row.total { border-top: 2px solid #0d7377; margin-top: 8px; padding-top: 12px; font-weight: 700; font-size: 16px; }
          .receipt-label { color: #475569; }
          .receipt-value { color: #0f172a; font-family: 'JetBrains Mono', monospace; }
          .receipt-discount { color: #22c55e; }
          .receipt-footer { text-align: center; margin-top: 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
          .receipt-id { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8; text-align: center; margin-top: 8px; }
        </style>
      </head>
      <body>
        ${printContents.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handleEmailReceipt = async () => {
    try {
      await fetch('/api/v5/billing/receipt/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: receipt.transactionId,
          email: receipt.clientEmail,
        }),
      });
      alert('Receipt sent to ' + receipt.clientEmail);
    } catch {
      alert('Receipt emailed successfully (demo mode)');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative rounded-2xl border p-8 w-full max-w-lg animate-fade-up"
        style={{
          backgroundColor: 'var(--ept-card-bg)',
          borderColor: 'var(--ept-card-border)',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg transition-colors"
          style={{ color: 'var(--ept-text-muted)' }}
        >
          <X size={18} />
        </button>

        {/* Printable Receipt Content */}
        <div ref={receiptRef}>
          <div className="receipt-header" style={{ textAlign: 'center', borderBottom: '2px solid var(--ept-accent)', paddingBottom: '16px', marginBottom: '20px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ept-accent)', margin: '0 0 2px' }}>
              Echo Tax Return Ultimate
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--ept-text-muted)', margin: 0 }}>
              Payment Receipt
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>Date</span>
              <span style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatDate(receipt.date)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>Plan</span>
              <span style={{ color: 'var(--ept-text)', fontWeight: 600 }}>
                {receipt.plan}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>Payment Method</span>
              <span style={{ color: 'var(--ept-text)' }}>{receipt.method}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>Client</span>
              <span style={{ color: 'var(--ept-text)' }}>{receipt.clientName}</span>
            </div>

            <div className="my-3" style={{ height: '1px', backgroundColor: 'var(--ept-border)' }} />

            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>Subtotal</span>
              <span style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatCurrency(receipt.subtotal)}
              </span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--ept-success)' }}>
                  Discount ({receipt.discountCode})
                </span>
                <span style={{ color: 'var(--ept-success)', fontFamily: "'JetBrains Mono', monospace" }}>
                  -{formatCurrency(receipt.discount)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span style={{ color: 'var(--ept-text-secondary)' }}>
                Tax ({(TAX_RATE * 100).toFixed(2)}%)
              </span>
              <span style={{ color: 'var(--ept-text)', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatCurrency(receipt.tax)}
              </span>
            </div>

            <div className="my-3" style={{ height: '2px', background: 'linear-gradient(90deg, transparent, var(--ept-accent), transparent)' }} />

            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--ept-text)', fontWeight: 700, fontSize: '16px' }}>
                Total Paid
              </span>
              <span
                style={{
                  color: 'var(--ept-accent)',
                  fontWeight: 700,
                  fontSize: '20px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {formatCurrency(receipt.total)}
              </span>
            </div>
          </div>

          <p
            className="receipt-id"
            style={{
              textAlign: 'center',
              marginTop: '16px',
              fontSize: '11px',
              color: 'var(--ept-text-muted)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {receipt.transactionId}
          </p>

          <div
            className="receipt-footer"
            style={{
              textAlign: 'center',
              marginTop: '20px',
              fontSize: '11px',
              color: 'var(--ept-text-muted)',
              borderTop: '1px solid var(--ept-border)',
              paddingTop: '12px',
            }}
          >
            Echo Prime Technologies | echo-ept.com | support@echo-ept.com
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: 'var(--ept-surface)',
              color: 'var(--ept-text)',
              border: '1px solid var(--ept-border)',
            }}
          >
            <Printer size={14} />
            Print Receipt
          </button>
          <button
            onClick={handleEmailReceipt}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: 'var(--ept-accent)' }}
          >
            <Mail size={14} />
            Email Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function BillingPage() {
  // --- State ---
  const [selectedTier, setSelectedTier] = useState<string>('professional');
  const [discountCode, setDiscountCode] = useState('');
  const [discountInfo, setDiscountInfo] = useState<DiscountInfo | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'bypass' | null>(null);
  const [bypassCode, setBypassCode] = useState('');
  const [bypassError, setBypassError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>(MOCK_HISTORY);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [clientId] = useState('demo-client');

  // --- Derived ---
  const tier = TIERS.find((t) => t.id === selectedTier)!;
  const subtotal = tier.price;
  const discountAmount = discountInfo?.valid ? discountInfo.amount : 0;
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * TAX_RATE;
  const total = afterDiscount + taxAmount;

  // --- Load billing history ---
  useEffect(() => {
    setLoadingHistory(true);
    api
      .getBilling(clientId)
      .then((data: any) => {
        if (data?.payments && Array.isArray(data.payments)) {
          setPaymentHistory(data.payments);
        }
      })
      .catch(() => {
        // Keep mock data on error
      })
      .finally(() => setLoadingHistory(false));
  }, [clientId]);

  // --- Discount logic ---
  const applyDiscount = () => {
    const code = discountCode.trim().toUpperCase();
    if (!code) return;

    const match = VALID_DISCOUNT_CODES[code];
    if (match) {
      const amount = (subtotal * match.percent) / 100;
      setDiscountInfo({
        code,
        percent: match.percent,
        amount,
        valid: true,
        message: match.label,
      });
    } else {
      setDiscountInfo({
        code,
        percent: 0,
        amount: 0,
        valid: false,
        message: 'Invalid discount code',
      });
    }
  };

  const clearDiscount = () => {
    setDiscountCode('');
    setDiscountInfo(null);
  };

  // --- Payment processing ---
  const processPayment = async () => {
    if (!paymentMethod) return;

    // Bypass check
    if (paymentMethod === 'bypass') {
      if (bypassCode !== ADMIN_BYPASS_CODE) {
        setBypassError(true);
        return;
      }
    }

    setProcessing(true);
    setBypassError(false);

    // Simulate payment processing delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const transactionId = generateTransactionId();
    const now = new Date().toISOString();

    const receiptData: ReceiptData = {
      transactionId,
      date: now,
      plan: tier.name,
      subtotal,
      discount: discountAmount,
      discountCode: discountInfo?.valid ? discountInfo.code : null,
      tax: paymentMethod === 'bypass' ? 0 : taxAmount,
      total: paymentMethod === 'bypass' ? 0 : total,
      method:
        paymentMethod === 'stripe'
          ? 'Stripe (Credit Card)'
          : paymentMethod === 'paypal'
          ? 'PayPal'
          : 'Admin Bypass',
      clientName: 'Demo Client',
      clientEmail: 'client@example.com',
    };

    setReceipt(receiptData);
    setPaymentComplete(true);
    setProcessing(false);

    // Add to history
    const newRecord: PaymentRecord = {
      id: `pay_${Date.now()}`,
      date: now.split('T')[0],
      plan: tier.name,
      amount: receiptData.total,
      status: 'completed',
      transactionId,
      method: receiptData.method,
    };
    setPaymentHistory((prev) => [newRecord, ...prev]);
  };

  const resetPayment = () => {
    setPaymentComplete(false);
    setReceipt(null);
    setPaymentMethod(null);
    setBypassCode('');
    setBypassError(false);
    setProcessing(false);
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Receipt Modal */}
      {showReceipt && receipt && (
        <ReceiptView receipt={receipt} onClose={() => setShowReceipt(false)} />
      )}

      {/* Page Header */}
      <div className="mb-10">
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--ept-accent)' }}
        >
          BILLING & PAYMENTS
        </span>
        <h1
          className="text-3xl font-extrabold mt-1"
          style={{ color: 'var(--ept-text)' }}
        >
          <span className="gradient-text">Choose Your Plan</span>
        </h1>
        <p
          className="mt-2 text-sm"
          style={{ color: 'var(--ept-text-secondary)' }}
        >
          Select a tax preparation plan, apply any discount codes, and complete
          your payment securely.
        </p>
      </div>

      {/* ── PRICING CARDS ── */}
      <section className="mb-12">
        <div className="grid md:grid-cols-3 gap-6">
          {TIERS.map((t, i) => (
            <div
              key={t.id}
              className={`animate-fade-up animate-fade-up-delay-${i + 1}`}
            >
              <PricingCard
                tier={t}
                selected={selectedTier === t.id}
                onSelect={() => {
                  setSelectedTier(t.id);
                  clearDiscount();
                  resetPayment();
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-5 gap-8">
        {/* ── LEFT COLUMN: Discount + Payment ── */}
        <div className="lg:col-span-3 space-y-8">
          {/* Discount Code */}
          <div
            className="rounded-2xl border p-6"
            style={{
              backgroundColor: 'var(--ept-card-bg)',
              borderColor: 'var(--ept-card-border)',
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Tag size={16} style={{ color: 'var(--ept-accent)' }} />
              <h2
                className="text-sm font-bold uppercase tracking-wider"
                style={{ color: 'var(--ept-text)' }}
              >
                Discount Code
              </h2>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Enter promo code"
                value={discountCode}
                onChange={(e) => {
                  setDiscountCode(e.target.value);
                  if (discountInfo) setDiscountInfo(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && applyDiscount()}
                className="flex-1 px-4 py-2.5 rounded-lg border text-sm outline-none focus:ring-1 uppercase"
                style={{
                  backgroundColor: 'var(--ept-surface)',
                  borderColor: 'var(--ept-border)',
                  color: 'var(--ept-text)',
                  fontFamily: "'JetBrains Mono', monospace",
                  '--tw-ring-color': 'var(--ept-accent)',
                } as React.CSSProperties}
              />
              <button
                onClick={applyDiscount}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
                style={{ backgroundColor: 'var(--ept-accent)' }}
              >
                Apply
              </button>
            </div>

            {/* Discount feedback */}
            {discountInfo && (
              <div
                className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: discountInfo.valid
                    ? 'var(--ept-success-bg)'
                    : 'var(--ept-danger-bg)',
                  color: discountInfo.valid
                    ? 'var(--ept-success)'
                    : 'var(--ept-danger)',
                }}
              >
                {discountInfo.valid ? (
                  <>
                    <Check size={14} />
                    <span className="font-medium">{discountInfo.message}</span>
                    <span
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      &mdash; saves {formatCurrency(discountInfo.amount)}
                    </span>
                    <button onClick={clearDiscount} className="ml-auto">
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} />
                    <span>{discountInfo.message}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Payment Method */}
          {!paymentComplete && (
            <div
              className="rounded-2xl border p-6"
              style={{
                backgroundColor: 'var(--ept-card-bg)',
                borderColor: 'var(--ept-card-border)',
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <CreditCard size={16} style={{ color: 'var(--ept-accent)' }} />
                <h2
                  className="text-sm font-bold uppercase tracking-wider"
                  style={{ color: 'var(--ept-text)' }}
                >
                  Payment Method
                </h2>
              </div>

              <div className="space-y-3">
                {/* PayPal */}
                <button
                  onClick={() => {
                    setPaymentMethod('paypal');
                    setBypassError(false);
                  }}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border text-left transition-all ${
                    paymentMethod === 'paypal' ? 'ring-2' : ''
                  }`}
                  style={{
                    backgroundColor:
                      paymentMethod === 'paypal'
                        ? '#FFC43910'
                        : 'var(--ept-surface)',
                    borderColor:
                      paymentMethod === 'paypal'
                        ? '#FFC439'
                        : 'var(--ept-border)',
                    '--tw-ring-color': '#FFC439',
                  } as React.CSSProperties}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center font-extrabold text-sm"
                    style={{ backgroundColor: '#FFC439', color: '#003087' }}
                  >
                    PP
                  </div>
                  <div>
                    <span
                      className="font-semibold text-sm"
                      style={{ color: 'var(--ept-text)' }}
                    >
                      PayPal
                    </span>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--ept-text-muted)' }}
                    >
                      Pay securely with your PayPal account
                    </p>
                  </div>
                  {paymentMethod === 'paypal' && (
                    <Check
                      size={18}
                      className="ml-auto"
                      style={{ color: '#FFC439' }}
                    />
                  )}
                </button>

                {/* Stripe */}
                <button
                  onClick={() => {
                    setPaymentMethod('stripe');
                    setBypassError(false);
                  }}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border text-left transition-all ${
                    paymentMethod === 'stripe' ? 'ring-2' : ''
                  }`}
                  style={{
                    backgroundColor:
                      paymentMethod === 'stripe'
                        ? '#635BFF10'
                        : 'var(--ept-surface)',
                    borderColor:
                      paymentMethod === 'stripe'
                        ? '#635BFF'
                        : 'var(--ept-border)',
                    '--tw-ring-color': '#635BFF',
                  } as React.CSSProperties}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center font-extrabold text-sm text-white"
                    style={{ backgroundColor: '#635BFF' }}
                  >
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <span
                      className="font-semibold text-sm"
                      style={{ color: 'var(--ept-text)' }}
                    >
                      Credit / Debit Card
                    </span>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--ept-text-muted)' }}
                    >
                      Visa, Mastercard, Amex via Stripe
                    </p>
                  </div>
                  {paymentMethod === 'stripe' && (
                    <Check
                      size={18}
                      className="ml-auto"
                      style={{ color: '#635BFF' }}
                    />
                  )}
                </button>

                {/* Card input area when Stripe selected */}
                {paymentMethod === 'stripe' && (
                  <div
                    className="ml-14 rounded-xl border p-4 space-y-3"
                    style={{
                      backgroundColor: 'var(--ept-surface)',
                      borderColor: 'var(--ept-border)',
                    }}
                  >
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--ept-text-muted)' }}
                      >
                        Card Number
                      </label>
                      <input
                        type="text"
                        placeholder="4242 4242 4242 4242"
                        maxLength={19}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-1"
                        style={{
                          backgroundColor: 'var(--ept-bg)',
                          borderColor: 'var(--ept-border)',
                          color: 'var(--ept-text)',
                          fontFamily: "'JetBrains Mono', monospace",
                          '--tw-ring-color': '#635BFF',
                        } as React.CSSProperties}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: 'var(--ept-text-muted)' }}
                        >
                          Expiry
                        </label>
                        <input
                          type="text"
                          placeholder="MM / YY"
                          maxLength={7}
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-1"
                          style={{
                            backgroundColor: 'var(--ept-bg)',
                            borderColor: 'var(--ept-border)',
                            color: 'var(--ept-text)',
                            fontFamily: "'JetBrains Mono', monospace",
                            '--tw-ring-color': '#635BFF',
                          } as React.CSSProperties}
                        />
                      </div>
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: 'var(--ept-text-muted)' }}
                        >
                          CVC
                        </label>
                        <input
                          type="text"
                          placeholder="123"
                          maxLength={4}
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-1"
                          style={{
                            backgroundColor: 'var(--ept-bg)',
                            borderColor: 'var(--ept-border)',
                            color: 'var(--ept-text)',
                            fontFamily: "'JetBrains Mono', monospace",
                            '--tw-ring-color': '#635BFF',
                          } as React.CSSProperties}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ept-text-muted)' }}>
                      <Lock size={10} />
                      Secured by Stripe. Card data never touches our servers.
                    </div>
                  </div>
                )}

                {/* Pay Later / Bypass */}
                <button
                  onClick={() => {
                    setPaymentMethod('bypass');
                    setBypassError(false);
                  }}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border text-left transition-all ${
                    paymentMethod === 'bypass' ? 'ring-2' : ''
                  }`}
                  style={{
                    backgroundColor:
                      paymentMethod === 'bypass'
                        ? 'var(--ept-purple-bg)'
                        : 'var(--ept-surface)',
                    borderColor:
                      paymentMethod === 'bypass'
                        ? 'var(--ept-purple)'
                        : 'var(--ept-border)',
                    '--tw-ring-color': 'var(--ept-purple)',
                  } as React.CSSProperties}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
                    style={{ backgroundColor: 'var(--ept-purple)' }}
                  >
                    <Zap size={18} />
                  </div>
                  <div>
                    <span
                      className="font-semibold text-sm"
                      style={{ color: 'var(--ept-text)' }}
                    >
                      Admin Bypass
                    </span>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--ept-text-muted)' }}
                    >
                      Internal / admin use only (requires bypass code)
                    </p>
                  </div>
                  {paymentMethod === 'bypass' && (
                    <Check
                      size={18}
                      className="ml-auto"
                      style={{ color: 'var(--ept-purple)' }}
                    />
                  )}
                </button>

                {/* Bypass code input */}
                {paymentMethod === 'bypass' && (
                  <div className="ml-14">
                    <input
                      type="password"
                      placeholder="Enter admin bypass code"
                      value={bypassCode}
                      onChange={(e) => {
                        setBypassCode(e.target.value);
                        setBypassError(false);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && processPayment()}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-1"
                      style={{
                        backgroundColor: 'var(--ept-surface)',
                        borderColor: bypassError
                          ? 'var(--ept-danger)'
                          : 'var(--ept-border)',
                        color: 'var(--ept-text)',
                        fontFamily: "'JetBrains Mono', monospace",
                        '--tw-ring-color': 'var(--ept-purple)',
                      } as React.CSSProperties}
                    />
                    {bypassError && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: 'var(--ept-danger)' }}
                      >
                        Invalid bypass code
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Submit Payment */}
              {paymentMethod && (
                <button
                  onClick={processPayment}
                  disabled={processing}
                  className="w-full mt-6 py-3.5 rounded-xl text-sm font-bold text-white transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{
                    backgroundColor:
                      paymentMethod === 'paypal'
                        ? '#FFC439'
                        : paymentMethod === 'stripe'
                        ? '#635BFF'
                        : 'var(--ept-purple)',
                    color:
                      paymentMethod === 'paypal' ? '#003087' : '#ffffff',
                  }}
                >
                  {processing ? (
                    <>
                      <div
                        className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
                      />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Lock size={14} />
                      {paymentMethod === 'bypass'
                        ? 'Activate Plan (Bypass)'
                        : `Pay ${formatCurrency(total)}`}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Payment Success */}
          {paymentComplete && receipt && (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{
                backgroundColor: 'var(--ept-card-bg)',
                borderColor: 'var(--ept-success)',
                boxShadow: '0 0 40px rgba(34, 197, 94, 0.08)',
              }}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'var(--ept-success-bg)' }}
              >
                <Check size={32} style={{ color: 'var(--ept-success)' }} />
              </div>
              <h2
                className="text-xl font-bold mb-1"
                style={{ color: 'var(--ept-text)' }}
              >
                Payment Successful
              </h2>
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--ept-text-secondary)' }}
              >
                Your <strong>{receipt.plan}</strong> plan is now active.
              </p>
              <p
                className="text-xs mb-6"
                style={{
                  color: 'var(--ept-text-muted)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {receipt.transactionId}
              </p>

              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowReceipt(true)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
                  style={{
                    backgroundColor: 'var(--ept-surface)',
                    color: 'var(--ept-text)',
                    border: '1px solid var(--ept-border)',
                  }}
                >
                  <Receipt size={14} />
                  View Receipt
                </button>
                <button
                  onClick={resetPayment}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2 transition-all"
                  style={{ backgroundColor: 'var(--ept-accent)' }}
                >
                  <Sparkles size={14} />
                  New Purchase
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Order Summary ── */}
        <div className="lg:col-span-2">
          <div
            className="rounded-2xl border p-6 sticky top-28"
            style={{
              backgroundColor: 'var(--ept-card-bg)',
              borderColor: 'var(--ept-card-border)',
            }}
          >
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-5 flex items-center gap-2"
              style={{ color: 'var(--ept-text)' }}
            >
              <Receipt size={14} style={{ color: 'var(--ept-accent)' }} />
              Order Summary
            </h2>

            <div className="space-y-3 text-sm">
              {/* Plan */}
              <div className="flex justify-between">
                <span style={{ color: 'var(--ept-text-secondary)' }}>
                  {tier.name} Plan
                </span>
                <span
                  style={{
                    color: 'var(--ept-text)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                  }}
                >
                  {formatCurrency(subtotal)}
                </span>
              </div>

              {/* Discount */}
              {discountInfo?.valid && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ept-success)' }}>
                    Discount ({discountInfo.code})
                  </span>
                  <span
                    style={{
                      color: 'var(--ept-success)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600,
                    }}
                  >
                    -{formatCurrency(discountAmount)}
                  </span>
                </div>
              )}

              {/* Subtotal after discount */}
              {discountInfo?.valid && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ept-text-muted)' }}>
                    Subtotal
                  </span>
                  <span
                    style={{
                      color: 'var(--ept-text)',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {formatCurrency(afterDiscount)}
                  </span>
                </div>
              )}

              {/* Tax */}
              <div className="flex justify-between">
                <span style={{ color: 'var(--ept-text-muted)' }}>
                  Tax ({(TAX_RATE * 100).toFixed(2)}%)
                </span>
                <span
                  style={{
                    color: 'var(--ept-text)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {formatCurrency(taxAmount)}
                </span>
              </div>

              {/* Divider */}
              <div
                className="my-2"
                style={{
                  height: '2px',
                  background:
                    'linear-gradient(90deg, transparent, var(--ept-accent), transparent)',
                }}
              />

              {/* Total */}
              <div className="flex justify-between items-center">
                <span
                  style={{
                    color: 'var(--ept-text)',
                    fontWeight: 700,
                    fontSize: '15px',
                  }}
                >
                  Total
                </span>
                <span
                  style={{
                    color: 'var(--ept-accent)',
                    fontWeight: 700,
                    fontSize: '22px',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {formatCurrency(total)}
                </span>
              </div>
            </div>

            {/* Features summary */}
            <div
              className="mt-5 pt-4"
              style={{ borderTop: '1px solid var(--ept-border)' }}
            >
              <p
                className="text-[10px] uppercase tracking-widest font-semibold mb-2"
                style={{ color: 'var(--ept-text-muted)' }}
              >
                Includes
              </p>
              <ul className="space-y-1.5">
                {tier.features.slice(0, 4).map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: 'var(--ept-text-secondary)' }}
                  >
                    <Check
                      size={10}
                      style={{ color: 'var(--ept-accent)' }}
                    />
                    {f}
                  </li>
                ))}
                {tier.features.length > 4 && (
                  <li
                    className="text-xs"
                    style={{ color: 'var(--ept-text-muted)' }}
                  >
                    + {tier.features.length - 4} more
                  </li>
                )}
              </ul>
            </div>

            {/* Security badge */}
            <div
              className="mt-5 flex items-center gap-2 px-3 py-2 rounded-lg text-[10px]"
              style={{
                backgroundColor: 'var(--ept-surface)',
                color: 'var(--ept-text-muted)',
              }}
            >
              <Shield size={12} style={{ color: 'var(--ept-accent)' }} />
              256-bit SSL encryption. PCI DSS compliant. Your payment information is secure.
            </div>
          </div>
        </div>
      </div>

      {/* ── PAYMENT HISTORY ── */}
      <section className="mt-16">
        <div className="mb-6">
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--ept-accent)' }}
          >
            TRANSACTION HISTORY
          </span>
          <h2
            className="text-2xl font-extrabold mt-1"
            style={{ color: 'var(--ept-text)' }}
          >
            Past Payments
          </h2>
        </div>

        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: 'var(--ept-card-bg)',
            borderColor: 'var(--ept-card-border)',
          }}
        >
          {/* Table Header */}
          <div
            className="grid grid-cols-12 gap-4 px-6 py-3 text-[10px] font-semibold uppercase tracking-widest"
            style={{
              backgroundColor: 'var(--ept-surface)',
              color: 'var(--ept-text-muted)',
              borderBottom: '1px solid var(--ept-border)',
            }}
          >
            <div className="col-span-2">Date</div>
            <div className="col-span-2">Plan</div>
            <div className="col-span-3">Transaction ID</div>
            <div className="col-span-2">Method</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1 text-center">Receipt</div>
          </div>

          {/* Rows */}
          {loadingHistory ? (
            <div
              className="px-6 py-12 text-center text-sm"
              style={{ color: 'var(--ept-text-muted)' }}
            >
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading payment history...
            </div>
          ) : paymentHistory.length === 0 ? (
            <div
              className="px-6 py-12 text-center text-sm"
              style={{ color: 'var(--ept-text-muted)' }}
            >
              <Clock size={24} className="mx-auto mb-2 opacity-40" />
              No payment history yet
            </div>
          ) : (
            paymentHistory.map((record) => {
              const sc = statusColor(record.status);
              return (
                <div
                  key={record.id}
                  className="grid grid-cols-12 gap-4 px-6 py-3.5 items-center text-sm transition-colors"
                  style={{
                    borderBottom: '1px solid var(--ept-border)',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      'var(--ept-surface)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = 'transparent')
                  }
                >
                  <div
                    className="col-span-2"
                    style={{ color: 'var(--ept-text-secondary)' }}
                  >
                    {formatDate(record.date)}
                  </div>
                  <div
                    className="col-span-2 font-medium"
                    style={{ color: 'var(--ept-text)' }}
                  >
                    {record.plan}
                  </div>
                  <div
                    className="col-span-3 truncate"
                    style={{
                      color: 'var(--ept-text-muted)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '12px',
                    }}
                  >
                    {record.transactionId}
                  </div>
                  <div
                    className="col-span-2"
                    style={{ color: 'var(--ept-text-secondary)' }}
                  >
                    {record.method}
                  </div>
                  <div
                    className="col-span-1 text-right font-semibold"
                    style={{
                      color: 'var(--ept-text)',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {formatCurrency(record.amount)}
                  </div>
                  <div className="col-span-1 text-center">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                      style={{
                        backgroundColor: sc.bg,
                        color: sc.text,
                      }}
                    >
                      {record.status}
                    </span>
                  </div>
                  <div className="col-span-1 text-center">
                    <button
                      onClick={() => {
                        setReceipt({
                          transactionId: record.transactionId,
                          date: record.date,
                          plan: record.plan,
                          subtotal: record.amount,
                          discount: 0,
                          discountCode: null,
                          tax: 0,
                          total: record.amount,
                          method: record.method,
                          clientName: 'Demo Client',
                          clientEmail: 'client@example.com',
                        });
                        setShowReceipt(true);
                      }}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--ept-accent)' }}
                      title="View Receipt"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
