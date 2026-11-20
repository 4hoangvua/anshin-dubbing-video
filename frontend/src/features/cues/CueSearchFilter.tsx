import React, { useState } from 'react';
import { Search, Undo2, Redo2, X, Users, Save, Loader2 } from 'lucide-react';
import { useCueStore } from '../../stores/cueStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../design-system/Button';
import { SpeakerRoleModal } from './SpeakerRoleModal';

export const CueSearchFilter: React.FC = () => {
  const [speakerModalOpen, setSpeakerModalOpen] = useState(false);

  const searchQuery = useCueStore((s) => s.searchQuery);
  const setSearchQuery = useCueStore((s) => s.setSearchQuery);

  const canUndo = useCueStore((s) => s.canUndo);
  const canRedo = useCueStore((s) => s.canRedo);
  const undo = useCueStore((s) => s.undo);
  const redo = useCueStore((s) => s.redo);
  const saveCuesToServer = useCueStore((s) => s.saveCuesToServer);
  const isSyncing = useCueStore((s) => s.isSyncing);
  const project = useProjectStore((s) => s.project);

  const handleSave = async () => {
    if (!project?.projectId) return;
    const ok = await saveCuesToServer(project.projectId);
    if (ok) {
      useUIStore.getState().addToast({
        type: 'success',
        title: 'Đã lưu phụ đề',
        description: 'Toàn bộ nội dung và mốc thời gian đã được lưu vào máy chủ.',
      });
    } else {
      useUIStore.getState().addToast({
        type: 'error',
        title: 'Lỗi lưu phụ đề',
        description: 'Không thể kết nối đến máy chủ để lưu.',
      });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-surface-0)',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      {/* Search Input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--bg-surface-1)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          padding: '0 8px',
          height: '28px',
          flex: 1,
          maxWidth: '260px',
          gap: '6px',
        }}
      >
        <Search size={13} color="var(--text-muted)" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm kiếm lời thoại..."
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '12px',
            width: '100%',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Speaker Roles Modal Toggle */}
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Users size={12} />}
          onClick={() => setSpeakerModalOpen(true)}
          title="Quản lý nhân vật & giọng đọc AI"
          style={{ height: '28px', fontSize: '11px', padding: '0 8px' }}
        >
          Nhân vật
        </Button>

        {/* Undo & Redo & Save buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Button
            size="icon"
            variant="ghost"
            disabled={!canUndo}
            onClick={undo}
            title="Hoàn tác (Ctrl+Z)"
            style={{ width: '28px', height: '28px' }}
          >
            <Undo2 size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={!canRedo}
            onClick={redo}
            title="Làm lại (Ctrl+Y)"
            style={{ width: '28px', height: '28px' }}
          >
            <Redo2 size={14} />
          </Button>
          <Button
            size="sm"
            variant="primary"
            leftIcon={isSyncing ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            disabled={isSyncing}
            onClick={handleSave}
            title="Lưu phụ đề và đồng bộ lên máy chủ"
            style={{ height: '28px', fontSize: '11px', padding: '0 8px', marginLeft: '2px' }}
          >
            {isSyncing ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </div>
      </div>

      <SpeakerRoleModal isOpen={speakerModalOpen} onClose={() => setSpeakerModalOpen(false)} />
    </div>
  );
};
