import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RendererErrorBoundary } from './RendererErrorBoundary';

function Bomb(): JSX.Element {
  throw new Error('overlay render exploded');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RendererErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    const report = vi.fn();

    render(
      <RendererErrorBoundary report={report}>
        <p>overlay content</p>
      </RendererErrorBoundary>,
    );

    expect(screen.getByText('overlay content')).toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });

  it('catches a render error, shows the fallback, and reports it', () => {
    // React logs caught boundary errors to console.error — expected noise
    // for this test only, silenced to keep the output assertion-clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const report = vi.fn();

    render(
      <RendererErrorBoundary report={report}>
        <Bomb />
      </RendererErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'overlay render exploded' }),
      'Unhandled route error',
    );
  });
});
