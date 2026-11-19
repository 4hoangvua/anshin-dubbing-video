import React, { useEffect } from 'react'
import { Header } from './components/Header'
import { VideoPlayer } from './components/VideoPlayer'
import { StepWizard } from './components/StepWizard'
import { RecognitionStep } from './components/steps/RecognitionStep'
import { TranslationStep } from './components/steps/TranslationStep'
import { NarrationStep } from './components/steps/NarrationStep'
import { ExportStep } from './components/steps/ExportStep'
import { useProjectStore } from './stores/projectStore'
import { useModelStore } from './stores/modelStore'

export const App: React.FC = () => {
  const activeStep = useProjectStore((s) => s.activeStep)
  const loadProject = useProjectStore((s) => s.loadProject)
  const fetchModels = useModelStore((s) => s.fetchModels)

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // Tự động khôi phục dự án gần nhất nếu có trong hệ thống
  useEffect(() => {
    const autoRestoreProject = async () => {
      try {
        const res = await fetch('/api/project/list')
        if (!res.ok) return
        const data = await res.json()
        const projectList: Array<{ projectId: string }> = data.projects || []
        if (projectList.length === 0) return

        let targetId = localStorage.getItem('last_project_id')
        if (!targetId || !projectList.some((p) => p.projectId === targetId)) {
          targetId = projectList[0].projectId
        }

        if (targetId) {
          await loadProject(targetId)
        }
      } catch {
        // Bỏ qua lỗi ngầm khi khởi động ban đầu
      }
    }

    autoRestoreProject()
  }, [loadProject])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Header */}
      <Header />

      {/* Main Studio Split-View Area */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Left Studio Panel: HTML5 Native Video Player & Subtitle Overlay (42%) */}
        <div className="w-[42%] min-w-[360px] max-w-[50%] h-full shrink-0 flex flex-col">
          <VideoPlayer />
        </div>

        {/* Right Studio Panel: 4-Step Pipeline Wizard & Steps (58%) */}
        <div className="flex-1 h-full flex flex-col min-w-0 overflow-hidden bg-slate-950">
          <StepWizard />

          {/* Active Step Content */}
          <main className="flex-1 min-h-0 relative">
            {activeStep === 1 && <RecognitionStep />}
            {activeStep === 2 && <TranslationStep />}
            {activeStep === 3 && <NarrationStep />}
            {activeStep === 4 && <ExportStep />}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
