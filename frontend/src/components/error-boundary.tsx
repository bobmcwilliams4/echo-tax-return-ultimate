'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorCard error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}

function ErrorCard({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[300px] p-6">
      <div
        className="rounded-2xl border max-w-lg w-full p-8 text-center space-y-5"
        style={{
          backgroundColor: 'var(--ept-danger-bg)',
          borderColor: 'var(--ept-danger)',
        }}
      >
        <div className="flex justify-center">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--ept-danger)', opacity: 0.15 }}
          />
          <AlertTriangle
            size={28}
            className="absolute mt-3"
            style={{ color: 'var(--ept-danger)' }}
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ept-text)' }}>
            Something went wrong
          </h2>
          {error && (
            <p
              className="text-sm font-mono rounded-lg px-4 py-2"
              style={{
                color: 'var(--ept-danger)',
                backgroundColor: 'var(--ept-surface)',
              }}
            >
              {error.message}
            </p>
          )}
        </div>

        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all duration-200 hover:opacity-90 active:scale-95"
          style={{
            backgroundColor: 'var(--ept-danger)',
            color: '#ffffff',
          }}
        >
          <RotateCcw size={16} />
          Try Again
        </button>
      </div>
    </div>
  );
}
