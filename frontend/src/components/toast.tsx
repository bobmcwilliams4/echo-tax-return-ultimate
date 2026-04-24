'use client';

import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

const TOAST_ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; icon: string; text: string }> = {
  success: {
    bg: 'var(--ept-success-bg)',
    border: 'var(--ept-success)',
    icon: 'var(--ept-success)',
    text: 'var(--ept-text)',
  },
  error: {
    bg: 'var(--ept-danger-bg)',
    border: 'var(--ept-danger)',
    icon: 'var(--ept-danger)',
    text: 'var(--ept-text)',
  },
  warning: {
    bg: 'var(--ept-warning-bg, rgba(234, 179, 8, 0.1))',
    border: 'var(--ept-warning, #eab308)',
    icon: 'var(--ept-warning, #eab308)',
    text: 'var(--ept-text)',
  },
  info: {
    bg: 'var(--ept-info-bg)',
    border: 'var(--ept-info)',
    icon: 'var(--ept-info)',
    text: 'var(--ept-text)',
  },
};

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 4000;

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++toastCounter;
      setToasts((prev) => {
        const next = [...prev, { id, message, type, exiting: false }];
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });
      setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col-reverse gap-3 pointer-events-none">
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const colors = TOAST_COLORS[item.type];
  const Icon = TOAST_ICONS[item.type];
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const slideIn = mounted && !item.exiting;

  return (
    <div
      className="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl transition-all duration-300 min-w-[320px] max-w-[420px]"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        opacity: slideIn ? 1 : 0,
        transform: slideIn ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      <Icon size={18} style={{ color: colors.icon, flexShrink: 0, marginTop: 2 }} />
      <span className="text-sm font-medium flex-1" style={{ color: colors.text }}>
        {item.message}
      </span>
      <button
        onClick={onClose}
        className="flex-shrink-0 rounded-md p-0.5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--ept-text-muted)' }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
