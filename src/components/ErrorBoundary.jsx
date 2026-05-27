import { Component } from 'react';
import ErrorFallback from './errors/ErrorFallback.jsx';
import { addBreadcrumb } from '../services/breadcrumbService.js';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
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
      return (
        <ErrorFallback error={this.state.error} onReset={this.handleReset} />
      );
    }
    return this.props.children;
  }
}
