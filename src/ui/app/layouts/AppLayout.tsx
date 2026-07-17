import type { JSX, ReactNode } from 'react';

import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

interface AppLayoutProps {
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
}

/**
 * Structural shell (UI-01): a sidebar slot plus the content area. Domain-free
 * by design (03-technical-design.md §3.1) — the sidebar feature is injected,
 * never imported. The trigger sits in a fixed header inside the content area
 * so collapsing stays reversible at every width (UI-05); the provider also
 * binds Ctrl/Cmd+B as the keyboard equivalent (UI-06).
 *
 * data-testid="app-root" is the stable E2E root selector (E4.1 contract) —
 * renaming it breaks the E2E suite.
 */
export function AppLayout({ sidebar, children }: AppLayoutProps): JSX.Element {
  return (
    // h-svh caps the shell at the viewport (the shadcn default is only
    // min-h-svh, which grows with content): pages scroll inside the content
    // area below, never the window — and the map view's h-full chain
    // resolves, so a map image always fits the viewport at the fit scale.
    <SidebarProvider className="h-svh" data-testid="app-root">
      {sidebar}
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
