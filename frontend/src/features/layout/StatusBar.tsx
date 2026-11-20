import React from 'react';
import { Cpu, HardDrive, Wifi, WifiOff, FileText, Clock } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useCueStore } from '../../stores/cueStore';

export const StatusBar: React.FC = () => {
  const backendConnected = useProjectStore((s) => s.backendConnected);
  const gpuInfo = useProjectStore((s) => s.gpuInfo);
  const project = useProjectStore((s) => s.project);
  const rawCues = useCueStore((s) => s.cues);
  const cues = Array.isArray(rawCues) ? rawCues : [];

  const durationSec = project?.videoInfo?.duration || 0;
  const durationFormatted = `${Math.floor(durationSec / 60)}:${(durationSec % 60).toFixed(0).padStart(2, '0')}`;

  return (
    <footer
      style={{
        height: '28px',
        backgroundColor: 'var(--bg-surface-0)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Left: Backend & Hardware info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {backendConnected ? (
            <>
              <Wifi size={12} color="var(--accent-success)" />
              <span style={{ color: 'var(--text-secondary)' }}>Backend :8765</span>
            </>
          ) : (
            <>
              <WifiOff size={12} color="var(--accent-danger)" />
              <span style={{ color: 'var(--accent-danger)' }}>Mất kết nối Backend</span>
            </>
          )}
        </div>

        {gpuInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={12} color="var(--accent-primary)" />
            <span>{gpuInfo.device_name || 'CPU Mode'}</span>
            {gpuInfo.total_vram_mb > 0 && (
              <span style={{ color: 'var(--text-secondary)' }}>
                (VRAM: {gpuInfo.free_vram_mb}/{gpuInfo.total_vram_mb} MB)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Project stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FileText size={12} />
          <span>{cues.length} câu thoại</span>
        </div>
        {durationSec > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={12} />
            <span>Thời lượng: {durationFormatted}</span>
          </div>
        )}
        {project?.videoInfo?.fps && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <HardDrive size={12} />
            <span>{project.videoInfo.fps} FPS</span>
          </div>
        )}
      </div>
    </footer>
  );
};
