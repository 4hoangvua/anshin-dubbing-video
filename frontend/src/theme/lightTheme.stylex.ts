import * as stylex from '@stylexjs/stylex';
import { tokens } from './tokens.stylex';

/**
 * Light Theme (For high-brightness environments)
 */
export const lightTheme = stylex.createTheme(tokens, {
  bgApp: '#f8fafc',
  bgSurface0: '#ffffff',
  bgSurface1: '#f1f5f9',
  bgSurface2: '#e2e8f0',
  bgSurfaceActive: '#cbd5e1',
  bgSurfaceMuted: '#eef2f6',

  borderSubtle: '#e2e8f0',
  borderStrong: '#cbd5e1',
  borderFocus: '#2563eb',

  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  accentPrimary: '#2563eb',
  accentHover: '#1d4ed8',
  accentPressed: '#1e40af',
  accentSuccess: '#16a34a',
  accentWarning: '#d97706',
  accentDanger: '#dc2626',

  timelineRulerBg: '#e2e8f0',
  timelineRulerText: '#64748b',
  timelineTrackBg: '#f8fafc',
  timelineTrackBorder: '#e2e8f0',
  timelinePlayhead: '#dc2626',
  timelineCueBox: '#dbeafe',
  timelineCueBoxBorder: '#3b82f6',
  timelineCueSelected: '#93c5fd',
  timelineWaveform: '#059669',

  radiusSm: '4px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusFull: '9999px',
});
