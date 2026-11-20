import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Sliders } from 'lucide-react';
import { useCueStore } from '../../stores/cueStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { usePlayerStore } from '../../stores/playerStore';
import { CueRow } from './CueRow';
import { CueSearchFilter } from './CueSearchFilter';
import { PropertiesInspector } from './PropertiesInspector';

const EMPTY_CUES: any[] = [];

export const VirtualCueTable: React.FC = () => {
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : EMPTY_CUES;
  const selectedCueId = useCueStore((s) => s.selectedCueId);
  const setSelectedCueId = useCueStore((s) => s.setSelectedCueId);
  const searchQuery = useCueStore((s) => s.searchQuery);
  const updateText = useCueStore((s) => s.updateText);
  const updateSpeaker = useCueStore((s) => s.updateSpeaker);
  const splitCue = useCueStore((s) => s.splitCue);
  const deleteCue = useCueStore((s) => s.deleteCue);
  const undo = useCueStore((s) => s.undo);
  const redo = useCueStore((s) => s.redo);

  const activeRightTab = useTimelineStore((s) => s.activeRightTab);
  const setActiveRightTab = useTimelineStore((s) => s.setActiveRightTab);

  const parentRef = useRef<HTMLDivElement | null>(null);

  // Keyboard shortcut Ctrl+Z & Ctrl+Y for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Filter cues by search query
  const filteredCues = useMemo(() => {
    return (cues || []).filter((cue) => {
      if (!cue) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const inOrig = cue.originalText ? cue.originalText.toLowerCase().includes(query) : false;
        const inTrans = cue.translatedText ? cue.translatedText.toLowerCase().includes(query) : false;
        return inOrig || inTrans;
      }
      return true;
    });
  }, [cues, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredCues.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 70,
    overscan: 6,
  });

  const handleSelect = useCallback(
    (id: number) => {
      setSelectedCueId(id);
      useTimelineStore.getState().setSelectedElement({ type: 'cue', id });
      const target = cues.find((c) => c.id === id);
      if (target && Number.isFinite(target.startTime)) {
        usePlayerStore.getState().seekTo(target.startTime);
      }
    },
    [cues, setSelectedCueId]
  );

  const handleSplit = useCallback(
    (id: number) => {
      const target = cues.find((c) => c.id === id);
      if (target) {
        const midTime = +(target.startTime + target.duration! / 2).toFixed(3);
        splitCue(id, midTime);
      }
    },
    [cues, splitCue]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-surface-0)',
        overflow: 'hidden',
      }}
    >
      {/* Top Segmented Tab Switcher: Cues Table vs Properties Inspector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--bg-surface-1)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '4px 10px',
          gap: '6px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveRightTab('cues')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            border: activeRightTab === 'cues' ? '1px solid var(--color-primary)' : '1px solid transparent',
            backgroundColor: activeRightTab === 'cues' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeRightTab === 'cues' ? 'var(--color-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <FileText size={13} />
          <span>Danh sách câu thoại ({cues.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveRightTab('properties')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            border: activeRightTab === 'properties' ? '1px solid var(--color-primary)' : '1px solid transparent',
            backgroundColor: activeRightTab === 'properties' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: activeRightTab === 'properties' ? 'var(--color-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <Sliders size={13} />
          <span>Thuộc tính {selectedCueId ? `(#${selectedCueId})` : ''}</span>
        </button>
      </div>

      {activeRightTab === 'properties' ? (
        <PropertiesInspector />
      ) : (
        <>
          {/* Search & Action bar */}
          <CueSearchFilter />

          {/* Table Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 12px',
              backgroundColor: 'var(--bg-surface-1)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              gap: '10px',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            <span style={{ width: '32px', textAlign: 'center' }}>#</span>
            <span style={{ width: '76px' }}>Thời gian</span>
            <span style={{ width: '88px' }}>Nhân vật</span>
            <span style={{ flex: 1 }}>Lời thoại gốc & Bản dịch</span>
            <span style={{ width: '44px', textAlign: 'center' }}>Thao tác</span>
          </div>

          {/* Virtual List Container */}
          <div
            ref={parentRef}
            onPointerDown={(e) => {
              if (e.target === parentRef.current) {
                setSelectedCueId(null);
                useTimelineStore.getState().setSelectedElement(null);
              }
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              position: 'relative',
            }}
          >
            {filteredCues.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                  padding: '24px',
                  textAlign: 'center',
                }}
              >
                <FileText size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <span>Chưa có câu thoại nào phù hợp.</span>
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const cue = filteredCues[virtualRow.index];
                  if (!cue) return null;
                  return (
                    <div
                      key={cue.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <CueRow
                        cue={cue}
                        isSelected={cue.id === selectedCueId}
                        onSelect={handleSelect}
                        onUpdateText={updateText}
                        onUpdateSpeaker={updateSpeaker}
                        onSplit={handleSplit}
                        onDelete={deleteCue}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
