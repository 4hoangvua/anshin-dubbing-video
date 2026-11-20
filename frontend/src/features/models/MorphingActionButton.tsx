import React from 'react';
import { Download, Play, Loader2 } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { Button } from '../../design-system/Button';

interface MorphingActionButtonProps {
  modelId: string;
  runLabel: string;
  isRunning?: boolean;
  disabled?: boolean;
  onRun: () => void;
  style?: React.CSSProperties;
}

/**
 * Nút hành động thông minh (Smart Morphing Action Button)
 * Tự động chuyển đổi giữa [Chạy tác vụ] và [⬇️ Tải mô hình này]
 * dựa trên trạng thái đã nạp của Model.
 */
export const MorphingActionButton: React.FC<MorphingActionButtonProps> = ({
  modelId,
  runLabel,
  isRunning = false,
  disabled = false,
  onRun,
  style,
}) => {
  const isDownloaded = useModelStore((s) => s.isDownloaded(modelId));
  const isDownloading = useModelStore((s) => s.isDownloading(modelId));
  const downloadProgress = useModelStore((s) => s.downloads[modelId]);
  const downloadModel = useModelStore((s) => s.downloadModel);

  // Nếu đang tải model này
  if (isDownloading) {
    const percent = downloadProgress?.percent ?? 0;
    return (
      <Button
        variant="primary"
        disabled
        leftIcon={<Loader2 size={15} className="animate-spin" />}
        style={{ ...style, position: 'relative', overflow: 'hidden' }}
      >
        <span>Đang tải mô hình... ({percent.toFixed(0)}%)</span>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '3px',
            width: `${percent}%`,
            backgroundColor: 'rgba(255, 255, 255, 0.6)',
            transition: 'width 0.2s ease',
          }}
        />
      </Button>
    );
  }

  // Nếu model chưa tải
  if (!isDownloaded) {
    return (
      <Button
        variant="outline"
        leftIcon={<Download size={15} />}
        onClick={() => downloadModel(modelId)}
        style={{
          borderColor: 'var(--accent-warning)',
          color: 'var(--accent-warning)',
          ...style,
        }}
      >
        Tải mô hình này ({modelId})
      </Button>
    );
  }

  // Model đã sẵn sàng -> Nút chạy bình thường
  return (
    <Button
      variant="primary"
      isLoading={isRunning}
      disabled={disabled || isRunning}
      leftIcon={!isRunning ? <Play size={15} fill="currentColor" /> : undefined}
      onClick={onRun}
      style={style}
    >
      {runLabel}
    </Button>
  );
};
