import React from 'react'
import {
  Sparkles,
  Languages,
  Mic,
  Share2,
  CheckCircle2
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useCueStore } from '../stores/cueStore'

interface StepDef {
  id: 1 | 2 | 3 | 4
  title: string
  subtitle: string
  icon: React.ElementType
}

const STEPS: StepDef[] = [
  {
    id: 1,
    title: '1. Nhận diện',
    subtitle: 'ASR / OCR',
    icon: Sparkles
  },
  {
    id: 2,
    title: '2. Dịch thuật',
    subtitle: 'Context MT',
    icon: Languages
  },
  {
    id: 3,
    title: '3. Lồng tiếng',
    subtitle: 'VieNeu-TTS',
    icon: Mic
  },
  {
    id: 4,
    title: '4. Xuất video',
    subtitle: 'Mix & Export',
    icon: Share2
  }
]

export const StepWizard: React.FC = () => {
  const activeStep = useProjectStore((s) => s.activeStep)
  const setActiveStep = useProjectStore((s) => s.setActiveStep)
  const cues = useCueStore((s) => s.cues)

  // Status badges
  const translatedCount = cues.filter((c) => !!c.translatedText?.trim()).length
  const synthesizedCount = cues.filter((c) => !!c.audioFile).length

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between gap-2 shrink-0 select-none">
      <div className="grid grid-cols-4 gap-2 w-full">
        {STEPS.map((step) => {
          const isActive = activeStep === step.id
          const isDone =
            (step.id === 1 && cues.length > 0) ||
            (step.id === 2 && translatedCount > 0 && translatedCount === cues.length) ||
            (step.id === 3 && synthesizedCount > 0 && synthesizedCount === cues.length)
          const Icon = step.icon

          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition border ${
                isActive
                  ? 'bg-indigo-600/15 border-indigo-500/60 text-white shadow-sm'
                  : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-xs font-semibold ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md'
                    : isDone
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/60'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isDone && !isActive ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-medium truncate ${
                      isActive ? 'text-indigo-300' : 'text-slate-200'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {step.id === 1 && cues.length > 0
                    ? `${cues.length} câu`
                    : step.id === 2 && translatedCount > 0
                    ? `${translatedCount}/${cues.length} dịch`
                    : step.id === 3 && synthesizedCount > 0
                    ? `${synthesizedCount}/${cues.length} audio`
                    : step.subtitle}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
