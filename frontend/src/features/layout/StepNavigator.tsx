import React from 'react';
import { Sparkles, Languages, Mic, Share2, Check } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';

interface StepItem {
  id: 1 | 2 | 3 | 4;
  title: string;
  subtitle: string;
  icon: React.ElementType;
}

const STEPS: StepItem[] = [
  { id: 1, title: '1. Nhận diện', subtitle: 'ASR / OCR', icon: Sparkles },
  { id: 2, title: '2. Dịch thuật', subtitle: 'Hy-MT2 1.8B', icon: Languages },
  { id: 3, title: '3. Lồng tiếng', subtitle: 'VieNeu TTS', icon: Mic },
  { id: 4, title: '4. Xuất video', subtitle: 'Ducking & Mux', icon: Share2 },
];

export const StepNavigator: React.FC = () => {
  const activeStep = useProjectStore((s) => s.activeStep);
  const setActiveStep = useProjectStore((s) => s.setActiveStep);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];

  const hasRecognized = cues.length > 0;
  const hasTranslated = hasRecognized && cues.some((c) => !!c.translatedText);
  const hasSynthesized = hasRecognized && cues.some((c) => !!c.audioFile);

  const stepStatus: Record<number, boolean> = {
    1: hasRecognized,
    2: hasTranslated,
    3: hasSynthesized,
    4: false,
  };

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-surface-0)',
        borderBottom: '1px solid var(--border-subtle)',
        userSelect: 'none',
      }}
    >
      {STEPS.map((step) => {
        const isActive = activeStep === step.id;
        const isDone = stepStatus[step.id];
        const Icon = step.icon;

        return (
          <button
            key={step.id}
            onClick={() => setActiveStep(step.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: `1px solid ${isActive ? 'var(--accent-primary)' : 'transparent'}`,
              backgroundColor: isActive ? 'var(--bg-surface-2)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isActive
                  ? 'var(--accent-primary)'
                  : isDone
                  ? 'rgba(34, 197, 94, 0.2)'
                  : 'var(--bg-surface-1)',
                color: isActive
                  ? '#ffffff'
                  : isDone
                  ? 'var(--accent-success)'
                  : 'var(--text-muted)',
              }}
            >
              {isDone && !isActive ? <Check size={14} /> : <Icon size={14} />}
            </div>

            <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{step.title}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{step.subtitle}</div>
            </div>
          </button>
        );
      })}
    </nav>
  );
};
