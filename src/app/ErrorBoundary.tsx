import {Component, type ErrorInfo, type ReactNode} from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error?: Error;
}

/**
 * Last-resort guard: an unexpected throw anywhere in a screen would otherwise
 * unmount the whole tree to a blank page. This catches it and offers a way out
 * (reload, or back to the start) instead of a dead white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in a screen:', error, info.componentStack);
  }

  private reset = () => {
    // Back to the landing route, then remount the tree fresh.
    location.hash = '';
    this.setState({error: undefined});
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen">
        <div className="empty-state">
          <p>Something went wrong on this screen.</p>
          <p className="hint mono">{this.state.error.message}</p>
          <div className="result-actions">
            <button className="primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button onClick={this.reset}>Back to start</button>
          </div>
        </div>
      </main>
    );
  }
}
