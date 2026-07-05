import { describe, expect, it } from 'vitest';

import {
  appGetSnapshot,
  appReportRendererError,
  logsExport,
  logsOpenDirectory,
  settingsUpdate,
} from './commands';
import type { Settings } from './settings';

const validSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
};

describe('appGetSnapshot', () => {
  it('lives on the contract channel', () => {
    expect(appGetSnapshot.channel).toBe('cmd:app.getSnapshot');
  });

  it('takes no request and returns the snapshot with its settings slice', () => {
    expect(appGetSnapshot.requestSchema.safeParse(undefined).success).toBe(true);
    expect(appGetSnapshot.responseSchema.safeParse({ settings: validSettings }).success).toBe(true);
    // The slice is mandatory — an empty snapshot was the pre-E8.3 skeleton.
    expect(appGetSnapshot.responseSchema.safeParse({}).success).toBe(false);
  });
});

describe('settingsUpdate', () => {
  it('lives on the contract channel', () => {
    expect(settingsUpdate.channel).toBe('cmd:settings.update');
  });

  it('accepts any partial of the six settings, including the empty one', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({}).success).toBe(true);
    expect(requestSchema.safeParse({ theme: 'light' }).success).toBe(true);
    expect(requestSchema.safeParse({ theme: 'system', autostart: true }).success).toBe(true);
  });

  it('accepts explicit null to reset cs2Path/gsiPort to automatic', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({ cs2Path: null, gsiPort: null }).success).toBe(true);
  });

  it('rejects invalid field values at the boundary (named INVALID_REQUEST path)', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({ theme: 'blurple' }).success).toBe(false);
    expect(requestSchema.safeParse({ gsiPort: 65536 }).success).toBe(false);
    expect(requestSchema.safeParse({ cs2Path: '' }).success).toBe(false);
    expect(requestSchema.safeParse({ autostart: 'yes' }).success).toBe(false);
  });

  it('responds with the full new settings state', () => {
    expect(settingsUpdate.responseSchema.safeParse(validSettings).success).toBe(true);
    expect(settingsUpdate.responseSchema.safeParse({ theme: 'dark' }).success).toBe(false);
  });
});

describe('appReportRendererError', () => {
  it('lives on the contract channel', () => {
    expect(appReportRendererError.channel).toBe('cmd:app.reportRendererError');
  });

  it('requires only the message; stack and route are optional', () => {
    const { requestSchema } = appReportRendererError;
    expect(requestSchema.safeParse({ message: 'boom' }).success).toBe(true);
    expect(
      requestSchema.safeParse({ message: 'boom', stack: 'at x', route: '/live' }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({}).success).toBe(false);
  });

  it('caps the field lengths as the boundary guard above the renderer truncation', () => {
    const { requestSchema } = appReportRendererError;
    expect(requestSchema.safeParse({ message: 'm'.repeat(2_001) }).success).toBe(false);
    expect(requestSchema.safeParse({ message: 'boom', stack: 's'.repeat(16_001) }).success).toBe(
      false,
    );
    expect(requestSchema.safeParse({ message: 'boom', route: 'r'.repeat(501) }).success).toBe(
      false,
    );
  });
});

describe('logsOpenDirectory', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(logsOpenDirectory.channel).toBe('cmd:logs.openDirectory');
    expect(logsOpenDirectory.requestSchema.safeParse(undefined).success).toBe(true);
    expect(logsOpenDirectory.responseSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('logsExport', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(logsExport.channel).toBe('cmd:logs.export');
    expect(logsExport.requestSchema.safeParse(undefined).success).toBe(true);
  });

  it('responds with saved (incl. file path) or canceled — nothing else', () => {
    const { responseSchema } = logsExport;
    expect(
      responseSchema.safeParse({ status: 'saved', filePath: 'C:\\Downloads\\logs.log' }).success,
    ).toBe(true);
    expect(responseSchema.safeParse({ status: 'canceled' }).success).toBe(true);
    expect(responseSchema.safeParse({ status: 'saved' }).success).toBe(false);
    expect(responseSchema.safeParse({ status: 'failed' }).success).toBe(false);
  });
});
