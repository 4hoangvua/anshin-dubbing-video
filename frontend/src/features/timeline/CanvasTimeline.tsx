import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timelineStore';
import { useCueStore } from '../../stores/cueStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  MultiTrackCanvas,
  RULER_HEIGHT,
  CUE_TRACK_Y,
  CUE_TRACK_HEIGHT,
  VIDEO_TRACK_Y,
  VIDEO_TRACK_HEIGHT,
  AUDIO_TRACK_Y,
  AUDIO_TRACK_HEIGHT,
} from './MultiTrackCanvas';
import { PlayheadCanvas } from './PlayheadCanvas';
import { TimelineToolbar } from './TimelineToolbar';
import { TrackHeaderSidebar } from './TrackHeaderSidebar';
import { calculateMagneticSnap } from '../../utils/snapping';

const TIMELINE_HEIGHT = 172;
const EMPTY_CUES: any[] = [];
const EMPTY_SELECTED_IDS: number[] = [];

type DragMode = 'scrub' | 'resize-start' | 'resize-end' | 'move-cue' | 'box-select' | null;

export const CanvasTimeline: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const zoom = useTimelineStore((s) => s.zoom);
  const scrollLeft = useTimelineStore((s) => s.scrollLeft);
  const setZoom = useTimelineStore((s) => s.setZoom);
  const setScrollLeft = useTimelineStore((s) => s.setScrollLeft);
  const setViewportWidth = useTimelineStore((s) => s.setViewportWidth);

  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : EMPTY_CUES;
  const selectedCueId = useCueStore((s) => s.selectedCueId);
  const rawSelectedCueIds = useCueStore((s) => s.selectedCueIds);
  const selectedCueIds = Array.isArray(rawSelectedCueIds) ? rawSelectedCueIds : EMPTY_SELECTED_IDS;
  const setSelectedCueId = useCueStore((s) => s.setSelectedCueId);
  const setSelectedCueIds = useCueStore((s) => s.setSelectedCueIds);
  const updateCue = useCueStore((s) => s.updateCue);
  const splitCue = useCueStore((s) => s.splitCue);
  const mergeCues = useCueStore((s) => s.mergeCues);
  const deleteCue = useCueStore((s) => s.deleteCue);
  const deleteMultipleCues = useCueStore((s) => s.deleteMultipleCues);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const project = useProjectStore((s) => s.project);
  const videoDuration = project?.videoInfo?.duration || 0;

  const [containerWidth, setContainerWidth] = useState(1000);
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const dragModeRef = useRef<DragMode>(null);
  const dragCueIdRef = useRef<number | null>(null);
  const dragInitialTimeRef = useRef<number>(0);
  const startClientXRef = useRef<number>(0);
  const startClientYRef = useRef<number>(0);
  const dragInitialCueTimesRef = useRef<{ startTime: number; endTime: number }>({ startTime: 0, endTime: 0 });
  const animFrameRef = useRef<number | null>(null);

  // ResizeObserver để đo chính xác viewport width thực tế
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) {
          // Trừ đi 112px của cột TrackHeaderSidebar
          const viewportW = Math.max(100, w - 112);
          setContainerWidth(viewportW);
          setViewportWidth(viewportW);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewportWidth]);

  // Chiều dài cuộn thực tế theo thời lượng video và zoom
  const contentWidth = Math.max(containerWidth, Math.ceil(videoDuration * zoom) + 300);

  // Xử lý sự kiện cuộn ngang
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  // Tính toán thời gian (giây) từ tọa độ chuột X
  const getTimeFromClientX = useCallback(
    (clientX: number): number => {
      if (!scrollContainerRef.current) return 0;
      const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 80;
      const rect = scrollContainerRef.current.getBoundingClientRect();
      const viewportX = clientX - rect.left;
      const currentScroll = scrollContainerRef.current.scrollLeft;
      const val = (viewportX + currentScroll) / safeZoom;
      return Number.isFinite(val) ? Math.max(0, val) : 0;
    },
    [zoom]
  );

  // Tìm cue tại vị trí chuột (tìm trên cả Cue track và Audio track)
  const findCueAt = useCallback(
    (time: number, y: number) => {
      const inCueTrack = y >= CUE_TRACK_Y && y <= CUE_TRACK_Y + CUE_TRACK_HEIGHT;
      const inAudioTrack = y >= AUDIO_TRACK_Y && y <= AUDIO_TRACK_Y + AUDIO_TRACK_HEIGHT;
      if (!inCueTrack && !inAudioTrack) return null;
      return cues.find((c) => time >= c.startTime && time <= c.endTime) || null;
    },
    [cues]
  );

  // Cập nhật con trỏ chuột khi di chuyển qua các vùng tương tác
  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragModeRef.current) return; // Đang kéo thì giữ nguyên cursor
    if (!scrollContainerRef.current) return;

    const rect = scrollContainerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const time = getTimeFromClientX(e.clientX);

    // Vùng Ruler
    if (y <= RULER_HEIGHT) {
      setCursorStyle('ew-resize');
      return;
    }

    // Vùng Cue Track & Audio Track
    const inCueTrack = y >= CUE_TRACK_Y && y <= CUE_TRACK_Y + CUE_TRACK_HEIGHT;
    const inAudioTrack = y >= AUDIO_TRACK_Y && y <= AUDIO_TRACK_Y + AUDIO_TRACK_HEIGHT;
    const inVideoTrack = y >= VIDEO_TRACK_Y && y <= VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT;

    if (inVideoTrack) {
      setCursorStyle('pointer');
      return;
    }

    if (inCueTrack || inAudioTrack) {
      const cue = findCueAt(time, y);
      if (cue) {
        const handleThresholdSec = 8 / zoom;
        if (Math.abs(time - cue.startTime) <= handleThresholdSec || Math.abs(time - cue.endTime) <= handleThresholdSec) {
          setCursorStyle('ew-resize');
          return;
        }
        setCursorStyle('grab');
        return;
      }
    }

    setCursorStyle('default');
  };

  // Xử lý Bắt đầu Kéo (MouseDown)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Chỉ nhận chuột trái
    if (!scrollContainerRef.current) return;

    const rect = scrollContainerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickTime = getTimeFromClientX(e.clientX);

    // 1. Nhấp vào Ruler -> Tua nhanh (Scrubbing) & Bỏ chọn phần tử cũ
    if (y <= RULER_HEIGHT) {
      setSelectedCueId(null);
      useTimelineStore.getState().setSelectedElement(null);
      dragModeRef.current = 'scrub';
      if (Number.isFinite(clickTime)) seekTo(clickTime);
    }
    // 2. Nhấp vào Track 1: Subtitle Cue Track (Y: 24 -> 72)
    else if (y >= CUE_TRACK_Y && y <= CUE_TRACK_Y + CUE_TRACK_HEIGHT) {
      const hitCue = findCueAt(clickTime, y);
      if (hitCue) {
        setSelectedCueId(hitCue.id);
        useTimelineStore.getState().setSelectedElement({ type: 'cue', id: hitCue.id });
        useTimelineStore.getState().setActiveRightTab('properties');
        dragCueIdRef.current = hitCue.id;
        dragInitialTimeRef.current = clickTime;
        startClientXRef.current = e.clientX;
        dragInitialCueTimesRef.current = { startTime: hitCue.startTime, endTime: hitCue.endTime };

        // Tua ngay Playhead và Video đến mốc bắt đầu của câu thoại được chọn
        if (Number.isFinite(hitCue.startTime)) {
          seekTo(hitCue.startTime);
        }

        const handleThresholdSec = 8 / zoom;
        if (Math.abs(clickTime - hitCue.startTime) <= handleThresholdSec) {
          dragModeRef.current = 'resize-start';
        } else if (Math.abs(clickTime - hitCue.endTime) <= handleThresholdSec) {
          dragModeRef.current = 'resize-end';
        } else {
          // Chuẩn bị cho move-cue nếu kéo chuột vượt ngưỡng 5px
          dragModeRef.current = null;
        }
      } else {
        // Nhấp vào khoảng trống trong track -> Chuẩn bị kéo chọn vùng (Marquee Selection) hoặc tua playhead
        startClientXRef.current = e.clientX;
        startClientYRef.current = e.clientY;
        dragModeRef.current = 'box-select';
      }
    }
    // 3. Nhấp vào Track 2: Video Track (Y: 72 -> 124)
    else if (y >= VIDEO_TRACK_Y && y <= VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT) {
      const rawClips = useTimelineStore.getState().videoClips;
      let clips = Array.isArray(rawClips) ? rawClips : [];
      if (clips.length === 0 && videoDuration > 0) {
        const defaultClip = {
          id: 'video_clip_0',
          startTime: 0,
          duration: videoDuration,
          trimStart: 0,
          trimEnd: 0,
          volume: 1.0,
          muted: false,
        };
        useTimelineStore.getState().setVideoClips([defaultClip]);
        clips = [defaultClip];
      }

      const hitClip =
        clips.find((c) => clickTime >= c.startTime && clickTime <= c.startTime + c.duration) ||
        (clips.length > 0 && clickTime <= clips[0].startTime + clips[0].duration ? clips[0] : null);

      if (hitClip) {
        setSelectedCueId(null); // Bỏ chọn cue
        setSelectedCueIds([]);
        useTimelineStore.getState().setSelectedElement({ type: 'video', id: hitClip.id });
        useTimelineStore.getState().setActiveRightTab('properties'); // Mở bảng thuộc tính cho Video!
        dragModeRef.current = 'scrub';
        if (Number.isFinite(clickTime)) seekTo(clickTime);
      } else {
        startClientXRef.current = e.clientX;
        startClientYRef.current = e.clientY;
        dragModeRef.current = 'box-select';
      }
    }
    // 4. Nhấp vào Track 3: AI Narration Audio Track (Y: 124 -> 172)
    else if (y >= AUDIO_TRACK_Y && y <= AUDIO_TRACK_Y + AUDIO_TRACK_HEIGHT) {
      const hitCue = findCueAt(clickTime, y);
      if (hitCue) {
        setSelectedCueId(hitCue.id);
        setSelectedCueIds([hitCue.id]);
        useTimelineStore.getState().setSelectedElement({ type: 'audio', id: hitCue.id });
        useTimelineStore.getState().setActiveRightTab('properties'); // Mở bảng thuộc tính Audio!
        dragCueIdRef.current = hitCue.id;
        dragInitialTimeRef.current = clickTime;
        startClientXRef.current = e.clientX;
        startClientYRef.current = e.clientY;
        dragInitialCueTimesRef.current = { startTime: hitCue.startTime, endTime: hitCue.endTime };

        // Tua ngay Playhead và Video đến mốc bắt đầu của audio
        if (Number.isFinite(hitCue.startTime)) {
          seekTo(hitCue.startTime);
        }

        const handleThresholdSec = 8 / zoom;
        if (Math.abs(clickTime - hitCue.startTime) <= handleThresholdSec) {
          dragModeRef.current = 'resize-start';
        } else if (Math.abs(clickTime - hitCue.endTime) <= handleThresholdSec) {
          dragModeRef.current = 'resize-end';
        } else {
          dragModeRef.current = null;
        }
      } else {
        startClientXRef.current = e.clientX;
        startClientYRef.current = e.clientY;
        dragModeRef.current = 'box-select';
      }
    }
    // 4. Nhấp vào vùng khác -> Bỏ chọn & tua tới đó
    else {
      startClientXRef.current = e.clientX;
      startClientYRef.current = e.clientY;
      dragModeRef.current = 'box-select';
    }

    const onGlobalMouseMove = (moveEvent: MouseEvent) => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      animFrameRef.current = requestAnimationFrame(() => {
        const deltaX = moveEvent.clientX - startClientXRef.current;
        const rawTime = getTimeFromClientX(moveEvent.clientX);
        const snappingEnabled = useTimelineStore.getState().snappingEnabled;
        const playheadTime = usePlayerStore.getState().currentTime;

        // Kéo chọn nhiều phần tử trên timeline (Marquee / Drag Box Selection)
        if (dragModeRef.current === 'box-select') {
          const deltaX = moveEvent.clientX - startClientXRef.current;
          const deltaY = moveEvent.clientY - startClientYRef.current;
          if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
            const left = Math.min(startClientXRef.current, moveEvent.clientX);
            const right = Math.max(startClientXRef.current, moveEvent.clientX);
            const top = Math.min(startClientYRef.current, moveEvent.clientY);
            const bottom = Math.max(startClientYRef.current, moveEvent.clientY);
            setSelectionBox({ left, top, width: right - left, height: bottom - top });

            const tStart = getTimeFromClientX(left);
            const tEnd = getTimeFromClientX(right);
            const matched = cues
              .filter((c) => c.endTime >= tStart && c.startTime <= tEnd)
              .map((c) => c.id);
            setSelectedCueIds(matched);
            return;
          }
        }

        // Kéo dời cả khối câu thoại (Move Cue) khi kéo > 5px
        if (
          dragCueIdRef.current !== null &&
          dragModeRef.current !== 'resize-start' &&
          dragModeRef.current !== 'resize-end' &&
          dragModeRef.current !== 'scrub'
        ) {
          if (Math.abs(deltaX) > 5 || dragModeRef.current === 'move-cue') {
            dragModeRef.current = 'move-cue';
            setCursorStyle('grabbing');

            const deltaTime = deltaX / zoom;
            const initStart = dragInitialCueTimesRef.current.startTime;
            const initEnd = dragInitialCueTimesRef.current.endTime;
            const duration = Math.max(0.2, +(initEnd - initStart).toFixed(3));

            let newStart = Math.max(0, +(initStart + deltaTime).toFixed(3));
            let newEnd = +(newStart + duration).toFixed(3);

            if (snappingEnabled) {
              const targets = [0, playheadTime];
              for (const c of cues) {
                if (c.id !== dragCueIdRef.current) {
                  targets.push(c.startTime);
                  targets.push(c.endTime);
                }
              }

              const snapStart = calculateMagneticSnap(newStart, targets, zoom, 10);
              if (snapStart.isSnapped && snapStart.snapTargetTime !== null) {
                newStart = snapStart.snapTargetTime;
                newEnd = +(newStart + duration).toFixed(3);
              } else {
                const snapEnd = calculateMagneticSnap(newEnd, targets, zoom, 10);
                if (snapEnd.isSnapped && snapEnd.snapTargetTime !== null) {
                  newEnd = snapEnd.snapTargetTime;
                  newStart = Math.max(0, +(newEnd - duration).toFixed(3));
                }
              }
            }

            updateCue(dragCueIdRef.current, {
              startTime: newStart,
              endTime: newEnd,
              duration: duration,
            });
            return;
          }
        }

        // Kéo tua Playhead (Scrubbing)
        if (dragModeRef.current === 'scrub') {
          if (Number.isFinite(rawTime)) seekTo(rawTime);
        }
        // Co giãn đầu trái (Resize Start)
        else if (dragModeRef.current === 'resize-start' && dragCueIdRef.current !== null) {
          let targetTime = rawTime;
          if (snappingEnabled) {
            const targets = [0, playheadTime];
            for (const c of cues) {
              if (c.id !== dragCueIdRef.current) {
                targets.push(c.startTime);
                targets.push(c.endTime);
              }
            }
            const snap = calculateMagneticSnap(rawTime, targets, zoom, 10);
            if (snap.isSnapped && snap.snapTargetTime !== null) targetTime = snap.snapTargetTime;
          }
          const initEnd = dragInitialCueTimesRef.current.endTime;
          const newStart = Math.min(initEnd - 0.2, Math.max(0, +targetTime.toFixed(3)));
          updateCue(dragCueIdRef.current, { startTime: newStart, duration: +(initEnd - newStart).toFixed(3) });
        }
        // Co giãn đuôi phải (Resize End)
        else if (dragModeRef.current === 'resize-end' && dragCueIdRef.current !== null) {
          let targetTime = rawTime;
          if (snappingEnabled) {
            const targets = [0, playheadTime];
            for (const c of cues) {
              if (c.id !== dragCueIdRef.current) {
                targets.push(c.startTime);
                targets.push(c.endTime);
              }
            }
            const snap = calculateMagneticSnap(rawTime, targets, zoom, 10);
            if (snap.isSnapped && snap.snapTargetTime !== null) targetTime = snap.snapTargetTime;
          }
          const initStart = dragInitialCueTimesRef.current.startTime;
          const newEnd = Math.max(initStart + 0.2, +targetTime.toFixed(3));
          updateCue(dragCueIdRef.current, { endTime: newEnd, duration: +(newEnd - initStart).toFixed(3) });
        }
      });
    };

    const onGlobalMouseUp = (upEvent: MouseEvent) => {
      if (dragModeRef.current === 'box-select') {
        const deltaX = Math.abs(upEvent.clientX - startClientXRef.current);
        const deltaY = Math.abs(upEvent.clientY - startClientYRef.current);
        if (deltaX <= 4 && deltaY <= 4) {
          // Chỉ là nhấp chuột đơn thuần trên khoảng trống -> Bỏ chọn và tua tới đó
          setSelectedCueId(null);
          setSelectedCueIds([]);
          useTimelineStore.getState().setSelectedElement(null);
          const clickTime = getTimeFromClientX(upEvent.clientX);
          if (Number.isFinite(clickTime)) seekTo(clickTime);
        }
        setSelectionBox(null);
      }
      dragModeRef.current = null;
      dragCueIdRef.current = null;
      setCursorStyle('default');
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('mousemove', onGlobalMouseMove);
      window.removeEventListener('mouseup', onGlobalMouseUp);
    };

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  };

  // Phím tắt Timeline dựng phim CapCut:
  // S (Tách câu), Q (Xén trái), W (Xén phải), M (Ghép câu), N (Bật/tắt Snap), Delete (Xóa)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const selId = useCueStore.getState().selectedCueId;

      // S: Tách câu thoại & Video clip tại Playhead
      if (e.key === 's' || e.key === 'S') {
        const playhead = usePlayerStore.getState().currentTime;
        if (selId !== null) {
          splitCue(selId, playhead);
        }
        useTimelineStore.getState().splitVideoClip(playhead);
      }
      // Q: Xén đầu trái tới Playhead
      else if (e.key === 'q' || e.key === 'Q') {
        if (selId !== null) {
          const playhead = usePlayerStore.getState().currentTime;
          const currentCues = Array.isArray(useCueStore.getState().cues) ? useCueStore.getState().cues : [];
          const target = currentCues.find((c) => c.id === selId);
          if (target && playhead > target.startTime && playhead < target.endTime) {
            updateCue(selId, { startTime: +playhead.toFixed(3) });
          }
        }
      }
      // W: Xén đuôi phải từ Playhead
      else if (e.key === 'w' || e.key === 'W') {
        if (selId !== null) {
          const playhead = usePlayerStore.getState().currentTime;
          const currentCues = Array.isArray(useCueStore.getState().cues) ? useCueStore.getState().cues : [];
          const target = currentCues.find((c) => c.id === selId);
          if (target && playhead > target.startTime && playhead < target.endTime) {
            updateCue(selId, { endTime: +playhead.toFixed(3) });
          }
        }
      }
      // M: Ghép câu liền kề
      else if (e.key === 'm' || e.key === 'M') {
        if (selId !== null) {
          const rawCues = useCueStore.getState().cues;
          const allCues = [...(Array.isArray(rawCues) ? rawCues : [])].sort((a, b) => a.startTime - b.startTime);
          const idx = allCues.findIndex((c) => c.id === selId);
          if (idx !== -1) {
            if (idx < allCues.length - 1) {
              mergeCues(selId, allCues[idx + 1].id);
            } else if (idx > 0) {
              mergeCues(allCues[idx - 1].id, selId);
            }
          }
        }
      }
      // Delete / Backspace: Xóa các câu được chọn (hỗ trợ xóa hàng loạt)
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const rawSelIds = useCueStore.getState().selectedCueIds;
        const selIds = Array.isArray(rawSelIds) ? rawSelIds : [];
        if (selIds && selIds.length > 0) {
          deleteMultipleCues(selIds);
        } else if (selId !== null) {
          deleteCue(selId);
        }
      }
      // Escape: Bỏ chọn cue và video clip
      else if (e.key === 'Escape') {
        setSelectedCueId(null);
        setSelectedCueIds([]);
        useTimelineStore.getState().setSelectedElement(null);
      }
      // N: Bật / tắt Hít nam châm
      else if (e.key === 'n' || e.key === 'N') {
        const currentSnap = useTimelineStore.getState().snappingEnabled;
        useTimelineStore.getState().setSnappingEnabled(!currentSnap);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteCue, deleteMultipleCues, mergeCues, splitCue, updateCue, setSelectedCueId, setSelectedCueIds]);

  // Phóng to / Thu nhỏ bằng Ctrl + Cuộn chuột (Hỗ trợ thu nhỏ tối đa xuống 1px/s)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? (zoom < 15 ? 2 : 15) : (zoom <= 15 ? -2 : -15);
      const newZoom = Math.max(1, Math.min(400, zoom + delta));
      setZoom(newZoom);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-surface-0)',
        borderTop: '1px solid var(--border-subtle)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Timeline Controls Toolbar */}
      <TimelineToolbar videoDuration={videoDuration} />

      {/* Main Timeline Workspace: Left Track Headers Sidebar + Right Scrollable Tracks */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: `${TIMELINE_HEIGHT}px`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Left Track Header Sidebar (w-28 / 112px) */}
        <TrackHeaderSidebar />

        {/* Right Scrollable Viewport */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onMouseDown={handleMouseDown}
          onMouseMove={handleContainerMouseMove}
          onWheel={handleWheel}
          style={{
            flex: 1,
            minWidth: 0,
            height: `${TIMELINE_HEIGHT}px`,
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'relative',
            backgroundColor: '#0d0f15',
            cursor: cursorStyle,
          }}
        >
          {/* Thanh đệm chiều rộng cuộn */}
          <div
            style={{
              width: `${contentWidth}px`,
              height: `${TIMELINE_HEIGHT}px`,
              position: 'relative',
            }}
          >
            {/* Container sticky cố định Canvas khớp 100% viewport để vẽ 60 FPS siêu mượt */}
            <div
              style={{
                position: 'sticky',
                left: 0,
                top: 0,
                width: `${containerWidth}px`,
                height: `${TIMELINE_HEIGHT}px`,
                pointerEvents: 'none',
              }}
            >
              {/* Lớp 1: Base Canvas (Tracks, Cues, Video Filmstrip, Audio Waveforms) */}
              <MultiTrackCanvas
                width={containerWidth}
                height={TIMELINE_HEIGHT}
                zoom={zoom}
                scrollLeft={scrollLeft}
                cues={cues}
                selectedCueId={selectedCueId}
                selectedCueIds={selectedCueIds}
                videoDuration={videoDuration}
              />

              {/* Lớp 2: Playhead Overlay Canvas (60Hz Transient) */}
              <PlayheadCanvas
                width={containerWidth}
                height={TIMELINE_HEIGHT}
                zoom={zoom}
                scrollLeft={scrollLeft}
              />

              {/* Lớp 3: Hộp kéo quét chọn nhiều phần tử (Marquee Drag Selection Box) */}
              {selectionBox && (
                <div
                  style={{
                    position: 'fixed',
                    left: `${selectionBox.left}px`,
                    top: `${selectionBox.top}px`,
                    width: `${selectionBox.width}px`,
                    height: `${selectionBox.height}px`,
                    backgroundColor: 'rgba(56, 189, 248, 0.18)',
                    border: '1px dashed #38bdf8',
                    borderRadius: '2px',
                    pointerEvents: 'none',
                    zIndex: 999,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
