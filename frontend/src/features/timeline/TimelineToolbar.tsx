import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  Magnet,
  Scissors,
  Combine,
  Maximize2,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
} from 'lucide-react';
import { useTimelineStore } from '../../stores/timelineStore';
import { useCueStore } from '../../stores/cueStore';
import { usePlayerStore } from '../../stores/playerStore';
import { Button } from '../../design-system/Button';

interface TimelineToolbarProps {
  videoDuration: number;
}

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({ videoDuration }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const setZoom = useTimelineStore((s) => s.setZoom);
  const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
  const setSnappingEnabled = useTimelineStore((s) => s.setSnappingEnabled);

  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];
  const selectedCueId = useCueStore((s) => s.selectedCueId);
  const rawSelectedCueIds = useCueStore((s) => s.selectedCueIds);
  const selectedCueIds = Array.isArray(rawSelectedCueIds) ? rawSelectedCueIds : [];
  const splitCue = useCueStore((s) => s.splitCue);
  const mergeCues = useCueStore((s) => s.mergeCues);
  const updateCue = useCueStore((s) => s.updateCue);
  const deleteCue = useCueStore((s) => s.deleteCue);
  const deleteMultipleCues = useCueStore((s) => s.deleteMultipleCues);

  const handleZoomChange = (delta: number) => {
    if (delta < 0) {
      if (zoom <= 10) {
        setZoom(Math.max(1, zoom - 2));
      } else if (zoom <= 30) {
        setZoom(zoom - 5);
      } else {
        setZoom(zoom - 15);
      }
    } else {
      if (zoom < 10) {
        setZoom(zoom + 2);
      } else if (zoom < 30) {
        setZoom(zoom + 5);
      } else {
        setZoom(zoom + 15);
      }
    }
  };

  const handleFitTimeline = () => {
    if (videoDuration <= 0) return;
    const viewportWidth = useTimelineStore.getState().viewportWidth;
    const fitZoom = Math.max(1, Math.min(500, (viewportWidth - 40) / videoDuration));
    setZoom(fitZoom);
    useTimelineStore.getState().setScrollLeft(0);
  };

  const handleSplitAtPlayhead = () => {
    if (selectedCueId === null) return;
    const currentTime = usePlayerStore.getState().currentTime;
    splitCue(selectedCueId, currentTime);
  };

  const handleTrimLeft = () => {
    if (selectedCueId === null) return;
    const playhead = usePlayerStore.getState().currentTime;
    const target = cues.find((c) => c.id === selectedCueId);
    if (target && playhead > target.startTime && playhead < target.endTime) {
      updateCue(selectedCueId, { startTime: +playhead.toFixed(3) });
    }
  };

  const handleTrimRight = () => {
    if (selectedCueId === null) return;
    const playhead = usePlayerStore.getState().currentTime;
    const target = cues.find((c) => c.id === selectedCueId);
    if (target && playhead > target.startTime && playhead < target.endTime) {
      updateCue(selectedCueId, { endTime: +playhead.toFixed(3) });
    }
  };

  const handleDeleteSelected = () => {
    if (selectedCueIds && selectedCueIds.length > 0) {
      deleteMultipleCues(selectedCueIds);
    } else if (selectedCueId !== null) {
      deleteCue(selectedCueId);
    }
  };

  const handleMergeWithNext = () => {
    if (selectedCueId === null) return;
    const allCues = [...cues].sort((a, b) => a.startTime - b.startTime);
    const idx = allCues.findIndex((c) => c.id === selectedCueId);
    if (idx !== -1) {
      if (idx < allCues.length - 1) {
        mergeCues(selectedCueId, allCues[idx + 1].id);
      } else if (idx > 0) {
        mergeCues(allCues[idx - 1].id, selectedCueId);
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        backgroundColor: 'var(--bg-surface-0)',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Left: Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Scissors size={12} />}
          disabled={selectedCueId === null}
          onClick={handleSplitAtPlayhead}
          title="Tách câu tại con trỏ Playhead (S)"
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          Cắt câu
        </Button>

        <Button
          size="sm"
          variant="secondary"
          leftIcon={<ArrowLeftToLine size={12} />}
          disabled={selectedCueId === null}
          onClick={handleTrimLeft}
          title="Xén đầu câu từ mốc bắt đầu tới Playhead (Q)"
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          Xén trái
        </Button>

        <Button
          size="sm"
          variant="secondary"
          leftIcon={<ArrowRightToLine size={12} />}
          disabled={selectedCueId === null}
          onClick={handleTrimRight}
          title="Xén đuôi câu từ Playhead tới mốc kết thúc (W)"
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          Xén phải
        </Button>

        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Combine size={12} />}
          disabled={selectedCueId === null}
          onClick={handleMergeWithNext}
          title="Ghép câu được chọn với câu kế tiếp (M)"
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          Ghép câu
        </Button>

        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Trash2 size={12} style={{ color: (selectedCueIds && selectedCueIds.length > 0) || selectedCueId ? '#ef4444' : undefined }} />}
          disabled={(selectedCueIds?.length ?? 0) === 0 && selectedCueId === null}
          onClick={handleDeleteSelected}
          title={
            selectedCueIds && selectedCueIds.length > 1
              ? `Xóa ${selectedCueIds.length} câu thoại đã chọn (Delete)`
              : 'Xóa câu được chọn (Delete)'
          }
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          {selectedCueIds && selectedCueIds.length > 1 ? `Xóa (${selectedCueIds.length})` : 'Xóa'}
        </Button>

        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px' }} />

        <Button
          size="sm"
          variant={snappingEnabled ? 'primary' : 'ghost'}
          leftIcon={<Magnet size={12} />}
          onClick={() => setSnappingEnabled(!snappingEnabled)}
          title={snappingEnabled ? 'Đang bật tự hít điểm mép câu (Snap)' : 'Đang tắt hít điểm'}
          style={{ height: '26px', fontSize: '11px', padding: '0 8px' }}
        >
          Hít điểm
        </Button>
      </div>

      {/* Right: Zoom Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={() => handleZoomChange(-15)}
          title="Thu nhỏ timeline"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            padding: '2px',
          }}
        >
          <ZoomOut size={14} />
        </button>

        <input
          type="range"
          min={1}
          max={400}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          style={{
            width: '80px',
            height: '4px',
            accentColor: 'var(--accent-primary)',
            cursor: 'pointer',
          }}
        />

        <button
          onClick={() => handleZoomChange(15)}
          title="Phóng to timeline"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            padding: '2px',
          }}
        >
          <ZoomIn size={14} />
        </button>

        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Maximize2 size={12} />}
          onClick={handleFitTimeline}
          title="Thu phóng vừa khít toàn bộ video"
          style={{ height: '24px', fontSize: '11px', padding: '0 6px' }}
        >
          Vừa màn hình
        </Button>
      </div>
    </div>
  );
};
