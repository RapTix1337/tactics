import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ScoreboardLayout } from '../../../shared/settings';
import type { DraftLayout } from './scoreboard-builder-model';
import { toDraft, toLayout } from './scoreboard-builder-model';
import { ScoreboardBuilder } from './ScoreboardBuilder';

const sampleLayout: ScoreboardLayout = {
  groups: [
    { label: 'Match totals', fields: ['kills', 'deaths', 'assists'] },
    { label: 'Derived', fields: ['hsRate'] },
    { label: 'Live round state', fields: ['health', 'money'] },
  ],
};

/** Stateful wrapper: the builder is controlled, interactions need re-renders. */
function Harness({
  initial,
  onDraftChange,
}: {
  readonly initial: ScoreboardLayout;
  readonly onDraftChange?: (next: DraftLayout) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() => toDraft(initial));
  return (
    <ScoreboardBuilder
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        onDraftChange?.(next);
      }}
    />
  );
}

function group(label: string): HTMLElement {
  return screen.getByRole('group', { name: label });
}

/** Minimal DOMRect stand-in for the virtual keyboard-drag layout. */
function makeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: (): unknown => ({}),
  };
}

describe('ScoreboardBuilder', () => {
  it('renders the groups with their field chips in configured order', () => {
    render(<Harness initial={sampleLayout} />);

    const groups = screen.getAllByRole('group');
    expect(groups.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Match totals',
      'Derived',
      'Live round state',
    ]);
    const chips = within(group('Match totals')).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Kills', 'Deaths', 'Assists']);
  });

  it('shows the field and group count', () => {
    render(<Harness initial={sampleLayout} />);

    expect(screen.getByText('6 fields · 3 groups')).toBeInTheDocument();
  });

  it('lists exactly the unused fields as available, per catalog category', () => {
    render(<Harness initial={sampleLayout} />);

    const available = screen.getByRole('region', { name: 'Available fields' });
    const addButtons = within(available).getAllByRole('button', { name: /^Add / });
    expect(addButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Add MVPs to the scoreboard',
      'Add Score to the scoreboard',
      'Add K/D to the scoreboard',
      'Add K−D to the scoreboard',
      'Add Armor to the scoreboard',
      'Add Equip to the scoreboard',
      'Add Round kills to the scoreboard',
      'Add Round HS kills to the scoreboard',
    ]);
  });

  it('marks a fully used category with "All in use"', () => {
    render(<Harness initial={sampleLayout} />);

    // hsRate — the only Derived field — is in the layout.
    expect(screen.getByText('All in use')).toBeInTheDocument();
  });

  it('click-add moves a field into the category-matching group', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<Harness initial={sampleLayout} onDraftChange={onDraftChange} />);

    await user.click(screen.getByRole('button', { name: 'Add MVPs to the scoreboard' }));

    const chips = within(group('Match totals')).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Kills', 'Deaths', 'Assists', 'MVPs']);
    expect(
      screen.queryByRole('button', { name: 'Add MVPs to the scoreboard' }),
    ).not.toBeInTheDocument();
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('removes a field via its remove button and releases it to available', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<Harness initial={sampleLayout} onDraftChange={onDraftChange} />);

    await user.click(within(group('Match totals')).getByRole('button', { name: 'Remove Kills' }));

    const chips = within(group('Match totals')).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Deaths', 'Assists']);
    expect(screen.getByRole('button', { name: 'Add Kills to the scoreboard' })).toBeInTheDocument();
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('blocks removing the last field and shows the min-1 hint', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <Harness
        initial={{ groups: [{ label: 'Only', fields: ['kills'] }] }}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Kills' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Keep at least one field in the scoreboard.',
    );
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(within(group('Only')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('clears the min-1 hint on the next successful edit', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ groups: [{ label: 'Only', fields: ['kills'] }] }} />);

    await user.click(screen.getByRole('button', { name: 'Remove Kills' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Deaths to the scoreboard' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds an empty group and focuses its name input', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<Harness initial={sampleLayout} onDraftChange={onDraftChange} />);

    await user.click(screen.getByRole('button', { name: 'Add group' }));

    const created = group('New group');
    expect(created).toBeInTheDocument();
    expect(within(created).getByRole('textbox', { name: 'Group name' })).toHaveFocus();
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('renames a group on blur', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<Harness initial={sampleLayout} onDraftChange={onDraftChange} />);

    const input = within(group('Derived')).getByRole('textbox', { name: 'Group name' });
    await user.clear(input);
    await user.type(input, 'Economy');
    await user.tab();

    expect(screen.getByRole('group', { name: 'Economy' })).toBeInTheDocument();
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const next = onDraftChange.mock.calls.at(-1)?.[0] as DraftLayout;
    expect(toLayout(next).groups.map((entry) => entry.label)).toEqual([
      'Match totals',
      'Economy',
      'Live round state',
    ]);
  });

  it('commits a rename with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness initial={sampleLayout} />);

    const input = within(group('Derived')).getByRole('textbox', { name: 'Group name' });
    await user.clear(input);
    await user.type(input, 'Economy{Enter}');

    expect(screen.getByRole('group', { name: 'Economy' })).toBeInTheDocument();
  });

  it('removes a group and releases its fields to available', async () => {
    const user = userEvent.setup();
    render(<Harness initial={sampleLayout} />);

    await user.click(screen.getByRole('button', { name: 'Remove group Derived' }));

    expect(screen.queryByRole('group', { name: 'Derived' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add HS Rate to the scoreboard' }),
    ).toBeInTheDocument();
  });

  it('blocks removing the group that holds the only fields', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <Harness
        initial={{
          groups: [
            { label: 'Only fields', fields: ['kills'] },
            { label: 'Empty', fields: [] },
          ],
        }}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove group Only fields' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Keep at least one field in the scoreboard.',
    );
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Only fields' })).toBeInTheDocument();
  });

  it('exposes the dnd keyboard affordances on chips and group handles (UI-06)', () => {
    render(<Harness initial={sampleLayout} />);

    const chipHandle = screen.getByRole('button', { name: 'Reorder Kills' });
    expect(chipHandle).toHaveAttribute('aria-roledescription', 'sortable');
    expect(chipHandle).toHaveAttribute('aria-describedby');

    const groupHandle = screen.getByRole('button', { name: 'Reorder group Match totals' });
    expect(groupHandle).toHaveAttribute('aria-roledescription', 'sortable');
  });

  it('reorders a field via the dnd-kit keyboard path (lift, arrow, drop)', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<Harness initial={sampleLayout} onDraftChange={onDraftChange} />);

    // jsdom has no layout — lay the Match totals chips on a virtual row so
    // sortableKeyboardCoordinates can resolve the ArrowRight target.
    const chips = within(group('Match totals')).getAllByRole('listitem');
    chips.forEach((chip, index) => {
      chip.getBoundingClientRect = () => makeRect(index * 100, 0, 90, 30);
    });

    const handle = screen.getByRole('button', { name: 'Reorder Kills' });
    handle.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(handle).toHaveAttribute('aria-pressed', 'true');
    });
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const reordered = within(group('Match totals')).getAllByRole('listitem');
      expect(reordered.map((chip) => chip.textContent)).toEqual(['Deaths', 'Kills', 'Assists']);
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-group drop hint', async () => {
    const user = userEvent.setup();
    render(<Harness initial={sampleLayout} />);

    await user.click(screen.getByRole('button', { name: 'Add group' }));

    expect(within(group('New group')).getByText('Drag fields here')).toBeInTheDocument();
  });
});
