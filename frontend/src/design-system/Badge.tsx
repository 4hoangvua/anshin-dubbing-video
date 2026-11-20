import React, { type ReactNode } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  color?: string; // Tùy chỉnh màu hex cho speaker
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  color,
  style,
}) => {
  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    default: { backgroundColor: 'var(--bg-surface-2)', color: 'var(--text-secondary)' },
    success: { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--accent-success)', border: '1px solid rgba(34, 197, 94, 0.3)' },
    warning: { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-warning)', border: '1px solid rgba(245, 158, 11, 0.3)' },
    danger: { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' },
    info: { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-primary)', border: '1px solid rgba(59, 130, 246, 0.3)' },
  };

  const customStyle: React.CSSProperties = color
    ? {
        backgroundColor: `${color}20`,
        color,
        border: `1px solid ${color}40`,
      }
    : variantStyles[variant];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 600,
        userSelect: 'none',
        lineHeight: 1.4,
        ...customStyle,
        ...style,
      }}
    >
      {children}
    </span>
  );
};
