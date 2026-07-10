# TactiCS custom NSIS steps (E19.2, ADR-048 — uninstall hygiene, resolves
# open question #5). Keep this minimal: everything testable lives in the
# app (it records the GSI config location at gsi.applySetup time); the
# uninstaller only consumes that record.

!include "FileFunc.nsh"

# Key, value, and file name must match
# src/modules/gsi/adapters/windows/config-location-registry.ts and the
# gsi module's GSI_CONFIG_FILE_NAME.
!define TACTICS_REGISTRY_KEY "Software\io.github.raptix1337.tactics"
!define TACTICS_GSI_VALUE "GsiConfigPath"
!define TACTICS_GSI_CFG_NAME "gamestate_integration_tactics.cfg"

!macro customUnInstall
  # During an auto-update the old uninstaller runs with --updated: the GSI
  # config must survive and the recorded location stays for a later real
  # uninstall (ADR-048).
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "${TACTICS_REGISTRY_KEY}" "${TACTICS_GSI_VALUE}"
    ${if} $0 != ""
      # Defense in depth: only delete the file the app owns by name — a
      # tampered registry value must not turn this into arbitrary deletion.
      ${GetFileName} $0 $1
      ${if} $1 == "${TACTICS_GSI_CFG_NAME}"
        # Silently no-ops when CS2 or the file is already gone — the
        # uninstaller must never fail on a missing cfg (E19.2 acceptance).
        Delete "$0"
      ${endIf}
    ${endIf}
    DeleteRegKey HKCU "${TACTICS_REGISTRY_KEY}"
  ${endIf}
!macroend
