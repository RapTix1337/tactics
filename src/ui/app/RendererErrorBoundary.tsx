import type { JSX, ReactNode } from 'react';
import { Component } from 'react';

import type { ErrorReporter } from '@/lib/errors/error-reporting';

import { RouteErrorFallback } from './RouteErrorFallback';

interface RendererErrorBoundaryProps {
  readonly report: ErrorReporter;
  readonly children: ReactNode;
}

interface RendererErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * The router-less counterpart of the route error boundaries (live-overlay
 * 02-design.md §6 case 8): the overlay window has one view and no router, so
 * this class boundary catches its render errors and renders the same
 * `RouteErrorFallback` — which also escalates via the shared reporter.
 * Without it a crash would leave an invisible, always-on-top window with no
 * close control. Error boundaries must be class components (React has no
 * hook equivalent).
 */
export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  // No componentDidCatch: reporting happens in RouteErrorFallback's effect —
  // one shared path with the router boundaries, deduplicated by the
  // reporter's WeakSet.

  render(): JSX.Element | ReactNode {
    if (this.state.error !== undefined) {
      return <RouteErrorFallback error={this.state.error} report={this.props.report} />;
    }
    return this.props.children;
  }
}
