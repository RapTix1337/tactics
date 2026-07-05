import { describe, expect, it } from 'vitest';

import { appGetSnapshot, appReportRendererError, logsExport, logsOpenDirectory } from './commands';

describe('appGetSnapshot', () => {
  it('lives on the contract channel', () => {
    expect(appGetSnapshot.channel).toBe('cmd:app.getSnapshot');
  });

  it('takes no request and returns the (still empty) snapshot object', () => {
    expect(appGetSnapshot.requestSchema.safeParse(undefined).success).toBe(true);
    expect(appGetSnapshot.responseSchema.safeParse({}).success).toBe(true);
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
