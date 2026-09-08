'use client';

import { Component, type ReactNode } from 'react';
import ErrorFallback from './errors/ErrorFallback';
import { addBreadcrumb } from '@/services/breadcrumbService';

type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    addBreadcrumb('react_error', {
      message: error?.message,
      componentStack: errorInfo?.componentStack?.slice(0, 500),
    });
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}
