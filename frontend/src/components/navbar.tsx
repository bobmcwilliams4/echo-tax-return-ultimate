'use client';

import Link from 'next/link';
import { useTheme } from '@/lib/theme-context';
import { Sun, Moon, Menu, X } from 'lucide-react';
import { useState } from 'react';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/returns', label: 'Returns' },
  { href: '/prepare', label: 'Prepare' },
  { href: '/engine', label: 'AI Engine' },
  { href: '/state-tax', label: 'States' },
  { href: '/reference', label: 'Reference' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/efile', label: 'E-File' },
  { href: '/planning', label: 'Planning' },
  { href: '/ops', label: 'Ops' },
  { href: '/billing', label: 'Billing' },
];

export function Navbar() {
  const { isDark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-20 flex items-center border-b backdrop-blur-2xl transition-colors duration-500"
      style={{ backgroundColor: 'var(--ept-nav-bg)', borderColor: 'var(--ept-border)' }}
    >
      <div className="max-w-6xl mx-auto w-full px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--ept-accent)' }}>
            <span className="text-white font-extrabold text-sm">ET</span>
          </div>
          <span className="font-extrabold text-lg" style={{ color: 'var(--ept-text)' }}>
            Echo Tax <span className="gradient-text">Ultimate</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: 'var(--ept-text-secondary)' }}
            >
              {link.label}
            </Link>
          ))}

          <button
            onClick={toggle}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
            style={{ backgroundColor: 'var(--ept-surface)', color: 'var(--ept-text-secondary)' }}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)} style={{ color: 'var(--ept-text)' }}>
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="absolute top-20 left-0 right-0 border-b p-6 flex flex-col gap-4 md:hidden backdrop-blur-2xl"
          style={{ backgroundColor: 'var(--ept-nav-bg)', borderColor: 'var(--ept-border)' }}
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium"
              style={{ color: 'var(--ept-text-secondary)' }}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <button onClick={toggle} className="text-sm font-medium text-left" style={{ color: 'var(--ept-text-secondary)' }}>
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      )}
    </nav>
  );
}
