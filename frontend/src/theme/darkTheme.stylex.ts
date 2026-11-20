import * as stylex from '@stylexjs/stylex';
import { tokens } from './tokens.stylex';

/**
 * Dark Studio Theme (Default theme for professional video editing)
 */
export const darkTheme = stylex.createTheme(tokens, {
  bgApp: '#0f1117',
  bgSurface0: '#161922',
  bgSurface1: '#1e2230',
  bgSurface2: '#282e42',
  bgSurfaceActive: '#343c56',
  bgSurfaceMuted: '#1a1d26',

  borderSubtle: '#262c3d',
  borderStrong: '#3e4763',
  borderFocus: '#3b82f6',

  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0f1117',

  accentPrimary: '#3b82f6',
  accentHover: '#2563eb',
  accentPressed: '#1d4ed8',
  accentSuccess: '#22c55e',
  accentWarning: '#f59e0b',
  accentDanger: '#ef4444',

  timelineRulerBg: '#13161f',
  timelineRulerText: '#64748b',
  timelineTrackBg: '#161922',
  timelineTrackBorder: '#232836',
  timelinePlayhead: '#ef4444',
  timelineCueBox: '#1e3a5f',
  timelineCueBoxBorder: '#3b82f6',
  timelineCueSelected: '#2563eb',
  timelineWaveform: '#10b981',

  radiusSm: '4px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusFull: '9999px',
});
