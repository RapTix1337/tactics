import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

// RTL smoke test (E3.2 acceptance criterion).
describe('App', () => {
  it('renders the placeholder behind the stable E2E root selector', () => {
    render(<App />);

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TactiCS');
  });
});
