import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogCallout } from '../../../shared/map-catalog';
import { toDraft } from './callout-editing';
import type { CalloutLayerEditing } from './CalloutLayer';
import { CalloutLayer } from './CalloutLayer';

const callouts: readonly CatalogCallout[] = [
  { name: 'Long', x: 0.25, y: 0.5 },
  { name: 'Pit', x: 0.9, y: 0.1 },
];

const rect = { left: 16, top: 24, width: 800, height: 600 };

describe('CalloutLayer (view mode)', () => {
  it('renders nothing while the image is unmeasured', () => {
    render(<CalloutLayer callouts={callouts} rect={undefined} scale={1} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('positions each callout by its normalized coordinates inside the image box', () => {
    render(<CalloutLayer callouts={callouts} rect={rect} scale={1} />);

    const layer = screen.getByRole('list', { name: 'Callouts' });
    expect(layer).toHaveStyle({ left: '16px', top: '24px', width: '800px', height: '600px' });
    const long = screen.getByText('Long');
    expect(long).toHaveStyle({ left: '25%', top: '50%' });
    const pit = screen.getByText('Pit');
    expect(pit).toHaveStyle({ left: '90%', top: '10%' });
    expect(long.style.transform).toBe('translate(-50%, -50%) scale(1)');
  });

  it('counter-scales the labels so they keep a constant screen size', () => {
    render(<CalloutLayer callouts={callouts} rect={rect} scale={4} />);

    expect(screen.getByText('Long').style.transform).toBe('translate(-50%, -50%) scale(0.25)');
  });

  it('renders nothing for a profile without callouts', () => {
    render(<CalloutLayer callouts={[]} rect={rect} scale={1} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('CalloutLayer (edit mode, E22.6)', () => {
  function renderEditing(overrides?: Partial<CalloutLayerEditing>, scale = 1): CalloutLayerEditing {
    const editing: CalloutLayerEditing = {
      draft: toDraft(callouts),
      disabled: false,
      toNormalized: vi.fn(() => ({ x: 0.5, y: 0.5 })),
      onMove: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    };
    render(<CalloutLayer callouts={[]} rect={rect} scale={scale} editing={editing} />);
    return editing;
  }

  it('renders the draft entries as focusable buttons', () => {
    renderEditing();

    expect(screen.getByRole('button', { name: 'Long' })).toHaveAccessibleDescription(
      'Move with the arrow keys, rename with Enter, delete with Delete.',
    );
    expect(screen.getByRole('button', { name: 'Pit' })).toBeEnabled();
  });

  it('drags a label to the inverted, clamped position', () => {
    const editing = renderEditing({ toNormalized: vi.fn(() => ({ x: 1.5, y: -0.2 })) });
    const long = screen.getByRole('button', { name: 'Long' });

    fireEvent.pointerDown(long, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(long, { pointerId: 7, clientX: 900, clientY: 10 });

    expect(editing.toNormalized).toHaveBeenCalledWith({ x: 900, y: 10 });
    expect(editing.onMove).toHaveBeenCalledWith(0, { x: 1, y: 0 });
  });

  it('ignores pointer moves without a preceding grab', () => {
    const editing = renderEditing();

    fireEvent.pointerMove(screen.getByRole('button', { name: 'Long' }), {
      pointerId: 7,
      clientX: 900,
      clientY: 10,
    });

    expect(editing.onMove).not.toHaveBeenCalled();
  });

  it('stops dragging once the pointer is released', () => {
    const editing = renderEditing();
    const long = screen.getByRole('button', { name: 'Long' });
    fireEvent.pointerDown(long, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(long, { pointerId: 7 });

    fireEvent.pointerMove(long, { pointerId: 7, clientX: 900, clientY: 10 });

    expect(editing.onMove).not.toHaveBeenCalled();
  });

  it('moves by a constant screen step via the arrow keys, shrunk by the zoom', () => {
    // At scale 2 the 8px step is 8 / (2 · 800) = 0.005 normalized on x.
    const editing = renderEditing(undefined, 2);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Long' }), { key: 'ArrowRight' });

    expect(editing.onMove).toHaveBeenCalledTimes(1);
    const [id, position] = (editing.onMove as ReturnType<typeof vi.fn>).mock.calls[0] as [
      number,
      { x: number; y: number },
    ];
    expect(id).toBe(0);
    expect(position.x).toBeCloseTo(0.255);
    expect(position.y).toBeCloseTo(0.5);
  });

  it('requests a rename via Enter and deletes via Delete', () => {
    const editing = renderEditing();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Long' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pit' }), { key: 'Delete' });

    expect(editing.onRename).toHaveBeenCalledWith(0);
    expect(editing.onDelete).toHaveBeenCalledWith(1);
  });

  it('locks the labels while a save is in flight', () => {
    renderEditing({ disabled: true });

    expect(screen.getByRole('button', { name: 'Long' })).toBeDisabled();
  });
});
