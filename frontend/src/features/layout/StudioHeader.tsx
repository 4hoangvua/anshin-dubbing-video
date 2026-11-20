import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Film,
  Save,
  FolderOpen,
  Cpu,
  Moon,
  Sun,
  Plus,
  Clock,
  UploadCloud,
  FileVideo,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { Button, Dialog, Input, Badge } from '../../design-system';
import { apiClient } from '../../core/apiClient';

interface RecentProject {
  projectId: string;
  name: string;
  updatedAt: string;
  cueCount: number;
  currentStep: number;
  videoName: string;
  duration: number;
}

export const StudioHeader: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const isSaving = useProjectStore((s) => s.isSaving);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const saveProject = useProjectStore((s) => s.saveProject);
  const checkHealth = useProjectStore((s) => s.checkHealth);
  const setProject = useProjectStore((s) => s.setProject);

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const openModal = useUIStore((s) => s.openModal);
  const addToast = useUIStore((s) => s.addToast);

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<'create' | 'load'>('create');

  // Create Project state
  const [projectName, setProjectName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedNativePath, setSelectedNativePath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load Recent Projects state
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);

  const handleSave = useCallback(async () => {
    if (!project) return;
    const success = await saveProject();
    if (success) {
      addToast({ type: 'success', title: 'Đã lưu dự án thành công' });
    } else {
      addToast({ type: 'error', title: 'Lưu dự án thất bại' });
    }
  }, [project, saveProject, addToast]);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(() => checkHealth(), 12000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const fetchRecentProjects = async () => {
    setIsLoadingRecent(true);
    try {
      const data = await apiClient.get<{ projects: RecentProject[] }>('/api/project/list');
      setRecentProjects(data.projects || []);
    } catch {
      // Ignore background fetch error
    } finally {
      setIsLoadingRecent(false);
    }
  };

  const handleOpenProjectDialog = (tab: 'create' | 'load') => {
    setDialogTab(tab);
    setProjectDialogOpen(true);
    if (tab === 'load') {
      fetchRecentProjects();
    }
  };

  const handleNativeBrowse = async () => {
    try {
      const res = await apiClient.post<{ cancelled: boolean; filePath: string; fileName: string; fileSizeMb: number }>(
        '/api/system/browse-file',
        { title: 'Chọn tệp Video gốc để lồng tiếng', file_type: 'video' }
      );
      if (res && !res.cancelled && res.filePath) {
        setSelectedNativePath(res.filePath);
        setSelectedFile(null);
        if (!projectName) {
          const autoName = res.fileName ? res.fileName.replace(/\.[^/.]+$/, '').replace(/[\s_]+/g, '-') : 'Dự án mới';
          setProjectName(autoName);
        }
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleCreateSubmit = async () => {
    if (!projectName.trim()) {
      addToast({ type: 'warning', title: 'Vui lòng nhập tên dự án' });
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('name', projectName.trim());

      if (selectedFile) {
        formData.append('file', selectedFile);
      } else if (selectedNativePath) {
        formData.append('existing_path', selectedNativePath);
      }

      const res = await fetch('/api/project/create', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.detail || `HTTP ${res.status}`;
        throw new Error(`Tạo dự án thất bại: ${errMsg}`);
      }

      const data = await res.json();
      if (data.project) {
        setProject(data.project);
        setProjectDialogOpen(false);
        addToast({ type: 'success', title: 'Khởi tạo dự án thành công!' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi khởi tạo dự án';
      addToast({ type: 'error', title: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoadProject = async (projectId: string) => {
    setIsSubmitting(true);
    try {
      const data = await apiClient.get<any>(`/api/project/load?projectId=${encodeURIComponent(projectId.trim())}`);
      if (data) {
        setProject(data);
        setProjectDialogOpen(false);
        addToast({ type: 'success', title: 'Đã nạp dự án thành công!' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tải dự án';
      addToast({ type: 'error', title: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <header
        style={{
          height: '48px',
          backgroundColor: 'var(--bg-surface-0)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {/* Left: Branding & Project Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                backgroundColor: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Film size={18} />
            </div>
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>
              DUBBING STUDIO
            </span>
          </div>

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-subtle)' }} />

          {/* Current project info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {project ? project.name : 'Chưa có dự án nào'}
            </span>
            {project?.videoInfo?.fileName && (
              <Badge variant="default">
                {project.videoInfo.fileName}
              </Badge>
            )}
            {lastSavedAt && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Đã lưu {new Date(lastSavedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus size={14} />}
            onClick={() => handleOpenProjectDialog('create')}
          >
            Dự án mới
          </Button>

          <Button
            size="sm"
            variant="secondary"
            leftIcon={<FolderOpen size={14} />}
            onClick={() => handleOpenProjectDialog('load')}
          >
            Mở dự án
          </Button>

          <Button
            size="sm"
            variant={isSaving ? 'secondary' : 'primary'}
            leftIcon={<Save size={14} />}
            isLoading={isSaving}
            disabled={!project}
            onClick={handleSave}
          >
            Lưu
          </Button>

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-subtle)', margin: '0 4px' }} />

          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Cpu size={14} />}
            onClick={() => openModal('modelHub')}
          >
            Model Hub
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </header>

      {/* Project Create / Load Dialog */}
      <Dialog
        isOpen={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        title={dialogTab === 'create' ? 'Tạo Dự Án Lồng Tiếng Mới' : 'Mở Dự Án Gần Đây'}
      >
        {dialogTab === 'create' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Input
              label="Tên dự án"
              placeholder="VD: Video hướng dẫn công nghệ"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />

            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Tệp Video Gốc
              </label>
              <div
                style={{
                  border: '1px dashed var(--border-strong)',
                  borderRadius: '8px',
                  padding: '20px',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-surface-1)',
                  cursor: 'pointer',
                }}
                onClick={handleNativeBrowse}
              >
                <UploadCloud size={28} color="var(--accent-primary)" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {selectedNativePath
                    ? selectedNativePath
                    : selectedFile
                    ? selectedFile.name
                    : 'Bấm để chọn tệp Video từ máy tính'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Hỗ trợ MP4, MKV, MOV, WebM (Không nạp toàn bộ vào RAM)
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedFile(e.target.files[0]);
                    setSelectedNativePath('');
                    if (!projectName) {
                      setProjectName(e.target.files[0].name.replace(/\.[^/.]+$/, ''));
                    }
                  }
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <Button variant="ghost" onClick={() => setProjectDialogOpen(false)}>
                Hủy
              </Button>
              <Button variant="primary" isLoading={isSubmitting} onClick={handleCreateSubmit}>
                Bắt đầu biên tập
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {isLoadingRecent ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Đang quét các dự án gần đây...
              </div>
            ) : recentProjects.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Chưa có dự án nào được lưu trước đó.
              </div>
            ) : (
              recentProjects.map((p) => (
                <div
                  key={p.projectId}
                  onClick={() => handleLoadProject(p.projectId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-surface-1)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FileVideo size={20} color="var(--accent-primary)" />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {p.cueCount} câu thoại • {p.videoName || 'Không có video'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Dialog>
    </>
  );
};
