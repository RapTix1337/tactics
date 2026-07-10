import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { MapProfileDetails } from '../../../shared/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { MapView } from './MapView';

const profileDetails: MapProfileDetails = {
  id: 'profile-1',
  mapId: 'de_dust2',
  name: 'Mine',
  imageUrl: 'tactics-map://de_dust2/profile-1.png',
  callouts: [
    { name: 'Long', x: 0.69, y: 0.715 },
    { name: 'Pit', x: 0.2, y: 0.8 },
  ],
};

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the map view never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nativeResolve) => {
    resolve = nativeResolve;
  });
  return { promise, resolve };
}

/** jsdom has no layout — give the canvas a fixed 800×600 viewport. */
function mockCanvasViewport(canvas: HTMLElement): void {
  canvas.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: (): unknown => ({}),
  });
}

/** jsdom has no layout — stub the image's offset box before firing `load`. */
function stubImageLayout(image: HTMLElement): void {
  Object.defineProperties(image, {
    offsetLeft: { value: 16, configurable: true },
    offsetTop: { value: 24, configurable: true },
    offsetWidth: { value: 800, configurable: true },
    offsetHeight: { value: 600, configurable: true },
  });
}

beforeEach(() => {
  useMapCatalogStore.setState({ list: undefined, profilesById: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('MapView', () => {
  it('shows the loading state while the profile fetch is pending', () => {
    const pending = deferred<CommandResult<MapProfileDetails>>();
    installBridge(vi.fn().mockReturnValue(pending.promise));

    render(<MapView mapId="de_dust2" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading map…');
  });

  it('renders the default profile image from the protocol URL (MAP-07)', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: profileDetails });
    installBridge(invoke);

    render(<MapView mapId="de_dust2" />);

    const image = await screen.findByTestId('map-view-image');
    expect(image).toHaveAttribute('src', 'tactics-map://de_dust2/profile-1.png');
    expect(image).toHaveAccessibleName('Map image (profile "Mine")');
    expect(invoke).toHaveBeenCalledWith('maps.getProfile', {
      mapId: 'de_dust2',
      profileId: undefined,
    });
  });

  it('renders the named command error when the fetch fails', async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Map "de_dust2" has no profiles yet.' },
      }),
    );

    render(<MapView mapId="de_dust2" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Map "de_dust2" has no profiles yet.',
    );
    expect(screen.queryByTestId('map-view-image')).not.toBeInTheDocument();
  });

  it('shows the missing-image state when the image file fails to load', async () => {
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: profileDetails }));

    render(<MapView mapId="de_dust2" />);

    fireEvent.error(await screen.findByTestId('map-view-image'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The map image could not be loaded — the image file is missing or unreadable.',
    );
    expect(screen.queryByTestId('map-view-image')).not.toBeInTheDocument();
  });

  it('refetches and renders the other profile when the mapId changes', async () => {
    const nukeProfile: MapProfileDetails = {
      ...profileDetails,
      id: 'profile-2',
      mapId: 'de_nuke',
      name: 'Nuke default',
      imageUrl: 'tactics-map://de_nuke/profile-2.png',
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: profileDetails })
      .mockResolvedValueOnce({ ok: true, data: nukeProfile });
    installBridge(invoke);

    const { rerender } = render(<MapView mapId="de_dust2" />);
    await screen.findByTestId('map-view-image');

    rerender(<MapView mapId="de_nuke" />);

    const image = await screen.findByTestId('map-view-image');
    expect(image).toHaveAttribute('src', 'tactics-map://de_nuke/profile-2.png');
    expect(invoke).toHaveBeenLastCalledWith('maps.getProfile', {
      mapId: 'de_nuke',
      profileId: undefined,
    });
  });

  it('fetches the named profile and refetches when the profileId changes (E22.5)', async () => {
    const secondProfile: MapProfileDetails = {
      ...profileDetails,
      id: 'profile-2',
      name: 'Second',
      imageUrl: 'tactics-map://de_dust2/profile-2.png',
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: profileDetails })
      .mockResolvedValueOnce({ ok: true, data: secondProfile });
    installBridge(invoke);

    const { rerender } = render(<MapView mapId="de_dust2" profileId="profile-1" />);
    await screen.findByAltText('Map image (profile "Mine")');
    expect(invoke).toHaveBeenCalledWith('maps.getProfile', {
      mapId: 'de_dust2',
      profileId: 'profile-1',
    });

    rerender(<MapView mapId="de_dust2" profileId="profile-2" />);

    const image = await screen.findByAltText('Map image (profile "Second")');
    expect(image).toHaveAttribute('src', 'tactics-map://de_dust2/profile-2.png');
    expect(invoke).toHaveBeenLastCalledWith('maps.getProfile', {
      mapId: 'de_dust2',
      profileId: 'profile-2',
    });
  });

  it('ignores a stale response that resolves after the mapId changed', async () => {
    const dust2Fetch = deferred<CommandResult<MapProfileDetails>>();
    const nukeProfile: MapProfileDetails = {
      ...profileDetails,
      id: 'profile-2',
      mapId: 'de_nuke',
      name: 'Nuke default',
      imageUrl: 'tactics-map://de_nuke/profile-2.png',
    };
    const invoke = vi
      .fn()
      .mockReturnValueOnce(dust2Fetch.promise)
      .mockResolvedValueOnce({ ok: true, data: nukeProfile });
    installBridge(invoke);

    const { rerender } = render(<MapView mapId="de_dust2" />);
    rerender(<MapView mapId="de_nuke" />);
    const image = await screen.findByTestId('map-view-image');

    // The dust2 fetch resolves only now — it must not clobber the nuke view.
    dust2Fetch.resolve({ ok: true, data: profileDetails });
    await Promise.resolve();

    expect(image).toHaveAttribute('src', 'tactics-map://de_nuke/profile-2.png');
  });

  describe('zoom and pan (E14.2)', () => {
    async function renderCanvas(): Promise<HTMLElement> {
      installBridge(vi.fn().mockResolvedValue({ ok: true, data: profileDetails }));
      render(<MapView mapId="de_dust2" />);
      await screen.findByTestId('map-view-image');
      const canvas = screen.getByRole('application');
      mockCanvasViewport(canvas);
      return canvas;
    }

    function getTransform(): { x: number; y: number; scale: number } {
      const style = screen.getByTestId('map-view-transform').style.transform;
      // The number pattern includes scientific notation — float residue near
      // zero (e.g. -1.7e-13) serializes with an exponent.
      const number = String.raw`(-?[\d.]+(?:e[+-]?\d+)?)`;
      const match = new RegExp(
        `^translate\\(${number}px, ${number}px\\) scale\\(${number}\\)$`,
      ).exec(style);
      if (match === null) {
        throw new Error(`unexpected transform style: "${style}"`);
      }
      return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
    }

    it('zooms towards the cursor on wheel and clamps at the maximum scale', async () => {
      const canvas = await renderCanvas();

      fireEvent.wheel(canvas, { deltaY: -400, clientX: 200, clientY: 150 });

      const zoomed = getTransform();
      expect(zoomed.scale).toBeGreaterThan(1);
      // Cursor-centered: the content point under (200, 150) stays put.
      expect(zoomed.x + zoomed.scale * 200).toBeCloseTo(200);
      expect(zoomed.y + zoomed.scale * 150).toBeCloseTo(150);

      fireEvent.wheel(canvas, { deltaY: -10_000, clientX: 200, clientY: 150 });
      expect(getTransform().scale).toBe(8);
    });

    it('keeps the identity transform when wheel-zooming out at the fit scale', async () => {
      const canvas = await renderCanvas();

      fireEvent.wheel(canvas, { deltaY: 400, clientX: 200, clientY: 150 });

      expect(getTransform()).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it('zooms, pans, and resets via the keyboard', async () => {
      const canvas = await renderCanvas();

      fireEvent.keyDown(canvas, { key: '+' });
      const zoomed = getTransform();
      expect(zoomed.scale).toBeCloseTo(1.2);
      // Viewport-centered zoom: (400, 300) stays put.
      expect(zoomed.x + zoomed.scale * 400).toBeCloseTo(400);
      expect(zoomed.y + zoomed.scale * 300).toBeCloseTo(300);

      fireEvent.keyDown(canvas, { key: 'ArrowRight' });
      fireEvent.keyDown(canvas, { key: 'ArrowDown' });
      const panned = getTransform();
      expect(panned.x).toBeCloseTo(zoomed.x - 48);
      expect(panned.y).toBeCloseTo(zoomed.y - 48);

      fireEvent.keyDown(canvas, { key: '-' });
      expect(getTransform().scale).toBeCloseTo(1);

      fireEvent.keyDown(canvas, { key: '+' });
      fireEvent.keyDown(canvas, { key: '0' });
      expect(getTransform()).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it('pans by dragging when zoomed in and clamps at the content bounds', async () => {
      const canvas = await renderCanvas();
      fireEvent.wheel(canvas, { deltaY: -10_000, clientX: 400, clientY: 300 });
      const before = getTransform();

      fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 350, clientY: 260 });
      const dragged = getTransform();
      expect(dragged.x).toBeCloseTo(before.x - 50);
      expect(dragged.y).toBeCloseTo(before.y - 40);

      // Dragging far past the edge clamps to the bound; after release the
      // pointer no longer pans.
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10_000, clientY: 260 });
      expect(getTransform().x).toBe(0);
      fireEvent.pointerUp(canvas, { pointerId: 1 });
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 350, clientY: 260 });
      expect(getTransform().x).toBe(0);
    });

    it('does not pan at the fit scale', async () => {
      const canvas = await renderCanvas();

      fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 200 });

      expect(getTransform()).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it('resets the view when switching maps', async () => {
      const nukeProfile: MapProfileDetails = {
        ...profileDetails,
        id: 'profile-2',
        mapId: 'de_nuke',
        name: 'Nuke default',
        imageUrl: 'tactics-map://de_nuke/profile-2.png',
      };
      const invoke = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: profileDetails })
        .mockResolvedValueOnce({ ok: true, data: nukeProfile });
      installBridge(invoke);
      const { rerender } = render(<MapView mapId="de_dust2" />);
      await screen.findByTestId('map-view-image');
      const canvas = screen.getByRole('application');
      mockCanvasViewport(canvas);
      fireEvent.keyDown(canvas, { key: '+' });
      expect(getTransform().scale).toBeCloseTo(1.2);

      rerender(<MapView mapId="de_nuke" />);
      await screen.findByAltText('Map image (profile "Nuke default")');

      expect(getTransform()).toEqual({ x: 0, y: 0, scale: 1 });
    });
  });

  describe('callout layer (E14.4)', () => {
    async function renderMeasuredView(): Promise<HTMLElement> {
      installBridge(vi.fn().mockResolvedValue({ ok: true, data: profileDetails }));
      render(<MapView mapId="de_dust2" />);
      const image = await screen.findByTestId('map-view-image');
      stubImageLayout(image);
      fireEvent.load(image);
      return screen.getByRole('application');
    }

    it('renders the profile callouts over the measured image', async () => {
      await renderMeasuredView();

      expect(screen.getByRole('list', { name: 'Callouts' })).toHaveStyle({
        left: '16px',
        top: '24px',
        width: '800px',
        height: '600px',
      });
      expect(screen.getByText('Long')).toHaveStyle({ left: '69%', top: '71.5%' });
      expect(screen.getByText('Pit')).toHaveStyle({ left: '20%', top: '80%' });
    });

    it('counter-scales the labels when zooming in', async () => {
      const canvas = await renderMeasuredView();

      fireEvent.keyDown(canvas, { key: '+' });

      expect(screen.getByText('Long').style.transform).toBe(
        `translate(-50%, -50%) scale(${1 / 1.2})`,
      );
    });
  });

  describe('callout editor (E22.6)', () => {
    /** `maps.getProfile` answers the fixture; `maps.updateCallouts` echoes
     * the request's set back (the E22.3 contract) unless a result is forced. */
    function installEditorBridge(
      updateResult?: CommandResult<MapProfileDetails>,
    ): ReturnType<typeof vi.fn> {
      const invoke = vi.fn().mockImplementation((channel: unknown, request: unknown) => {
        if (channel === 'maps.getProfile') {
          return Promise.resolve({ ok: true, data: profileDetails });
        }
        if (updateResult !== undefined) {
          return Promise.resolve(updateResult);
        }
        const { callouts } = request as Pick<MapProfileDetails, 'callouts'>;
        return Promise.resolve({ ok: true, data: { ...profileDetails, callouts } });
      });
      installBridge(invoke);
      return invoke;
    }

    async function renderEditableView(): Promise<HTMLElement> {
      render(<MapView mapId="de_dust2" editable />);
      const image = await screen.findByTestId('map-view-image');
      stubImageLayout(image);
      fireEvent.load(image);
      const canvas = screen.getByRole('application');
      mockCanvasViewport(canvas);
      return canvas;
    }

    function startEditing(): void {
      fireEvent.click(screen.getByRole('button', { name: 'Edit callouts' }));
    }

    function clickCanvas(canvas: HTMLElement, clientX: number, clientY: number): void {
      fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX, clientY });
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX, clientY });
    }

    interface UpdatePayload {
      readonly mapId: string;
      readonly profileId: string;
      readonly callouts: readonly { name: string; x: number; y: number }[];
    }

    function lastUpdatePayload(invoke: ReturnType<typeof vi.fn>): UpdatePayload {
      const calls = invoke.mock.calls.filter((call) => call[0] === 'maps.updateCallouts');
      const last = calls.at(-1);
      if (last === undefined) {
        throw new Error('maps.updateCallouts was never invoked');
      }
      return last[1] as UpdatePayload;
    }

    it('offers no editor without the editable prop', async () => {
      installEditorBridge();
      render(<MapView mapId="de_dust2" />);
      const image = await screen.findByTestId('map-view-image');
      stubImageLayout(image);
      fireEvent.load(image);

      expect(screen.queryByRole('button', { name: 'Edit callouts' })).not.toBeInTheDocument();
    });

    it('enables editing only once the image is measured', async () => {
      installEditorBridge();
      render(<MapView mapId="de_dust2" editable />);
      const image = await screen.findByTestId('map-view-image');

      expect(screen.getByRole('button', { name: 'Edit callouts' })).toBeDisabled();

      stubImageLayout(image);
      fireEvent.load(image);

      expect(screen.getByRole('button', { name: 'Edit callouts' })).toBeEnabled();
    });

    it('adds a callout at the clicked position and saves the set (round-trip)', async () => {
      const invoke = installEditorBridge();
      const canvas = await renderEditableView();
      startEditing();

      clickCanvas(canvas, 416, 324); // the image center

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Callout name'), {
        target: { value: 'Mid Box' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add callout' }));

      expect(screen.getByRole('button', { name: 'Mid Box' }).parentElement).toHaveStyle({
        left: '50%',
        top: '50%',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      // Success exits the editor; the mirrored response renders view-only.
      expect(await screen.findByRole('button', { name: 'Edit callouts' })).toBeInTheDocument();
      expect(screen.getByText('Mid Box')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mid Box' })).not.toBeInTheDocument();
      const payload = lastUpdatePayload(invoke);
      expect(payload.mapId).toBe('de_dust2');
      expect(payload.profileId).toBe('profile-1');
      expect(payload.callouts).toEqual([
        ...profileDetails.callouts,
        { name: 'Mid Box', x: 0.5, y: 0.5 },
      ]);
    });

    it('inverts the click through the zoom/pan transform into the payload', async () => {
      const invoke = installEditorBridge();
      const canvas = await renderEditableView();
      startEditing();
      // Keyboard zoom: scale 1.2, translation (-80, -60) on the 800×600 canvas.
      fireEvent.keyDown(canvas, { key: '+' });

      clickCanvas(canvas, 400, 300);
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Callout name'), {
        target: { value: 'Zoomed' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add callout' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Edit callouts' });

      // Inverted: layout ((400+80)/1.2, (300+60)/1.2) = (400, 300) →
      // normalized ((400−16)/800, (300−24)/600) = (0.48, 0.46).
      const added = lastUpdatePayload(invoke).callouts.at(-1);
      expect(added?.name).toBe('Zoomed');
      expect(added?.x).toBeCloseTo(0.48);
      expect(added?.y).toBeCloseTo(0.46);
    });

    it('drags a callout to a new position and saves the moved coordinates', async () => {
      const invoke = installEditorBridge();
      await renderEditableView();
      startEditing();
      const long = screen.getByRole('button', { name: 'Long' });

      fireEvent.pointerDown(long, { pointerId: 7, button: 0, clientX: 568, clientY: 453 });
      fireEvent.pointerMove(long, { pointerId: 7, clientX: 216, clientY: 174 });
      fireEvent.pointerUp(long, { pointerId: 7 });

      // (216, 174) → normalized ((216−16)/800, (174−24)/600) = (0.25, 0.25).
      expect(long.parentElement).toHaveStyle({ left: '25%', top: '25%' });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Edit callouts' });

      expect(lastUpdatePayload(invoke).callouts[0]).toEqual({ name: 'Long', x: 0.25, y: 0.25 });
    });

    it('keeps the canvas still while dragging a label under zoom', async () => {
      installEditorBridge();
      const canvas = await renderEditableView();
      startEditing();
      fireEvent.keyDown(canvas, { key: '+' });
      const transformBefore = screen.getByTestId('map-view-transform').style.transform;
      const long = screen.getByRole('button', { name: 'Long' });

      fireEvent.pointerDown(long, { pointerId: 7, button: 0, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(long, { pointerId: 7, clientX: 400, clientY: 300 });
      fireEvent.pointerUp(long, { pointerId: 7 });

      expect(screen.getByTestId('map-view-transform').style.transform).toBe(transformBefore);
    });

    it('moves the focused callout with the arrow keys instead of panning', async () => {
      installEditorBridge();
      await renderEditableView();
      startEditing();
      const long = screen.getByRole('button', { name: 'Long' });
      const transformBefore = screen.getByTestId('map-view-transform').style.transform;

      // 8px on the 800px-wide image at scale 1 = 0.01 normalized.
      fireEvent.keyDown(long, { key: 'ArrowRight' });

      const li = long.parentElement as HTMLElement;
      expect(Number.parseFloat(li.style.left)).toBeCloseTo(70);
      expect(screen.getByTestId('map-view-transform').style.transform).toBe(transformBefore);
    });

    it('renames via the keyboard and blocks duplicate names', async () => {
      installEditorBridge();
      await renderEditableView();
      startEditing();

      fireEvent.keyDown(screen.getByRole('button', { name: 'Pit' }), { key: 'Enter' });
      const dialog = await screen.findByRole('dialog');
      const input = within(dialog).getByLabelText('Callout name');
      expect(input).toHaveValue('Pit');

      fireEvent.change(input, { target: { value: 'Long' } });
      expect(within(dialog).getByRole('alert')).toHaveTextContent('already exists');
      expect(within(dialog).getByRole('button', { name: 'Rename callout' })).toBeDisabled();

      fireEvent.change(input, { target: { value: 'Pit Upper' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename callout' }));

      expect(screen.getByRole('button', { name: 'Pit Upper' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Pit' })).not.toBeInTheDocument();
    });

    it('deletes a callout and saves the shrunken set', async () => {
      const invoke = installEditorBridge();
      await renderEditableView();
      startEditing();

      fireEvent.keyDown(screen.getByRole('button', { name: 'Pit' }), { key: 'Delete' });
      expect(screen.queryByRole('button', { name: 'Pit' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('button', { name: 'Edit callouts' });

      expect(lastUpdatePayload(invoke).callouts).toEqual([{ name: 'Long', x: 0.69, y: 0.715 }]);
    });

    it('cancel discards the draft and restores the saved callouts', async () => {
      const invoke = installEditorBridge();
      await renderEditableView();
      startEditing();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Pit' }), { key: 'Delete' });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('Pit')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith('maps.updateCallouts', expect.anything());
    });

    it('keeps the draft and shows the error when the save fails', async () => {
      installEditorBridge({
        ok: false,
        error: { code: 'DB_ERROR', message: 'The app data could not be written.' },
      });
      await renderEditableView();
      startEditing();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Pit' }), { key: 'Delete' });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The app data could not be written.',
      );
      // Still editing, the pending deletion preserved.
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Pit' })).not.toBeInTheDocument();
    });

    it('ignores clicks on the canvas padding outside the image', async () => {
      installEditorBridge();
      const canvas = await renderEditableView();
      startEditing();

      clickCanvas(canvas, 8, 12); // left of / above the image box at (16, 24)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not add a callout after a pan drag', async () => {
      installEditorBridge();
      const canvas = await renderEditableView();
      startEditing();
      fireEvent.keyDown(canvas, { key: '+' });

      fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 340, clientY: 260 });
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 340, clientY: 260 });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('falls back to a named error when the loaded profile leaves the cache', async () => {
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: profileDetails }));

    render(<MapView mapId="de_dust2" />);
    await screen.findByTestId('map-view-image');

    useMapCatalogStore.setState({ profilesById: {} });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This map profile is no longer available.',
    );
  });
});
