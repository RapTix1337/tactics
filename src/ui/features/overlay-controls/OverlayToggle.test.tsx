import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import { closeOverlay, openOverlay } from '../../lib/ipc/overlay';
import { useOverlayStore } from '../../stores/overlay-store';
import { OverlayToggle } from './OverlayToggle';

vi.mock('../../lib/ipc/overlay', () => ({
  openOverlay: vi.fn(),
  closeOverlay: vi.fn(),
}));

describe('OverlayToggle', () => {
  beforeEach(() => {
    vi.mocked(openOverlay)
      .mockReset()
      .mockResolvedValue(success({ open: true }));
    vi.mocked(closeOverlay)
      .mockReset()
      .mockResolvedValue(success({ open: false }));
    useOverlayStore.setState({ overlay: undefined });
  });

  it('renders nothing until the overlay snapshot arrives', () => {
    render(<OverlayToggle />);

    expect(screen.queryByRole('switch', { name: 'Overlay' })).not.toBeInTheDocument();
  });

  it('dispatches overlay.open when toggled while closed (spec AC 1)', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    const toggle = screen.getByRole('switch', { name: 'Overlay' });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(openOverlay).toHaveBeenCalledTimes(1);
    expect(closeOverlay).not.toHaveBeenCalled();
    // No optimistic UI (ADR-033): the switch follows evt:overlay.changed.
    expect(toggle).not.toBeChecked();
  });

  it('dispatches overlay.close when toggled while open (spec AC 7)', async () => {
    useOverlayStore.setState({ overlay: { open: true } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    const toggle = screen.getByRole('switch', { name: 'Overlay' });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(openOverlay).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();
  });

  it('follows the mirror when the overlay state changes', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    render(<OverlayToggle />);
    expect(screen.getByRole('switch', { name: 'Overlay' })).not.toBeChecked();

    act(() => {
      useOverlayStore.setState({ overlay: { open: true } });
    });

    expect(await screen.findByRole('switch', { name: 'Overlay', checked: true })).toBeChecked();
  });
});
