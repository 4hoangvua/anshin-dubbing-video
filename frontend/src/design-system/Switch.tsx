import React from 'react';

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const Switch: React.FC<SwitchProps> = ({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
}) => {
  const isSm = size === 'sm';
  const trackW = isSm ? 32 : 38;
  const trackH = isSm ? 18 : 22;
  const thumbSize = isSm ? 14 : 18;
  const thumbTranslate = isSm ? 14 : 16;

  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: description ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: '10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {(label || description) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
          {label && (
            <span style={{ fontSize: isSm ? '11px' : '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {label}
            </span>
          )}
          {description && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
              {description}
            </span>
          )}
        </div>
      )}

      <div
        id={id}
        role="switch"
        aria-checked={checked}
        tabIndex={disabled ? -1 : 0}
        onClick={(e) => {
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        style={{
          width: `${trackW}px`,
          height: `${trackH}px`,
          borderRadius: `${trackH}px`,
          backgroundColor: checked ? 'var(--color-primary, #3b82f6)' : 'rgba(148, 163, 184, 0.25)',
          position: 'relative',
          transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
          border: checked ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid rgba(148, 163, 184, 0.3)',
          boxShadow: checked ? '0 0 8px rgba(59, 130, 246, 0.35)' : 'none',
        }}
      >
        <div
          style={{
            width: `${thumbSize}px`,
            height: `${thumbSize}px`,
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            position: 'absolute',
            top: '1px',
            left: '1px',
            transform: checked ? `translateX(${thumbTranslate}px)` : 'translateX(0)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
          }}
        />
      </div>
    </label>
  );
};
