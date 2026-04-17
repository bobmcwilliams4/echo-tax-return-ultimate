'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Shield, Brain, FileText, Calculator, Zap, Lock, ArrowRight } from 'lucide-react';

const ENGINES = [
  { id: 'FIE', name: 'Federal Income', icon: '⬣' },
  { id: 'STE', name: 'State Tax', icon: '◆' },
  { id: 'BIE', name: 'Business', icon: '▣' },
  { id: 'CRE', name: 'Credits', icon: '⬡' },
  { id: 'DEP', name: 'Depreciation', icon: '⬢' },
  { id: 'CRY', name: 'Crypto', icon: '◇' },
  { id: 'AUD', name: 'Audit Risk', icon: '⬣' },
  { id: 'PLN', name: 'Planning', icon: '◆' },
  { id: 'TIE', name: 'Tax Intelligence', icon: '▣' },
  { id: 'PIE', name: 'Product Intel', icon: '⬡' },
  { id: 'ARCS', name: 'Audit Risk Calc', icon: '⬢' },
  { id: 'INT', name: 'International', icon: '◇' },
  { id: 'EST', name: 'Estate', icon: '⬣' },
  { id: 'LEG', name: 'Legal', icon: '◆' },
];

const FEATURES = [
  { icon: Brain, title: 'Claude Opus Deep Analysis', desc: 'CPA-grade tax reasoning via Claude subprocess. Three-layer response in milliseconds.' },
  { icon: Calculator, title: '13-Step Tax Calculation', desc: 'Full federal income engine: brackets, SE tax, AMT, NIIT, QBI, credits, optimization.' },
  { icon: FileText, title: 'IRS MeF E-File', desc: 'SOAP 1.1 + MIME multipart XML generation with A2A transmission and rejection auto-fix.' },
  { icon: Shield, title: 'AES-256-GCM Encryption', desc: 'Zero-knowledge PII protection. SSN, bank data encrypted at rest with field-level encryption.' },
  { icon: Lock, title: 'Hash-Chained Audit Trail', desc: 'SHA-256 append-only audit log. Every action tamper-evident and forensically verifiable.' },
  { icon: Zap, title: '220+ API Endpoints', desc: 'Complete REST API with Zod validation, tiered rate limiting, and role-based access control.' },
];

export default function HomePage() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  const engineCount = health?.services?.engines ? Object.keys(health.services.engines).length : 14;
  const uptime = health?.uptime_seconds || 0;
  const uptimeStr = uptime > 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : `${Math.floor(uptime / 60)}m`;

  return (
    <div className="mesh-bg">
      {/* Hero */}
      <section className="pt-24 pb-32 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <div className="animate-fade-up">
            <span
              className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-medium border backdrop-blur-sm mb-8"
              style={{ background: 'var(--ept-accent-glow)', borderColor: 'var(--ept-accent)', color: 'var(--ept-accent)' }}
            >
              {health?.status === 'healthy' ? 'SYSTEM OPERATIONAL' : 'LOADING...'}
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] tracking-tight animate-fade-up animate-fade-up-delay-1" style={{ color: 'var(--ept-text)' }}>
            Echo Tax Return<br />
            <span className="gradient-text">Ultimate</span>
          </h1>

          <p className="mt-6 text-xl leading-relaxed max-w-2xl mx-auto animate-fade-up animate-fade-up-delay-2" style={{ color: 'var(--ept-text-secondary)' }}>
            AI-native tax preparation with 14 doctrine engines, IRS MeF e-file, and Claude Opus deep analysis. CPA-grade accuracy in milliseconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10 animate-fade-up animate-fade-up-delay-3">
            <Link
              href="/dashboard"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90 flex items-center gap-2"
              style={{ backgroundColor: 'var(--ept-accent)' }}
            >
              Open Dashboard <ArrowRight size={16} />
            </Link>
            <Link
              href="/engine"
              className="px-7 py-3.5 rounded-xl border font-semibold transition-all hover:opacity-80"
              style={{ borderColor: 'var(--ept-border)', color: 'var(--ept-text-secondary)' }}
            >
              Try AI Engine
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Strip */}
      <section className="px-6 pb-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px rounded-2xl overflow-hidden glow-sm" style={{ backgroundColor: 'var(--ept-border)' }}>
            {[
              { value: `${engineCount}`, label: 'TAX ENGINES' },
              { value: '220+', label: 'API ENDPOINTS' },
              { value: '24', label: 'DATABASE TABLES' },
              { value: '2025', label: 'TAX YEAR' },
              { value: uptimeStr || '0m', label: 'UPTIME' },
            ].map((stat) => (
              <div key={stat.label} className="p-6 md:p-8 text-center" style={{ backgroundColor: 'var(--ept-bg)' }}>
                <div className="text-3xl md:text-4xl font-extrabold gradient-text" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {stat.value}
                </div>
                <div className="text-xs uppercase tracking-widest font-medium mt-2" style={{ color: 'var(--ept-text-muted)' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="accent-line max-w-6xl mx-auto" />

      {/* 14 Engines Grid */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
              DOCTRINE ENGINE FLEET
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold mt-3" style={{ color: 'var(--ept-text)' }}>
              14 Specialized Tax Engines
            </h2>
            <p className="mt-3 max-w-xl mx-auto" style={{ color: 'var(--ept-text-secondary)' }}>
              Each engine contains pre-compiled doctrine blocks with IRC authority, Treasury Regulations, and case law citations.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {ENGINES.map((engine) => (
              <div
                key={engine.id}
                className="p-3 rounded-xl border text-center card-hover cursor-default"
                style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
              >
                <div className="text-2xl mb-1" style={{ color: 'var(--ept-accent)' }}>{engine.icon}</div>
                <div className="text-xs font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ept-accent)' }}>
                  {engine.id}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--ept-text-muted)' }}>{engine.name}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="accent-line max-w-6xl mx-auto" />

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-accent)' }}>
              CAPABILITIES
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold mt-3" style={{ color: 'var(--ept-text)' }}>
              Production-Grade Tax Platform
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feat) => (
              <div
                key={feat.title}
                className="p-6 rounded-2xl border card-hover"
                style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: 'var(--ept-accent-glow)', color: 'var(--ept-accent)' }}
                >
                  <feat.icon size={20} />
                </div>
                <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--ept-text)' }}>{feat.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ept-text-secondary)' }}>{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t" style={{ borderColor: 'var(--ept-border)' }}>
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm" style={{ color: 'var(--ept-text-muted)' }}>
            Echo Tax Return Ultimate v1.0.0 &mdash; Echo Prime Technologies
          </p>
        </div>
      </footer>
    </div>
  );
}
