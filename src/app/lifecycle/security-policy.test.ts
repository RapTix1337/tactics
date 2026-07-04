import { describe, expect, it } from 'vitest';

import {
  DEV_CONTENT_SECURITY_POLICY,
  PROD_CONTENT_SECURITY_POLICY,
  shouldAllowNavigation,
} from './security-policy';

const DEV_ORIGIN = 'http://localhost:5173';

describe('content security policies (ADR-025)', () => {
  it('locks production down to bundled same-origin resources', () => {
    expect(PROD_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(PROD_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(PROD_CONTENT_SECURITY_POLICY).toContain("style-src 'self'");
    expect(PROD_CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(PROD_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
  });

  it('keeps every dev relaxation out of the production policy', () => {
    expect(PROD_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|ws:|wss:|http:/);
  });

  it('denies by default in dev too, relaxing only what Vite HMR needs', () => {
    expect(DEV_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(DEV_CONTENT_SECURITY_POLICY).toContain('ws://localhost:*');
    expect(DEV_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
  });
});

describe('shouldAllowNavigation (ADR-025: navigation blocked)', () => {
  it('denies every navigation in production (no dev server origin)', () => {
    expect(shouldAllowNavigation('https://example.com/', undefined)).toBe(false);
    expect(shouldAllowNavigation('file:///etc/passwd', undefined)).toBe(false);
    expect(shouldAllowNavigation(DEV_ORIGIN, undefined)).toBe(false);
  });

  it('allows only same-origin dev-server navigation in dev mode', () => {
    expect(shouldAllowNavigation(`${DEV_ORIGIN}/`, DEV_ORIGIN)).toBe(true);
    expect(shouldAllowNavigation(`${DEV_ORIGIN}/some/route`, DEV_ORIGIN)).toBe(true);
    expect(shouldAllowNavigation('https://example.com/', DEV_ORIGIN)).toBe(false);
    expect(shouldAllowNavigation('http://localhost:9999/', DEV_ORIGIN)).toBe(false);
    expect(shouldAllowNavigation('file:///etc/passwd', DEV_ORIGIN)).toBe(false);
  });

  it('denies unparseable URLs instead of throwing', () => {
    expect(shouldAllowNavigation('not a url', DEV_ORIGIN)).toBe(false);
  });
});
