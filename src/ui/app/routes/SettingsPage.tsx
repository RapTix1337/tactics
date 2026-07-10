import type { JSX } from 'react';
import { useState } from 'react';

import { GsiSetupDialog } from '../../features/gsi-status/GsiSetupDialog';
import { Cs2PathSection } from '../../features/settings/Cs2PathSection';
import { GsiPortSection } from '../../features/settings/GsiPortSection';
import { SettingsForm } from '../../features/settings/SettingsForm';
import { UpdateSection } from '../../features/settings/UpdateSection';

/**
 * `/settings` (06-ui.md §2): the six settings of 01-requirements.md §9 —
 * theme, autostart, close-to-tray and auto-update (E16.1) plus the CS2 path
 * and advanced GSI port sections (E16.2) and the updates section (E18.2,
 * REL-02). The repair dialog belongs to the `gsi-status` feature, so the
 * page composes it (03-technical-design.md §3.1) — the open flag is the
 * only state here.
 */
export function SettingsPage(): JSX.Element {
  const [repairOpen, setRepairOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm />
      <Cs2PathSection
        onRepair={() => {
          setRepairOpen(true);
        }}
      />
      <GsiPortSection />
      <UpdateSection />
      <GsiSetupDialog open={repairOpen} onOpenChange={setRepairOpen} mode="repair" />
    </div>
  );
}
