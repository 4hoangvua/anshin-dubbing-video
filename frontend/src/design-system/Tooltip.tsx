import React, { useState, type ReactNode } from 'react';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  shortcut?: string;
  position?: 'top' | 'bottom';
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  shortcut,
  position = 'top',
}) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          style={{
            position: 'absolute',
            [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            backgroundColor: '#000000',
            color: '#f8fafc',
            border: '1px solid var(--border-strong)',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <span>{content}</span>
          {shortcut && (
            <kbd
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                padding: '1px 4px',
                borderRadius: '3px',
                fontSize: '10px',
                fontFamily: 'monospace',
              }}
            >
              {shortcut}
            </kbd>
          )}
        </div>
      )}
    </div>
  );
};
