import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      className = '',
      style,
      ...props
    },
    ref
  ) => {
    const baseStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      borderRadius: '6px',
      fontWeight: 500,
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
      transition: 'all 0.15s ease-in-out',
      border: '1px solid transparent',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      fontFamily: 'inherit',
    };

    const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
      sm: { height: '28px', padding: '0 10px', fontSize: '12px' },
      md: { height: '34px', padding: '0 14px', fontSize: '13px' },
      lg: { height: '40px', padding: '0 18px', fontSize: '14px' },
      icon: { width: '34px', height: '34px', padding: 0, fontSize: '14px' },
    };

    const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
      primary: {
        backgroundColor: 'var(--accent-primary)',
        color: '#ffffff',
        borderColor: 'var(--accent-primary)',
      },
      secondary: {
        backgroundColor: 'var(--bg-surface-2)',
        color: 'var(--text-primary)',
        borderColor: 'var(--border-subtle)',
      },
      outline: {
        backgroundColor: 'transparent',
        color: 'var(--text-primary)',
        borderColor: 'var(--border-strong)',
      },
      ghost: {
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
        borderColor: 'transparent',
      },
      danger: {
        backgroundColor: 'var(--accent-danger)',
        color: '#ffffff',
        borderColor: 'var(--accent-danger)',
      },
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        style={{
          ...baseStyle,
          ...sizeStyles[size],
          ...variantStyles[variant],
          ...style,
        }}
        className={className}
        {...props}
      >
        {isLoading && <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
