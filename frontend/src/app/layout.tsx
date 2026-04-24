import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/lib/theme-context';
import { Navbar } from '@/components/navbar';
import { ToastProvider } from '@/components/toast';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'Echo Tax Return Ultimate',
  description: 'AI-native tax preparation platform with 5,500+ engines, 57K+ doctrines, IRS MeF e-file, and Claude Opus deep analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
        <ThemeProvider>
          <ToastProvider>
            <ErrorBoundary>
              <Navbar />
              <main className="flex-1 pt-20">{children}</main>
            </ErrorBoundary>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
