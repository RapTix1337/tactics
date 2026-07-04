import { describe, expect, it } from 'vitest';

// Harness proof for the jsdom test environment (E1.4). main.ts renders on
// import, so the #root container must exist before the dynamic import.
describe('ui/main (jsdom environment)', () => {
  it('renders the walking-skeleton heading into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');

    const heading = document.querySelector('#root h1');
    expect(heading?.textContent).toContain('TactiCS');
  });
});
