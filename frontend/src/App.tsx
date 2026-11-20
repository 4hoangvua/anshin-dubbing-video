import React, { useEffect } from 'react';
import { StudioLayout } from './features/layout/StudioLayout';
import { VideoPlayer } from './features/player/VideoPlayer';
import { CanvasTimeline } from './features/timeline/CanvasTimeline';
import { VirtualCueTable } from './features/cues/VirtualCueTable';
import { Step1Recognition } from './features/steps/Step1Recognition';
import { Step2Translation } from './features/steps/Step2Translation';
import { Step3Narration } from './features/steps/Step3Narration';
import { Step4Export } from './features/steps/Step4Export';
import { useProjectStore } from './stores/projectStore';
import { useModelStore } from './stores/modelStore';
import { apiClient } from './core/apiClient';

export const App: React.FC = () => {
  const activeStep = useProjectStore((s) => s.activeStep);
  const loadProject = useProjectStore((s) => s.loadProject);
  const fetchModels = useModelStore((s) => s.fetchModels);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Tự động khôi phục dự án gần nhất nếu có trong hệ thống
  useEffect(() => {
    const autoRestoreProject = async () => {
      try {
        const data = await apiClient.get<{ projects: Array<{ projectId: string }> }>('/api/project/list');
        const projectList = data.projects || [];
        if (projectList.length === 0) return;

        let targetId = localStorage.getItem('last_project_id');
        if (!targetId || !projectList.some((p) => p.projectId === targetId)) {
          targetId = projectList[0].projectId;
        }

        if (targetId) {
          await loadProject(targetId);
        }
      } catch {
        // Bỏ qua lỗi ngầm khi khởi động ban đầu
      }
    };

    autoRestoreProject();
  }, [loadProject]);

  return (
    <StudioLayout
      leftContent={
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          {activeStep === 1 && <Step1Recognition />}
          {activeStep === 2 && <Step2Translation />}
          {activeStep === 3 && <Step3Narration />}
          {activeStep === 4 && <Step4Export />}
        </div>
      }
      centerContent={
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <VideoPlayer />
          </div>
          <CanvasTimeline />
        </div>
      }
      rightContent={
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <VirtualCueTable />
        </div>
      }
    />
  );
};

export default App;
