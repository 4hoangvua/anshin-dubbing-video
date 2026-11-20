import React, { useState } from 'react';
import { Plus, Trash2, Volume2 } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { Dialog, Button, Input, Select } from '../../design-system';
import type { SpeakerProfile } from '../../types';

interface SpeakerRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#3b82f6', // Blue
  '#ec4899', // Pink
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#ef4444', // Red
  '#84cc16', // Lime
  '#f97316', // Orange
  '#a855f7', // Violet
  '#14b8a6', // Teal
  '#eab308', // Yellow
];

const PRESET_VOICES = [
  { value: 'Mai Anh', label: 'Mai Anh (Nữ Bắc)' },
  { value: 'Minh Đức', label: 'Minh Đức (Nam Bắc)' },
  { value: 'Trúc Ly', label: 'Trúc Ly (Nữ Bắc)' },
  { value: 'Quang Sơn', label: 'Quang Sơn (Nam Trung)' },
  { value: 'Thái Sơn', label: 'Thái Sơn (Nam Nam)' },
  { value: 'Thùy Dung', label: 'Thùy Dung (Nữ Nam)' },
];

export const SpeakerRoleModal: React.FC<SpeakerRoleModalProps> = ({ isOpen, onClose }) => {
  const project = useProjectStore((s) => s.project);
  const updateSpeaker = useProjectStore((s) => s.updateSpeaker);
  const addSpeaker = useProjectStore((s) => s.addSpeaker);
  const removeSpeaker = useProjectStore((s) => s.removeSpeaker);
  const addToast = useUIStore((s) => s.addToast);

  const speakers = Array.isArray(project?.speakers) ? project.speakers : [];
  const [selectedId, setSelectedId] = useState<string>(speakers[0]?.id || 'SPEAKER_00');

  const currentSpeaker = speakers.find((s) => s.id === selectedId) || speakers[0];

  const handleAddNewSpeaker = () => {
    const nextIdx = speakers.length;
    const newId = `SPEAKER_${String(nextIdx).padStart(2, '0')}`;
    const newColor = PRESET_COLORS[nextIdx % PRESET_COLORS.length];
    const newSpeaker: SpeakerProfile = {
      id: newId,
      name: `Nhân vật ${nextIdx + 1}`,
      color: newColor,
      gender: nextIdx % 2 === 0 ? 'male' : 'female',
      voiceId: PRESET_VOICES[nextIdx % PRESET_VOICES.length].value,
      pitch: 0.0,
      speed: 1.0,
      selfPronoun: 'tôi',
      addressPronoun: 'bạn',
    };
    addSpeaker(newSpeaker);
    setSelectedId(newId);
    addToast({ type: 'success', title: `Đã thêm ${newSpeaker.name}` });
  };

  const handleDeleteSpeaker = (id: string) => {
    if (speakers.length <= 1) {
      addToast({ type: 'warning', title: 'Dự án phải có tối thiểu 1 nhân vật' });
      return;
    }
    removeSpeaker(id);
    const remaining = speakers.filter((s) => s.id !== id);
    if (remaining.length > 0) setSelectedId(remaining[0].id);
    addToast({ type: 'info', title: 'Đã xóa nhân vật' });
  };

  const handlePreviewVoice = (voiceId: string) => {
    const audioUrl = `/api/tts/preview?voice=${encodeURIComponent(voiceId)}`;
    const audio = new Audio(audioUrl);
    audio.play().catch(() => {
      addToast({ type: 'info', title: `Nghe thử giọng mẫu: ${voiceId}` });
    });
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Quản Lý Phân Vai & Giọng Đọc Nhân Vật" maxWidth="640px">
      <div style={{ display: 'flex', gap: '16px', minHeight: '340px' }}>
        {/* Left Column: Speaker List */}
        <div
          style={{
            width: '180px',
            borderRight: '1px solid var(--border-subtle)',
            paddingRight: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Danh sách ({speakers.length})
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAddNewSpeaker}
              title="Thêm nhân vật mới"
              style={{ padding: '4px' }}
            >
              <Plus size={14} />
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1 }}>
            {speakers.map((spk) => {
              const isSelected = spk.id === selectedId;
              return (
                <div
                  key={spk.id}
                  onClick={() => setSelectedId(spk.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: isSelected ? 'var(--bg-surface-active)' : 'transparent',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${spk.color}`,
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: isSelected ? 600 : 400,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {spk.name}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{spk.id}</span>
                  </div>

                  {speakers.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSpeaker(spk.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        opacity: 0.6,
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Speaker Detail Form */}
        {currentSpeaker && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Input
                label="Tên hiển thị nhân vật"
                value={currentSpeaker.name}
                onChange={(e) => updateSpeaker(currentSpeaker.id, { name: e.target.value })}
              />

              <Select
                label="Giới tính"
                value={currentSpeaker.gender}
                onChange={(e) =>
                  updateSpeaker(currentSpeaker.id, {
                    gender: e.target.value as 'female' | 'male' | 'neutral',
                  })
                }
                options={[
                  { value: 'female', label: 'Nữ (Female)' },
                  { value: 'male', label: 'Nam (Male)' },
                  { value: 'neutral', label: 'Trung tính / Đa dạng' },
                ]}
              />
            </div>

            {/* Color Palette */}
            <div>
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Màu sắc đại diện trên Timeline
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {PRESET_COLORS.map((color) => {
                  const isCurColor = currentSpeaker.color === color;
                  return (
                    <div
                      key={color}
                      onClick={() => updateSpeaker(currentSpeaker.id, { color })}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: color,
                        cursor: 'pointer',
                        border: isCurColor ? '2px solid #ffffff' : '2px solid transparent',
                        boxShadow: isCurColor ? '0 0 8px ' + color : 'none',
                        transition: 'transform 0.15s ease',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Pronoun Context for AI MT Translation */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Đại từ xưng hô (Ngữ cảnh dịch AI):
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Input
                  label="Tự xưng (selfPronoun)"
                  value={currentSpeaker.selfPronoun || ''}
                  placeholder="ví dụ: tôi, ta, anh, mình"
                  onChange={(e) => updateSpeaker(currentSpeaker.id, { selfPronoun: e.target.value })}
                />
                <Input
                  label="Gọi đối phương (addressPronoun)"
                  value={currentSpeaker.addressPronoun || ''}
                  placeholder="ví dụ: bạn, nàng, em, các hạ"
                  onChange={(e) => updateSpeaker(currentSpeaker.id, { addressPronoun: e.target.value })}
                />
              </div>
            </div>

            {/* Voice Model Assignment */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <Select
                  label="Giọng đọc AI mặc định (VieNeu)"
                  value={currentSpeaker.voiceId}
                  onChange={(e) => updateSpeaker(currentSpeaker.id, { voiceId: e.target.value })}
                  options={PRESET_VOICES}
                />
              </div>
              <Button
                variant="secondary"
                size="md"
                leftIcon={<Volume2 size={14} />}
                onClick={() => handlePreviewVoice(currentSpeaker.voiceId)}
                title="Nghe thử giọng mẫu"
              >
                Nghe thử
              </Button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
        <Button variant="primary" onClick={onClose}>
          Xong
        </Button>
      </div>
    </Dialog>
  );
};
