'use client';

import type { CSSProperties } from 'react';

const shimmerStyle: CSSProperties = {
  background: 'linear-gradient(90deg, var(--ept-surface) 25%, var(--ept-border) 50%, var(--ept-surface) 75%)',
  backgroundSize: '200% 100%',
  animation: 'ept-shimmer 1.5s ease-in-out infinite',
};

const shimmerKeyframes = `
@keyframes ept-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

function ShimmerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: shimmerKeyframes }} />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <>
      <ShimmerStyles />
      <div className={`rounded-lg ${className}`} style={shimmerStyle} />
    </>
  );
}

export function CardSkeleton() {
  return (
    <>
      <ShimmerStyles />
      <div
        className="rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        <div className="h-5 w-1/3 rounded-lg" style={shimmerStyle} />
        <div className="space-y-3">
          <div className="h-3 w-full rounded" style={shimmerStyle} />
          <div className="h-3 w-5/6 rounded" style={shimmerStyle} />
          <div className="h-3 w-4/6 rounded" style={shimmerStyle} />
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="h-4 w-20 rounded" style={shimmerStyle} />
          <div className="h-8 w-24 rounded-lg" style={shimmerStyle} />
        </div>
      </div>
    </>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      <ShimmerStyles />
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-4 px-6 py-4 border-b"
          style={{ borderColor: 'var(--ept-border)' }}
        >
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-3 rounded flex-1" style={shimmerStyle} />
          ))}
        </div>

        {/* Rows */}
        {[...Array(rows)].map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-center gap-4 px-6 py-4 border-b last:border-b-0"
            style={{ borderColor: 'var(--ept-border)' }}
          >
            <div className="w-8 h-8 rounded-lg flex-shrink-0" style={shimmerStyle} />
            <div className="h-3 rounded flex-1" style={shimmerStyle} />
            <div className="h-3 rounded w-24" style={shimmerStyle} />
            <div className="h-3 rounded w-16" style={shimmerStyle} />
            <div className="h-6 rounded-full w-20" style={shimmerStyle} />
          </div>
        ))}
      </div>
    </>
  );
}

export function StatSkeleton() {
  return (
    <>
      <ShimmerStyles />
      <div
        className="rounded-2xl border p-6 flex flex-col items-center gap-2"
        style={{ backgroundColor: 'var(--ept-card-bg)', borderColor: 'var(--ept-card-border)' }}
      >
        <div className="w-10 h-10 rounded-xl" style={shimmerStyle} />
        <div className="h-8 w-16 rounded-lg mt-2" style={shimmerStyle} />
        <div className="h-3 w-24 rounded" style={shimmerStyle} />
      </div>
    </>
  );
}

export function PageLoader() {
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ backgroundColor: 'var(--ept-bg)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-12 h-12">
          <div
            className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--ept-border)', borderTopColor: 'transparent' }}
          />
          <div
            className="absolute inset-1 rounded-full border-2 border-b-transparent animate-spin"
            style={{
              borderColor: 'var(--ept-accent)',
              borderBottomColor: 'transparent',
              animationDirection: 'reverse',
              animationDuration: '0.8s',
            }}
          />
        </div>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ept-text-muted)' }}>
          Loading...
        </span>
      </div>
    </div>
  );
}
