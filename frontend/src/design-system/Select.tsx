import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options = [], error, children, style, id, ...props }, ref) => {
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
        {label && (
          <label
            htmlFor={selectId}
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {label}
          </label>
        )}
        <div style={{ position: 'relative', width: '100%' }}>
          <select
            id={selectId}
            ref={ref}
            style={{
              width: '100%',
              height: '34px',
              backgroundColor: 'var(--bg-surface-1)',
              border: `1px solid ${error ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
              borderRadius: '6px',
              padding: '0 32px 0 10px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              appearance: 'none',
              cursor: 'pointer',
              ...style,
            }}
            {...props}
          >
            {options.length > 0
              ? options.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                    style={{ backgroundColor: 'var(--bg-surface-0)', color: 'var(--text-primary)' }}
                  >
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <span
            style={{
              position: 'absolute',
              right: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              color: 'var(--text-muted)',
              display: 'flex',
            }}
          >
            <ChevronDown size={14} />
          </span>
        </div>
        {error && (
          <span style={{ fontSize: '11px', color: 'var(--accent-danger)' }}>{error}</span>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
