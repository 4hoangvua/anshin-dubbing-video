import React, { useState, useEffect, type ReactNode } from 'react';
import { StudioHeader } from './StudioHeader';
import { StepNavigator } from './StepNavigator';
import { StatusBar } from './StatusBar';
import { ToastContainer } from '../../design-system/Toast';
import { ErrorBoundary } from '../../core/ErrorBoundary';
import { useUIStore } from '../../stores/uiStore';
import { ModelHubModal } from '../../components/ModelHubModal';

interface StudioLayoutProps {
  leftContent?: ReactNode; // Step Module Parameters & Action controls
  centerContent: ReactNode; // Video Player & Canvas Timeline
  rightContent: ReactNode; // Virtual Cue Table & Properties Inspector
}

export const StudioLayout: React.FC<StudioLayoutProps> = ({
  leftContent,
  centerContent,
  rightContent,
}) => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [compactActiveTab, setCompactActiveTab] = useState<'step' | 'preview' | 'cues'>('preview');

  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDesktop = windowWidth >= 1180;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-app)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Top Header */}
      <StudioHeader />

      {/* Step Pipeline Bar */}
      <StepNavigator />

      {/* Main Studio Workspace */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* 1. Màn hình máy tính (>= 1180px): 3 Cột Studio Chuyên Nghiệp */}
        {isDesktop ? (
          <>
            {/* CỘT TRÁI: Thuộc tính & Tham số Module (Step 1-4) */}
            {leftContent && (
              <aside
                style={{
                  width: '320px',
                  minWidth: '290px',
                  flexShrink: 0,
                  borderRight: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-0)',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <ErrorBoundary fallbackTitle="Lỗi hiển thị tham số bước">
                  {leftContent}
                </ErrorBoundary>
              </aside>
            )}

            {/* CỘT GIỮA: Màn hình Video Preview & Multi-Track Canvas Timeline */}
            <main
              style={{
                flex: 1,
                minWidth: '420px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                backgroundColor: 'var(--bg-surface-0)',
                borderRight: '1px solid var(--border-subtle)',
              }}
            >
              <ErrorBoundary fallbackTitle="Lỗi hiển thị Video Player & Timeline">
                {centerContent}
              </ErrorBoundary>
            </main>

            {/* CỘT PHẢI: Bảng Câu Thoại Virtual & Bảng Thuộc Tính Inspector */}
            <aside
              style={{
                width: 'clamp(460px, 35vw, 620px)',
                minWidth: '440px',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'var(--bg-surface-0)',
                overflow: 'hidden',
              }}
            >
              <ErrorBoundary fallbackTitle="Lỗi hiển thị Bảng câu thoại & Thuộc tính">
                {rightContent}
              </ErrorBoundary>
            </aside>
          </>
        ) : (
          /* 2. Màn hình nhỏ (< 1180px): Chuyển Tab 3 chế độ mượt mà */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                backgroundColor: 'var(--bg-surface-1)',
                borderBottom: '1px solid var(--border-subtle)',
                padding: '4px 8px',
                gap: '6px',
              }}
            >
              {leftContent && (
                <button
                  onClick={() => setCompactActiveTab('step')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: compactActiveTab === 'step' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                    color: compactActiveTab === 'step' ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  ⚙️ Thuộc tính bước
                </button>
              )}
              <button
                onClick={() => setCompactActiveTab('preview')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: compactActiveTab === 'preview' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                  color: compactActiveTab === 'preview' ? '#fff' : 'var(--text-secondary)',
                }}
              >
                🎬 Video & Timeline
              </button>
              <button
                onClick={() => setCompactActiveTab('cues')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: compactActiveTab === 'cues' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                  color: compactActiveTab === 'cues' ? '#fff' : 'var(--text-secondary)',
                }}
              >
                📝 Danh sách câu thoại
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <ErrorBoundary fallbackTitle="Lỗi hiển thị khu vực làm việc">
                {compactActiveTab === 'step' && leftContent && (
                  <div style={{ flex: 1, overflowY: 'auto' }}>{leftContent}</div>
                )}
                {compactActiveTab === 'preview' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{centerContent}</div>
                )}
                {compactActiveTab === 'cues' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{rightContent}</div>
                )}
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Global Notifications Container */}
      <ToastContainer />

      {/* Model Hub Modal */}
      {activeModal === 'modelHub' && <ModelHubModal isOpen={true} onClose={closeModal} />}
    </div>
  );
};
