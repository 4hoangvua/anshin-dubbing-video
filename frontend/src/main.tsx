import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/global.css';
import './index.css';
import App from './App.tsx';
import { usePlayerStore } from './stores/playerStore';
import { useCueStore } from './stores/cueStore';
import { useProjectStore } from './stores/projectStore';
import { useTimelineStore } from './stores/timelineStore';
import { useUIStore } from './stores/uiStore';

if (import.meta.env.DEV) {
  (window as any).__stores = {
    player: usePlayerStore,
    cue: useCueStore,
    project: useProjectStore,
    timeline: useTimelineStore,
    ui: useUIStore,
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
