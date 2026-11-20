import { forwardRef, type InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ label, value, min = 0, max = 100, step = 1, unit = '', onChange, style, ...props }, ref) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
        {(label || unit) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            {label && <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>}
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {value}
              {unit}
            </span>
          </div>
        )}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            width: '100%',
            height: '5px',
            backgroundColor: 'var(--border-strong)',
            borderRadius: '4px',
            outline: 'none',
            cursor: 'pointer',
            accentColor: 'var(--accent-primary)',
            ...style,
          }}
          {...props}
        />
      </div>
    );
  }
);

Slider.displayName = 'Slider';
