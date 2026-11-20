import React, { useState, useRef } from 'react';
import { Sparkles, StopCircle, Mic, Image as ImageIcon } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';
import { useUIStore } from '../../stores/uiStore';
import { Button, Select, Badge, Switch } from '../../design-system';
import { MorphingActionButton } from '../models/MorphingActionButton';
import { streamSSE } from '../../core/sseClient';

export const Step1Recognition: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];
  const setCues = useCueStore((s) => s.setCues);
  const addToast = useUIStore((s) => s.addToast);

  const [mode, setMode] = useState<'asr' | 'ocr'>((project?.settings?.recognitionMode as 'asr' | 'ocr') || 'asr');
  const [model, setModel] = useState<string>('small');
  const [lang, setLang] = useState<string>('zh');
  const [vad, setVad] = useState<boolean>(true);
  const [smartSplit, setSmartSplit] = useState<boolean>(true);

  const handleModeChange = (newMode: 'asr' | 'ocr') => {
    setMode(newMode);
    updateSettings({ recognitionMode: newMode });
  };

  // SSE stream state
  const [isRunning, setIsRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedModelId = mode === 'ocr' ? 'rapidocr-directml' : `whisper-${model}`;

  const handleStartRecognize = async () => {
    if (!project) {
      addToast({ type: 'warning', title: 'Chưa có dự án nào đang mở' });
      return;
    }

    setIsRunning(true);
    setPercent(0);
    setMessage('Đang kết nối nhận diện...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      projectId: project.projectId,
      mode,
      model,
      lang,
      vad,
      smartSplit,
      ocrRegion: mode === 'ocr' ? project?.settings?.ocrRegion : undefined,
    };

    await streamSSE(
      '/api/step1/recognize',
      payload,
      {
        onProgress: (event) => {
          if (event.percent !== undefined) setPercent(event.percent);
          if (event.message) setMessage(event.message);
          if (event.cues && Array.isArray(event.cues)) {
            setCues(event.cues);
          }
        },
        onComplete: (event) => {
          setPercent(100);
          setMessage('Hoàn tất nhận diện.');
          if (event.cues && Array.isArray(event.cues)) {
            setCues(event.cues);
          }
          setIsRunning(false);
          addToast({ type: 'success', title: 'Hoàn tất nhận diện toàn bộ câu thoại!' });
        },
        onError: (err) => {
          setIsRunning(false);
          addToast({ type: 'error', title: err.message || 'Lỗi nhận diện' });
        },
      },
      controller.signal
    );

    setIsRunning(false);
  };

  const handleStopRecognize = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
    setMessage('Đã dừng tiến trình.');
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
          <Sparkles size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Bước 1: Tách Thoại Video
          </span>
        </div>
        <Badge variant={cues.length > 0 ? 'success' : 'info'}>{cues.length} câu</Badge>
      </div>

      {/* Mode Selector: 2-state Segmented Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Phương thức bóc tách
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
            onClick={() => handleModeChange('asr')}
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
              border: mode === 'asr' ? '1px solid var(--color-primary)' : '1px solid transparent',
              backgroundColor: mode === 'asr' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: mode === 'asr' ? 'var(--color-primary)' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            <Mic size={13} />
            <span>Âm thanh ASR</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('ocr')}
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
              border: mode === 'ocr' ? '1px solid var(--color-primary)' : '1px solid transparent',
              backgroundColor: mode === 'ocr' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: mode === 'ocr' ? 'var(--color-primary)' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            <ImageIcon size={13} />
            <span>Phụ đề OCR</span>
          </button>
        </div>
      </div>

      {/* Model & Language Settings */}
      {mode === 'asr' && (
        <Select
          label="Mô hình Faster-Whisper"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          options={[
            { value: 'tiny', label: 'Whisper Tiny (Nhanh nhất)' },
            { value: 'base', label: 'Whisper Base' },
            { value: 'small', label: 'Whisper Small (Khuyên dùng)' },
            { value: 'medium', label: 'Whisper Medium (Độ chính xác cao)' },
          ]}
        />
      )}

      <Select
        label="Ngôn ngữ gốc trong video"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        options={[
          { value: 'zh', label: 'Tiếng Trung (zh)' },
          { value: 'en', label: 'Tiếng Anh (en)' },
          { value: 'auto', label: 'Tự động nhận diện' },
        ]}
      />

      {/* Toggle Switches (Thay thế Dropdown 2 trạng thái) */}
      {mode === 'asr' && (
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
            label="Lọc tạp âm (Silero VAD)"
            description="Tự động loại bỏ tiếng ồn nền và khoảng lặng"
            checked={vad}
            onChange={setVad}
          />

          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

          <Switch
            label="Tách câu theo khoảng lặng"
            description="Ngắt câu tự nhiên theo nhịp thở và hơi dừng"
            checked={smartSplit}
            onChange={setSmartSplit}
          />
        </div>
      )}

      {/* Action Button & Progress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
        {isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message || 'Đang nhận diện câu thoại...'}
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
            <Button size="sm" variant="danger" leftIcon={<StopCircle size={14} />} onClick={handleStopRecognize}>
              Dừng
            </Button>
          )}
          <MorphingActionButton
            modelId={selectedModelId}
            runLabel="Bắt đầu nhận diện"
            isRunning={isRunning}
            disabled={!project}
            onRun={handleStartRecognize}
          />
        </div>
      </div>
    </div>
  );
};
