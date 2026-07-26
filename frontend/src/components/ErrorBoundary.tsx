import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: (err: Error) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return (
        <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
          <div className="card max-w-lg p-8 text-center">
            <div className="text-5xl mb-2">😬</div>
            <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600 mt-2">{this.state.error.message}</p>
            <button
              className="btn-primary mt-4"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
