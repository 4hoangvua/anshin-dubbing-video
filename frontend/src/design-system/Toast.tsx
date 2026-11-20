import React from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useUIStore } from '../stores/uiStore';

export const ToastContainer: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '380px',
        width: '100%',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const iconMap = {
          success: <CheckCircle2 size={16} color="var(--accent-success)" />,
          error: <AlertCircle size={16} color="var(--accent-danger)" />,
          warning: <AlertTriangle size={16} color="var(--accent-warning)" />,
          info: <Info size={16} color="var(--accent-primary)" />,
        };

        const borderMap = {
          success: 'rgba(34, 197, 94, 0.4)',
          error: 'rgba(239, 68, 68, 0.4)',
          warning: 'rgba(245, 158, 11, 0.4)',
          info: 'rgba(59, 130, 246, 0.4)',
        };

        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: 'auto',
              backgroundColor: 'var(--bg-surface-0)',
              border: `1px solid ${borderMap[toast.type]}`,
              borderRadius: '8px',
              padding: '10px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <span style={{ marginTop: '2px', display: 'flex' }}>{iconMap[toast.type]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {toast.title}
              </div>
              {toast.description && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
                  {toast.description}
                </div>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
