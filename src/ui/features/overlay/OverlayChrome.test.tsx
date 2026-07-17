import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import { closeOverlay } from '../../lib/ipc/overlay';
import { OverlayChrome } from './OverlayChrome';

vi.mock('../../lib/ipc/overlay', () => ({ closeOverlay: vi.fn() }));

describe('OverlayChrome', () => {
  beforeEach(() => {
    vi.mocked(closeOverlay)
      .mockReset()
      .mockResolvedValue(success({ open: false }));
  });

  it('renders the draggable bar with the window title', () => {
    render(<OverlayChrome />);

    const bar = screen.getByTestId('overlay-chrome');
    expect(bar).toHaveClass('app-region-drag');
    expect(bar).toHaveTextContent('TactiCS Overlay');
  });

  it('fades with the chrome region variable (ADR-060)', () => {
    render(<OverlayChrome />);

    expect(screen.getByTestId('overlay-chrome')).toHaveStyle({
      opacity: 'var(--fade-chrome)',
    });
  });

  it('closes the overlay via overlay.close from the no-drag close button', async () => {
    const user = userEvent.setup();
    render(<OverlayChrome />);

    const close = screen.getByRole('button', { name: 'Close overlay' });
    expect(close).toHaveClass('app-region-no-drag');
    await user.click(close);

    expect(closeOverlay).toHaveBeenCalledTimes(1);
  });
});
