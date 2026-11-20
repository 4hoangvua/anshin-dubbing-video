import React, { useState, useEffect, useRef } from 'react';
import { Mic, StopCircle, Clock, ShieldCheck, Sparkles, AlertTriangle, Volume2, Square, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';
import { useUIStore } from '../../stores/uiStore';
import { Button, Select, Badge, Dialog, Slider, Switch } from '../../design-system';
import { MorphingActionButton } from '../models/MorphingActionButton';
import { apiClient } from '../../core/apiClient';
import { streamSSE } from '../../core/sseClient';
import { expandCueGaps } from '../narration/services/gapExpansion';
import type { CueItem, VoiceItem } from '../../types';

const DEFAULT_PRESET_VOICES: VoiceItem[] = [
  { id: 'Mai Anh', name: 'Mai Anh (Nữ Bắc · Phát thanh viên)', region: 'Bắc', gender: 'female', style: 'Tin tức', description: 'Mặc định' },
  { id: 'Minh Đức', name: 'Minh Đức (Nam Bắc · Trầm ấm)', region: 'Bắc', gender: 'male', style: 'Tin tức', description: 'Tài liệu' },
  { id: 'Trúc Ly', name: 'Trúc Ly (Nữ Bắc · Tự nhiên)', region: 'Bắc', gender: 'female', style: 'Đời thường', description: 'Trong trẻo' },
  { id: 'Quang Sơn', name: 'Quang Sơn (Nam Trung · Mộc mạc)', region: 'Trung', gender: 'male', style: 'Gần gũi', description: 'Ấm áp' },
  { id: 'Thái Sơn', name: 'Thái Sơn (Nam Nam · Hào sảng)', region: 'Nam', gender: 'male', style: 'Kể chuyện', description: 'Lôi cuốn' },
  { id: 'Thùy Dung', name: 'Thùy Dung (Nữ Nam · Phát thanh viên)', region: 'Nam', gender: 'female', style: 'Tin tức', description: 'Chuẩn miền Nam' },
];

export const Step3Narration: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];
  const setCues = useCueStore((s) => s.setCues);
  const addToast = useUIStore((s) => s.addToast);

  const [voices, setVoices] = useState<VoiceItem[]>(DEFAULT_PRESET_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<string>(project?.settings.defaultVoiceId || 'Mai Anh');
  const [borrowGap, setBorrowGap] = useState<boolean>(project?.settings.borrowGap ?? true);
  const [autoMatchDuration, setAutoMatchDuration] = useState<boolean>(project?.settings.autoMatchDuration ?? true);

  // Timing Offset Dialog
  const [offsetDialogOpen, setOffsetDialogOpen] = useState(false);
  const [leadOffset, setLeadOffset] = useState<number>(0.0);
  const [tailOffset, setTailOffset] = useState<number>(0.0);

  // Voice Sample Preview state
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // SSE state
  const [isRunning, setIsRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        sampleAudioRef.current = null;
      }
    };
  }, []);

  const handleToggleVoiceSample = () => {
    if (isPlayingSample && sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
      setIsPlayingSample(false);
      return;
    }

    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
    }

    setIsLoadingSample(true);
    const audioUrl = `/api/tts/voice-sample?voiceId=${encodeURIComponent(selectedVoice)}`;
    const audio = new Audio(audioUrl);
    sampleAudioRef.current = audio;

    audio.oncanplaythrough = () => {
      setIsLoadingSample(false);
      setIsPlayingSample(true);
    };

    audio.onended = () => {
      setIsPlayingSample(false);
      sampleAudioRef.current = null;
    };

    audio.onerror = () => {
      setIsLoadingSample(false);
      setIsPlayingSample(false);
      sampleAudioRef.current = null;
      addToast({ type: 'error', title: 'Không thể phát mẫu giọng đọc này' });
    };

    audio.play().catch((err) => {
      setIsLoadingSample(false);
      setIsPlayingSample(false);
      console.warn('Cannot play sample audio:', err);
    });
  };

  const handleVoiceChange = (newVoice: string) => {
    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
      setIsPlayingSample(false);
      setIsLoadingSample(false);
    }
    setSelectedVoice(newVoice);
  };

  const synthesizedCount = cues.filter((c) => !!c.audioFile).length;
  const fastCuesCount = cues.filter((c) => c.playbackRate && c.playbackRate > 1.35).length;
  const dangerousCuesCount = cues.filter((c) => c.playbackRate && c.playbackRate > 1.6).length;
  const ttsModelId = 'vieneu-v3-turbo';

  useEffect(() => {
    apiClient
      .get<{ voices: VoiceItem[] }>('/api/tts/voices')
      .then((data) => {
        if (data && Array.isArray(data.voices) && data.voices.length > 0) {
          setVoices(data.voices);
        }
      })
      .catch(() => {});
  }, []);

  const handleStartSynthesize = async () => {
    if (!project) return;
    if (cues.length === 0) {
      addToast({ type: 'warning', title: 'Chưa có câu thoại nào để lồng tiếng' });
      return;
    }

    setIsRunning(true);
    setPercent(0);
    setMessage('Đang nạp mô hình VieNeu ONNX...');

    updateSettings({ defaultVoiceId: selectedVoice, borrowGap, autoMatchDuration });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      projectId: project.projectId,
      voiceId: selectedVoice,
      device: 'cpu',
      autoMatchDuration,
      borrowGap,
    };

    await streamSSE(
      '/api/step3/synthesize',
      payload,
      {
        onProgress: (data) => {
          if (data.percent !== undefined) setPercent(data.percent);
          if (data.message) setMessage(data.message);
          if (data.cueId && data.audioUrl) {
            useCueStore.getState().updateAudio(data.cueId, {
              audioFile: data.audioUrl,
              audioDuration: data.clipDuration || 0,
              speed: 1.0,
              status: 'ready',
            });
          }
        },
        onComplete: (data) => {
          setPercent(100);
          setMessage('Hoàn tất lồng tiếng.');
          if (data.cues && Array.isArray(data.cues)) {
            const updates = data.cues.map((c: any) => ({
              id: c.id,
              patch: {
                audioFile: c.audioFile || '',
                audioDuration: c.audioDuration || 0,
                speed: c.speed || 1.0,
                playbackRate: c.playbackRate || 1.0,
                status: (c.status || 'ready') as any,
                needsReview: c.needsReview ?? false,
              },
            }));
            useCueStore.getState().updateBatchCues(updates);
          }
          setIsRunning(false);
          addToast({ type: 'success', title: 'Hoàn tất lồng tiếng toàn bộ video!' });
        },
        onError: (err) => {
          setIsRunning(false);
          addToast({ type: 'error', title: err.message || 'Lỗi lồng tiếng' });
        },
      },
      controller.signal
    );

    setIsRunning(false);
  };

  const handleStopSynthesize = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
    setMessage('Đã dừng tiến trình.');
  };

  const handleSyncSubtitles = async () => {
    if (!project) return;
    try {
      const res = await apiClient.post<{ cues: CueItem[] }>('/api/step3/sync-subtitles', {
        projectId: project.projectId,
        paddingMs: 50,
      });
      if (res.cues) {
        setCues(res.cues);
        addToast({ type: 'success', title: 'Đã đồng bộ mốc thời gian phụ đề theo giọng nói AI!' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi đồng bộ phụ đề';
      addToast({ type: 'error', title: msg });
    }
  };

  const handleApplyOffset = async () => {
    if (!project) return;
    try {
      const res = await apiClient.post<{ cues: CueItem[] }>('/api/step3/timing-offset', {
        projectId: project.projectId,
        leadOffset,
        tailOffset,
      });

      if (res.cues) {
        setCues(res.cues);
        setOffsetDialogOpen(false);
        addToast({ type: 'success', title: 'Đã cập nhật bù thời gian phụ đề!' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi bù trễ thời gian';
      addToast({ type: 'error', title: msg });
    }
  };

  const handleOptimizeGaps = () => {
    if (cues.length === 0) {
      addToast({ type: 'warning', title: 'Chưa có câu thoại nào để tối ưu' });
      return;
    }
    const expanded = expandCueGaps(cues, {
      targetWordsPerSecond: 3.4,
      safetyPaddingSeconds: 0.25,
      maxGapBorrowRatio: 0.85,
      maxBorrowSeconds: 3.5,
    });
    const updatedCues = expanded.map((r) => r.cue);
    setCues(updatedCues);
    const expandedCount = expanded.filter((r) => r.expandedSeconds > 0.05).length;
    addToast({
      type: 'success',
      title: `Đã tối ưu khoảng lặng 2 chiều cho ${expandedCount}/${cues.length} câu thoại theo ngữ pháp tiếng Việt!`,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-surface-0)',
        overflowY: 'auto',
        padding: '14px',
        gap: '14px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Mic size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Bước 3: Lồng Tiếng AI (VieNeu-TTS)
          </span>
        </div>
        <Badge variant={synthesizedCount === cues.length && cues.length > 0 ? 'success' : 'info'}>
          {synthesizedCount}/{cues.length} câu có tiếng
        </Badge>
      </div>

      {/* Voice Selection with Audio Preview Button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Select
              label="Giọng đọc mặc định"
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              options={voices.map((v) => ({
                value: v.id,
                label: `${v.name} (${v.region})`,
              }))}
            />
          </div>
          <Button
            size="sm"
            variant={isPlayingSample ? 'primary' : 'secondary'}
            leftIcon={
              isLoadingSample ? (
                <Loader2 size={13} className="animate-spin" />
              ) : isPlayingSample ? (
                <Square size={12} fill="currentColor" />
              ) : (
                <Volume2 size={13} />
              )
            }
            onClick={handleToggleVoiceSample}
            title="Bấm để nghe thử mẫu giọng đọc AI này"
            style={{
              height: '32px',
              marginBottom: '1px',
              flexShrink: 0,
              fontSize: '11px',
              padding: '0 10px',
              whiteSpace: 'nowrap',
            }}
          >
            {isLoadingSample ? 'Đang tải...' : isPlayingSample ? 'Dừng' : 'Nghe giọng'}
          </Button>
        </div>
      </div>

      {/* Toggles (Switches thay thế dropdown 2 trạng thái) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          backgroundColor: 'var(--bg-surface-1)',
          padding: '12px',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <Switch
          label="Mượn khoảng lặng (Borrow Gap)"
          description="Nới rộng thời gian đọc vào khoảng trống an toàn giữa các câu"
          checked={borrowGap}
          onChange={setBorrowGap}
        />

        <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

        <Switch
          label="Tự co dãn tốc độ (Time-stretch)"
          description="Tự động tăng tốc độ đọc nếu câu dịch dài hơn thời lượng video"
          checked={autoMatchDuration}
          onChange={setAutoMatchDuration}
        />
      </div>

      {/* Speed Monitor & Distortion Warning (Giúp kiểm soát câu bị đọc quá nhanh vỡ tiếng) */}
      {autoMatchDuration && cues.length > 0 && (
        <div
          style={{
            backgroundColor: dangerousCuesCount > 0 ? 'rgba(239, 68, 68, 0.12)' : fastCuesCount > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.08)',
            border: `1px solid ${dangerousCuesCount > 0 ? 'rgba(239, 68, 68, 0.4)' : fastCuesCount > 0 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(16, 185, 129, 0.25)'}`,
            borderRadius: '6px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '11px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: dangerousCuesCount > 0 ? '#ef4444' : fastCuesCount > 0 ? '#f59e0b' : '#10b981' }}>
              {fastCuesCount > 0 ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
              <span>Giám sát tốc độ co dãn âm thanh</span>
            </div>
            {synthesizedCount > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {synthesizedCount}/{cues.length} câu
              </span>
            )}
          </div>

          {fastCuesCount > 0 ? (
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Có <strong style={{ color: dangerousCuesCount > 0 ? '#ef4444' : '#f59e0b' }}>{fastCuesCount} câu</strong> đọc nhanh &gt; 1.35x (trong đó {dangerousCuesCount} câu &gt; 1.6x). Tốc độ chi tiết được gắn trực tiếp trên từng câu ở bảng bên phải.
            </div>
          ) : synthesizedCount > 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>
              Tất cả các câu đều có tốc độ đọc tự nhiên (≤ 1.35x), không bị méo giọng. Tốc độ chi tiết hiển thị trực tiếp ở bảng câu thoại bên phải.
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>
              Tốc độ co dãn của từng câu sẽ được hiển thị trực tiếp trên danh sách câu thoại sau khi lồng tiếng.
            </div>
          )}
        </div>
      )}

      {/* Auxiliary Tools (Tối ưu khoảng lặng, Đồng bộ, Bù trễ) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Công cụ tinh chỉnh trục âm thanh
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Sparkles size={13} color="var(--accent-primary)" />}
            onClick={handleOptimizeGaps}
            disabled={cues.length === 0}
            title="Tối ưu khoảng lặng 2 chiều theo cú pháp tiếng Việt để giọng đọc trôi chảy"
            style={{ justifyContent: 'flex-start', fontSize: '11px' }}
          >
            Tối ưu khoảng lặng 2 chiều
          </Button>

          <Button
            size="sm"
            variant="secondary"
            leftIcon={<ShieldCheck size={13} color="var(--accent-success)" />}
            onClick={handleSyncSubtitles}
            disabled={synthesizedCount === 0}
            title="Đồng bộ lại mốc bắt đầu/kết thúc phụ đề theo độ dài câu đọc AI"
            style={{ justifyContent: 'flex-start', fontSize: '11px' }}
          >
            Đồng bộ phụ đề theo giọng AI
          </Button>

          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Clock size={13} />}
            onClick={() => setOffsetDialogOpen(true)}
            title="Căn chỉnh bù trễ thời gian đầu/đuôi câu"
            style={{ justifyContent: 'flex-start', fontSize: '11px' }}
          >
            Bù trễ thời gian câu (Offset)
          </Button>
        </div>
      </div>

      {/* Action Button & Progress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
        {isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message || 'Đang tạo âm thanh AI...'}
              </span>
              <span style={{ fontWeight: 600 }}>{percent.toFixed(0)}%</span>
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-strong)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, backgroundColor: 'var(--accent-primary)', transition: 'width 0.2s ease' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          {isRunning && (
            <Button size="sm" variant="danger" leftIcon={<StopCircle size={14} />} onClick={handleStopSynthesize}>
              Dừng
            </Button>
          )}
          <MorphingActionButton
            modelId={ttsModelId}
            runLabel="Bắt đầu lồng tiếng"
            isRunning={isRunning}
            disabled={!project || cues.length === 0}
            onRun={handleStartSynthesize}
          />
        </div>
      </div>

      {/* Timing Offset Dialog */}
      <Dialog
        isOpen={offsetDialogOpen}
        onClose={() => setOffsetDialogOpen(false)}
        title="Căn Chỉnh Độ Lệch Thời Gian Phụ Đề (Timing Offset)"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            Điều chỉnh đệm thời gian trước hoặc sau câu để phụ đề xuất hiện sớm hoặc biến mất trễ hơn.
          </p>

          <Slider
            label="Bù thời gian trước câu (Lead Offset)"
            value={leadOffset}
            min={-0.5}
            max={0.5}
            step={0.02}
            unit="s"
            onChange={setLeadOffset}
          />

          <Slider
            label="Bù thời gian sau câu (Tail Offset)"
            value={tailOffset}
            min={-0.5}
            max={0.5}
            step={0.02}
            unit="s"
            onChange={setTailOffset}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="ghost" onClick={() => setOffsetDialogOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" onClick={handleApplyOffset}>
              Áp dụng cho toàn bộ câu
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
