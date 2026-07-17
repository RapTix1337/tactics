import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Sidebar } from '@/components/ui/sidebar';

import { AppLayout } from './AppLayout';

function getSidebarState(): string | null {
  const sidebar = document.querySelector('[data-slot="sidebar"]');
  return sidebar instanceof HTMLElement ? sidebar.getAttribute('data-state') : null;
}

describe('AppLayout', () => {
  it('renders the sidebar slot and the content area behind the stable app-root selector', () => {
    render(
      <AppLayout sidebar={<div data-testid="sidebar-stub" />}>
        <p>content area</p>
      </AppLayout>,
    );

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-stub')).toBeInTheDocument();
    expect(screen.getByText('content area')).toBeInTheDocument();
  });

  it('collapses and expands the sidebar via the trigger (UI-05)', async () => {
    const user = userEvent.setup();
    render(
      <AppLayout sidebar={<Sidebar>entries</Sidebar>}>
        <p>content area</p>
      </AppLayout>,
    );

    expect(getSidebarState()).toBe('expanded');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(getSidebarState()).toBe('collapsed');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(getSidebarState()).toBe('expanded');
  });

  it('toggles the sidebar with the keyboard shortcut (UI-06)', async () => {
    const user = userEvent.setup();
    render(
      <AppLayout sidebar={<Sidebar>entries</Sidebar>}>
        <p>content area</p>
      </AppLayout>,
    );

    expect(getSidebarState()).toBe('expanded');
    await user.keyboard('{Control>}b{/Control}');
    expect(getSidebarState()).toBe('collapsed');
  });
});
