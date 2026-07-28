import {Component, type ErrorInfo, type ReactNode} from 'react';
import {isPreloadError, STALE_BUILD_MESSAGE} from './preloadError';

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
    // '#/' rather than '': clearing an ALREADY-empty hash fires no hashchange,
    // so useRoute never updates, the same screen re-renders, and the button
    // appears to do nothing. '#/' parses to landing either way.
    location.hash = '#/';
    this.setState({error: undefined});
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    // A stale lazy chunk after a redeploy is the one error with a real
    // explanation and a real fix, so say so instead of showing the raw
    // "Failed to fetch dynamically imported module" string.
    const stale = isPreloadError(this.state.error);
    return (
      <main className="screen">
        <div className="empty-state">
          <p>{stale ? STALE_BUILD_MESSAGE : 'Something went wrong on this screen.'}</p>
          {!stale && <p className="hint mono">{this.state.error.message}</p>}
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
