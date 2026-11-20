import React, { useState, useRef } from 'react';
import { Share2, Volume2, CheckCircle2, Film, Sliders, StopCircle, FileText } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';
import { useUIStore } from '../../stores/uiStore';
import { Button, Select, Badge, Slider, Switch } from '../../design-system';
import { streamSSE } from '../../core/sseClient';
import type { ExportInfo } from '../../types';

export const Step4Export: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const setExportInfo = useProjectStore((s) => s.setExportInfo);
  const cues = useCueStore((s) => s.cues);
  const addToast = useUIStore((s) => s.addToast);

  const [autoDucking, setAutoDucking] = useState<boolean>(project?.settings.autoDucking ?? false);
  const [duckingVolume, setDuckingVolume] = useState<number>(project?.settings.duckingVolume ?? 0.15);
  const [sourceVolumeDb, setSourceVolumeDb] = useState<number>(project?.settings.sourceVolumeDb ?? -12.0);
  const [ttsVolumeDb, setTtsVolumeDb] = useState<number>(project?.settings.ttsVolumeDb ?? 0.0);
  const [exportSubtitleType, setExportSubtitleType] = useState<'soft' | 'hard'>('soft');
  const [videoCodec, setVideoCodec] = useState<string>(project?.settings.videoCodec ?? 'h264_nvenc');

  // Export progress state
  const [isRunning, setIsRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const hasAudioClips = cues.some((c) => !!c.audioFile);
  const exportInfo = project?.exportInfo;

  const handleStartExport = async () => {
    if (!project) return;

    setIsRunning(true);
    setPercent(0);
    setMessage('Đang chuẩn bị luồng hòa âm DSP và FFmpeg NVENC...');

    updateSettings({
      autoDucking,
      duckingVolume,
      sourceVolumeDb,
      ttsVolumeDb,
      exportSubtitleType,
      videoCodec,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      projectId: project.projectId,
      autoDucking,
      duckingVolume,
      duckAttackMs: project.settings.duckAttackMs || 150,
      duckReleaseMs: project.settings.duckReleaseMs || 400,
      sourceVolumeDb,
      ttsVolumeDb,
      exportSubtitleType,
      resolution: 'original',
      videoCodec,
    };

    await streamSSE(
      '/api/step4/export',
      payload,
      {
        onProgress: (data) => {
          if (data.percent !== undefined) setPercent(data.percent);
          if (data.message) setMessage(data.message);
          if (data.outputVideoPath) {
            const info: ExportInfo = {
              exportedFilePath: data.outputVideoPath,
              exportedAt: new Date().toISOString(),
              exportDurationSec: data.durationSec || project.videoInfo.duration,
              fileSizeBytes: data.fileSizeBytes,
            };
            setExportInfo(info);
          }
        },
        onComplete: (data) => {
          setPercent(100);
          setMessage('Xuất video hoàn tất.');
          if (data.outputVideoPath) {
            const info: ExportInfo = {
              exportedFilePath: data.outputVideoPath,
              exportedAt: new Date().toISOString(),
              exportDurationSec: data.durationSec || project.videoInfo.duration,
              fileSizeBytes: data.fileSizeBytes,
            };
            setExportInfo(info);
          }
          setIsRunning(false);
          addToast({ type: 'success', title: 'Xuất video hoàn tất thành công!' });
        },
        onError: (err) => {
          setIsRunning(false);
          addToast({ type: 'error', title: err.message || 'Lỗi xuất video' });
        },
      },
      controller.signal
    );

    setIsRunning(false);
  };

  const handleStopExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
    setMessage('Đã hủy xuất video.');
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
          <Share2 size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Bước 4: Hòa Âm & Xuất Video
          </span>
        </div>
        {!hasAudioClips && (
          <Badge variant="warning">Chưa có tiếng Bước 3</Badge>
        )}
      </div>

      {/* DSP Ducking Switch */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Volume2 size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Hòa âm nhạc nền
          </span>
        </div>

        <Switch
          label="Tự giảm nhạc nền (Auto Ducking)"
          description="Tự động hạ nhỏ âm thanh video gốc khi giọng thuyết minh cất lên"
          checked={autoDucking}
          onChange={setAutoDucking}
        />

        {autoDucking && (
          <Slider
            label="Mức âm lượng BGM khi né tiếng"
            value={Math.round(duckingVolume * 100)}
            min={5}
            max={50}
            step={5}
            unit="%"
            onChange={(val) => setDuckingVolume(val / 100)}
          />
        )}
      </div>

      {/* Audio Gains */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sliders size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Cân bằng âm lượng
          </span>
        </div>

        <Slider
          label="Âm lượng video gốc (BGM Gain)"
          value={sourceVolumeDb}
          min={-24}
          max={6}
          step={1}
          unit=" dB"
          onChange={setSourceVolumeDb}
        />

        <Slider
          label="Âm lượng thuyết minh (TTS Gain)"
          value={ttsVolumeDb}
          min={-6}
          max={12}
          step={1}
          unit=" dB"
          onChange={setTtsVolumeDb}
        />
      </div>

      {/* Subtitle Type: 2-state Segmented Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Kiểu phụ đề xuất bản
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px',
            backgroundColor: 'var(--bg-surface-1)',
            padding: '3px',
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => setExportSubtitleType('soft')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '6px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              border: exportSubtitleType === 'soft' ? '1px solid var(--color-primary)' : '1px solid transparent',
              backgroundColor: exportSubtitleType === 'soft' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: exportSubtitleType === 'soft' ? 'var(--color-primary)' : 'var(--text-muted)',
            }}
          >
            <FileText size={13} />
            <span>Phụ đề mềm (Soft)</span>
          </button>

          <button
            type="button"
            onClick={() => setExportSubtitleType('hard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '6px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              border: exportSubtitleType === 'hard' ? '1px solid var(--color-primary)' : '1px solid transparent',
              backgroundColor: exportSubtitleType === 'hard' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: exportSubtitleType === 'hard' ? 'var(--color-primary)' : 'var(--text-muted)',
            }}
          >
            <Film size={13} />
            <span>Khắc cứng (Burn-in)</span>
          </button>
        </div>
      </div>

      <Select
        label="Bộ giải mã video (Encoder)"
        value={videoCodec}
        onChange={(e) => setVideoCodec(e.target.value)}
        options={[
          { value: 'h264_nvenc', label: 'NVIDIA NVENC H.264 (Siêu nhanh GPU)' },
          { value: 'libx264', label: 'FFmpeg libx264 (CPU tiêu chuẩn)' },
        ]}
      />

      {/* Export Action & Progress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
        {isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message || 'Đang render video...'}
              </span>
              <span style={{ fontWeight: 600 }}>{percent.toFixed(0)}%</span>
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-strong)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, backgroundColor: 'var(--accent-primary)', transition: 'width 0.2s ease' }} />
            </div>
          </div>
        )}

        {exportInfo?.exportedFilePath && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-success)', fontSize: '11px', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Đã xuất: {exportInfo.exportedFilePath.split(/[\\/]/).pop()}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          {isRunning && (
            <Button size="sm" variant="danger" leftIcon={<StopCircle size={14} />} onClick={handleStopExport}>
              Dừng
            </Button>
          )}
          <Button
            size="md"
            variant="primary"
            isLoading={isRunning}
            disabled={!project || !hasAudioClips}
            leftIcon={<Film size={14} />}
            onClick={handleStartExport}
            style={{ width: '100%' }}
          >
            {exportInfo ? 'Xuất lại video' : 'Bắt đầu xuất video hoàn chỉnh'}
          </Button>
        </div>
      </div>
    </div>
  );
};
