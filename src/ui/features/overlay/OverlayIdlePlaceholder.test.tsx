import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OverlayIdlePlaceholder } from './OverlayIdlePlaceholder';

describe('OverlayIdlePlaceholder', () => {
  it('renders a black panel filling its slot', () => {
    render(<OverlayIdlePlaceholder />);

    const panel = screen.getByTestId('overlay-idle-placeholder');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass('bg-black');
    expect(panel).toHaveClass('h-full');
  });

  it('carries a subtle waiting hint so the overlay reads as alive, not broken', () => {
    render(<OverlayIdlePlaceholder />);

    expect(screen.getByText('Waiting for match…')).toBeInTheDocument();
  });

  it('sets no opacity of its own — the ancestor content slot owns the chrome fade', () => {
    render(<OverlayIdlePlaceholder />);

    expect(screen.getByTestId('overlay-idle-placeholder').style.opacity).toBe('');
  });
});
