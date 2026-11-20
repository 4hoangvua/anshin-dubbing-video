import React, { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary captured crash:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '24px',
            backgroundColor: '#161922',
            color: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #ef4444',
            margin: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#ef4444', fontSize: '20px' }}>⚠️</span>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              {this.props.fallbackTitle || 'Đã xảy ra sự cố trong khu vực giao diện này'}
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
            {this.state.error?.message || 'Lỗi hiển thị không xác định.'}
          </p>
          {this.state.error?.stack && (
            <details style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
              <summary style={{ cursor: 'pointer', outline: 'none' }}>Chi tiết ngăn xếp lỗi (Stack trace)</summary>
              <pre
                style={{
                  marginTop: '6px',
                  padding: '8px',
                  backgroundColor: '#0d0f15',
                  borderRadius: '4px',
                  overflowX: 'auto',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div>
            <button
              onClick={this.handleReset}
              style={{
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Thử tải lại khu vực này
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
