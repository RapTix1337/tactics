import type { LinkOptions } from '@tanstack/react-router';
import { Link, linkOptions, useRouter, useRouterState } from '@tanstack/react-router';
import { ImageOffIcon } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { useEffect } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { loadMapList } from '@/lib/ipc/map-catalog';
import { useGameStateStore } from '@/stores/game-state-store';
import { useMapCatalogStore } from '@/stores/map-catalog-store';

import { APP_NAME } from '../../../shared/constants';

interface NavEntryProps {
  readonly label: string;
  readonly link: LinkOptions;
  /**
   * Accessible-name override for state a trailing icon shows visually (the
   * label must stay its prefix, WCAG 2.5.3).
   */
  readonly ariaLabel?: string;
  /** Extra content after the label, inside the link (e.g. the no-image hint). */
  readonly trailing?: ReactNode;
}

function NavEntry({ label, link, ariaLabel, trailing }: NavEntryProps): JSX.Element {
  const router = useRouter();
  const targetPath = router.buildLocation(link).pathname;
  const isActive = useRouterState({ select: (state) => state.location.pathname }) === targetPath;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        {/* `exact`: the Link's own fuzzy matching would otherwise mark "All
            maps" (/maps) as current on every map page (/maps/$mapId). */}
        <Link
          {...link}
          activeOptions={{ exact: true }}
          aria-label={ariaLabel}
          aria-current={isActive ? 'page' : undefined}
        >
          {label}
          {trailing}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  /** Slot for the GSI status badge (E15.1) — always visible per GSI-05. */
  readonly gsiStatusSlot?: ReactNode;
  /** Slot for the update-ready indicator (E18.2) — injected, never imported
   * (03-technical-design.md §3.1). */
  readonly updateSlot?: ReactNode;
}

/**
 * The app sidebar (UI-01, 06-ui.md §1): "Live" first (with the live-activity
 * badge while a match is running, E15.4/ADR-046), the maps group — the
 * "All maps" overview entry (the way back to the app home, E22.4) plus the
 * map list from the catalog store, with a no-image hint on maps without an
 * upload — the update indicator and GSI badge slots, and the settings entry
 * last. Entries are
 * router links to the 06-ui.md §2 routes (E13.3). Fetches the map list on
 * mount — the catalog is command-fed (ADR-033), so this is the store's fill
 * trigger; a failed fetch simply leaves the map entries hidden and the next
 * mount retries.
 */
export function AppSidebar({ gsiStatusSlot, updateSlot }: AppSidebarProps): JSX.Element {
  const maps = useMapCatalogStore((state) => state.list);
  // The live-activity badge (E15.4, ADR-046): a match is running whenever
  // game state carries a map — resolved or unsupported alike.
  const matchActive = useGameStateStore(
    (state) => state.gameState !== undefined && state.gameState.map.kind !== 'none',
  );

  useEffect(() => {
    void loadMapList();
  }, []);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <span className="px-2 text-lg font-semibold">{APP_NAME}</span>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main" className="flex flex-col gap-2">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavEntry
                  label="Live"
                  link={linkOptions({ to: '/live' })}
                  ariaLabel={matchActive ? 'Live (match in progress)' : undefined}
                  trailing={
                    matchActive ? (
                      <span
                        aria-hidden="true"
                        className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500"
                      />
                    ) : undefined
                  }
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Maps</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavEntry label="All maps" link={linkOptions({ to: '/maps' })} />
                {maps?.map((map) => {
                  // The upload-state hint (E22.4): a map without an image is
                  // a map without profiles (E22.3 contract). The icon is
                  // decorative; the aria-label carries the state.
                  const hasImage = map.profiles.length > 0;
                  return (
                    <NavEntry
                      key={map.id}
                      label={map.displayName}
                      link={linkOptions({ to: '/maps/$mapId', params: { mapId: map.id } })}
                      ariaLabel={hasImage ? undefined : `${map.displayName} (no image)`}
                      trailing={
                        hasImage ? undefined : (
                          <ImageOffIcon
                            aria-hidden="true"
                            className="ml-auto size-4 text-muted-foreground"
                          />
                        )
                      }
                    />
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        {updateSlot}
        {gsiStatusSlot}
        <SidebarMenu>
          <NavEntry label="Settings" link={linkOptions({ to: '/settings' })} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
