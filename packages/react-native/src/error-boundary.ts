import { Component, type ErrorInfo, type ReactNode } from 'react';

/** What the app reports to the CLI when a story throws while rendering. */
export interface StoryErrorReport {
  readonly storyId: string;
  readonly message: string;
  readonly stack: string | null;
  readonly componentStack: string | null;
}

export interface TargusErrorBoundaryProps {
  readonly storyId: string;
  readonly report: (error: StoryErrorReport) => void;
  readonly children?: ReactNode;
}

interface TargusErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Per-story error boundary. Storybook RN's own boundary only logs, so the channel says
 * `storyRendered` for a story that shows an error box (docs/spike-m0.md). This one reports the
 * error once and renders nothing, so the CLI records an error instead of a snapshot.
 */
export class TargusErrorBoundary extends Component<
  TargusErrorBoundaryProps,
  TargusErrorBoundaryState
> {
  override state: TargusErrorBoundaryState = { failed: false };
  private reported = false;

  static getDerivedStateFromError(): TargusErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (this.reported) return;
    this.reported = true;
    this.props.report({
      storyId: this.props.storyId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null,
      componentStack: info.componentStack ?? null,
    });
  }

  override render(): ReactNode {
    return this.state.failed ? null : (this.props.children ?? null);
  }
}
