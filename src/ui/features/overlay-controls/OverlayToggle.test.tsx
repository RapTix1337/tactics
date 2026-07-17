import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('shows the confirmation dialog instead of dispatching when toggled on (OVL.11)', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    await user.click(screen.getByRole('switch', { name: 'Overlay' }));

    expect(screen.getByRole('dialog', { name: 'Open the overlay?' })).toBeInTheDocument();
    expect(openOverlay).not.toHaveBeenCalled();
    expect(closeOverlay).not.toHaveBeenCalled();
    // No optimistic UI (ADR-033): the switch stays off until the mirror
    // reports open. `hidden` because the modal aria-hides the page behind it.
    expect(screen.getByRole('switch', { name: 'Overlay', hidden: true })).not.toBeChecked();
  });

  it('dispatches overlay.open exactly once and closes the dialog on Continue (spec AC 1)', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    await user.click(screen.getByRole('switch', { name: 'Overlay' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(openOverlay).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('dispatches nothing and closes the dialog on Cancel (OVL.11)', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    await user.click(screen.getByRole('switch', { name: 'Overlay' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(openOverlay).not.toHaveBeenCalled();
    expect(closeOverlay).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('switch', { name: 'Overlay' })).not.toBeChecked();
  });

  it('shows the dialog again on the next toggle after Cancel (no persistence, OVL.11)', async () => {
    useOverlayStore.setState({ overlay: { open: false } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    await user.click(screen.getByRole('switch', { name: 'Overlay' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('switch', { name: 'Overlay' }));

    expect(screen.getByRole('dialog', { name: 'Open the overlay?' })).toBeInTheDocument();
    expect(openOverlay).not.toHaveBeenCalled();
  });

  it('dispatches overlay.close without a dialog when toggled while open (spec AC 7)', async () => {
    useOverlayStore.setState({ overlay: { open: true } });
    const user = userEvent.setup();
    render(<OverlayToggle />);

    const toggle = screen.getByRole('switch', { name: 'Overlay' });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(openOverlay).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
