import React, { useState, useRef, useMemo } from 'react';
import { Languages, StopCircle } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';
import { useUIStore } from '../../stores/uiStore';
import { useModelStore } from '../../stores/modelStore';
import { Button, Select, Badge, Switch } from '../../design-system';
import { MorphingActionButton } from '../models/MorphingActionButton';
import { streamSSE } from '../../core/sseClient';
import type { CueItem } from '../../types';

export const Step2Translation: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];
  const setCues = useCueStore((s) => s.setCues);
  const addToast = useUIStore((s) => s.addToast);

  const models = useModelStore((s) => s.models);
  const isDownloaded = useModelStore((s) => s.isDownloaded);

  // Lọc các model thuộc danh mục MT và tự động chọn model đã tải sẵn
  const mtModels = useMemo(() => models.filter((m) => m.category === 'mt'), [models]);

  const defaultMtModelId = useMemo(() => {
    const downloaded = mtModels.find((m) => isDownloaded(m.id));
    if (downloaded) return downloaded.id;
    return 'hy-mt2-1.8b-q8';
  }, [mtModels, isDownloaded]);

  const [selectedModel, setSelectedModel] = useState<string>(defaultMtModelId);
  const [genre, setGenre] = useState<string>(project?.settings.translationGenre || 'tech_tutorial');
  const [persona, setPersona] = useState<string>(project?.settings.translationPersona || 'neutral');
  const [reconstruct, setReconstruct] = useState<boolean>(true);

  // SSE state
  const [isRunning, setIsRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const translatedCount = cues.filter((c) => !!c.translatedText).length;

  const modelOptions = useMemo(() => {
    const list = mtModels.map((m) => ({
      value: m.id,
      label: `${m.name} ${isDownloaded(m.id) ? '✓ (Đã tải)' : '(Chưa tải)'}`,
    }));

    list.push(
      { value: 'auto', label: 'Tự động phát hiện mô hình tốt nhất' },
      { value: 'lmstudio', label: 'LM Studio (Localhost:1234)' }
    );
    return list;
  }, [mtModels, isDownloaded]);

  const handleStartTranslate = async () => {
    if (!project) {
      addToast({ type: 'warning', title: 'Chưa có dự án nào đang mở' });
      return;
    }

    if (cues.length === 0) {
      addToast({ type: 'warning', title: 'Chưa có câu thoại nào từ Bước 1 để dịch' });
      return;
    }

    setIsRunning(true);
    setPercent(0);
    setMessage('Đang khởi động sidecar llama-server.exe...');

    updateSettings({ translationGenre: genre, translationPersona: persona });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      projectId: project.projectId,
      genre,
      persona,
      srcLang: project.settings.sourceLang || 'zh',
      tgtLang: 'vi',
      reconstruct,
      modelEngine: selectedModel,
    };

    await streamSSE(
      '/api/step2/translate',
      payload,
      {
        onProgress: (data) => {
          if (data.percent !== undefined) setPercent(data.percent);
          if (data.message) setMessage(data.message);
          if (data.cues && Array.isArray(data.cues)) {
            setCues(data.cues as CueItem[]);
          }
        },
        onComplete: (data) => {
          setPercent(100);
          setMessage('Hoàn tất dịch thuật.');
          if (data.cues && Array.isArray(data.cues)) {
            setCues(data.cues as CueItem[]);
          }
          setIsRunning(false);
          addToast({ type: 'success', title: 'Hoàn tất dịch thuật toàn bộ câu thoại!' });
        },
        onError: (err) => {
          setIsRunning(false);
          addToast({ type: 'error', title: err.message || 'Lỗi dịch thuật' });
        },
      },
      controller.signal
    );

    setIsRunning(false);
  };

  const handleStopTranslate = () => {
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
          <Languages size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Bước 2: Dịch Thuật Ngữ Cảnh AI
          </span>
        </div>
        <Badge variant={translatedCount === cues.length && cues.length > 0 ? 'success' : 'info'}>
          {translatedCount}/{cues.length} câu
        </Badge>
      </div>

      {/* Model Selection */}
      <Select
        label="Mô hình dịch (MT Engine)"
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        options={modelOptions}
      />

      <Select
        label="Thể loại Video"
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
        options={[
          { value: 'tech_tutorial', label: 'Hướng dẫn công nghệ' },
          { value: 'movie_dialogue', label: 'Phim ảnh / Đối thoại' },
          { value: 'documentary', label: 'Phóng sự / Tài liệu' },
          { value: 'gaming', label: 'Gaming / Giải trí' },
        ]}
      />

      <Select
        label="Sắc thái xưng hô"
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        options={[
          { value: 'neutral', label: 'Trung tính (Tôi - Các bạn)' },
          { value: 'informal', label: 'Thân mật (Mình - Các bạn)' },
          { value: 'polite', label: 'Trang trọng (Chúng tôi - Quý vị)' },
          { value: 'intimate', label: 'Thân thiết (Anh - Em)' },
        ]}
      />

      {/* Toggle Switch */}
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
          label="Tái cấu trúc câu dài"
          description="Ghép các vế liên quan để dịch mượt mà, tránh ngắt vụn"
          checked={reconstruct}
          onChange={setReconstruct}
        />
      </div>

      {/* Action Button & Progress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
        {isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message || 'Đang xử lý dịch thuật qua llama-server...'}
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
            <Button size="sm" variant="danger" leftIcon={<StopCircle size={14} />} onClick={handleStopTranslate}>
              Dừng
            </Button>
          )}
          <MorphingActionButton
            modelId={selectedModel}
            runLabel="Bắt đầu dịch thuật"
            isRunning={isRunning}
            disabled={!project || cues.length === 0}
            onRun={handleStartTranslate}
          />
        </div>
      </div>
    </div>
  );
};
