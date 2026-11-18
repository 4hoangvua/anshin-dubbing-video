import React, { useEffect } from 'react'
import { Header } from './components/Header'
import { VideoPlayer } from './components/VideoPlayer'
import { StepWizard } from './components/StepWizard'
import { RecognitionStep } from './components/steps/RecognitionStep'
import { TranslationStep } from './components/steps/TranslationStep'
import { NarrationStep } from './components/steps/NarrationStep'
import { ExportStep } from './components/steps/ExportStep'
import { useProjectStore } from './stores/projectStore'
import { useCueStore } from './stores/cueStore'

export const App: React.FC = () => {
  const activeStep = useProjectStore((s) => s.activeStep)
  const loadProject = useProjectStore((s) => s.loadProject)
  const setCues = useCueStore((s) => s.setCues)

  // Attempt to load default project on initial mount if available
  useEffect(() => {
    loadProject('prj_20261117_001').then((success) => {
      if (success) {
        const loaded = useProjectStore.getState().project
        if (loaded?.cues) {
          setCues(loaded.cues)
        }
      }
    })
  }, [loadProject, setCues])

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
