import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, rightIcon, error, label, style, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {label}
          </label>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-surface-1)',
            border: `1px solid ${error ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
            borderRadius: '6px',
            padding: '0 10px',
            height: '34px',
            gap: '8px',
            transition: 'border-color 0.15s ease',
          }}
        >
          {leftIcon && <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{leftIcon}</span>}
          <input
            id={inputId}
            ref={ref}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontFamily: 'inherit',
              width: '100%',
              ...style,
            }}
            className={className}
            {...props}
          />
          {rightIcon && <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{rightIcon}</span>}
        </div>
        {error && (
          <span style={{ fontSize: '11px', color: 'var(--accent-danger)', marginTop: '2px' }}>
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
