import './globals.css';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { DataFreshnessProvider } from '@/components/layout/DataFreshnessProvider';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Suspense fallback={null}>
          <DataFreshnessProvider />
        </Suspense>
      </body>
    </html>
  );
}

