import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Badge } from '../../design-system/Badge';

interface SpeakerSelectProps {
  currentSpeakerId: string;
  onSelect: (speakerId: string) => void;
  disabled?: boolean;
}

export const SpeakerSelect: React.FC<SpeakerSelectProps> = ({
  currentSpeakerId,
  onSelect,
  disabled = false,
}) => {
  const speakers = useProjectStore((s) => s.project?.speakers || []);
  const activeSpeaker = speakers.find((s) => s.id === currentSpeakerId) || {
    id: currentSpeakerId,
    name: currentSpeakerId,
    color: '#3b82f6',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={currentSpeakerId}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          width: '100%',
          height: '100%',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {speakers.map((spk) => (
          <option key={spk.id} value={spk.id} style={{ backgroundColor: '#161922', color: '#fff' }}>
            {spk.name} ({spk.id})
          </option>
        ))}
      </select>
      <Badge color={activeSpeaker.color} style={{ cursor: 'pointer' }}>
        {activeSpeaker.name}
      </Badge>
    </div>
  );
};
