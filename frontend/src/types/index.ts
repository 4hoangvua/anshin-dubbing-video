/**
 * API Contract & Data Types for Video Dubbing Studio
 * Defined according to docs/API_CONTRACT.md
 */

export interface VideoInfo {
  filePath: string;
  fileName: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
}

export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DubbingSettings {
  sourceLang: string;
  targetLang: string;
  recognitionMode: 'asr' | 'ocr';
  asrModel: string;
  ocrRegion?: OcrRegion;
  translationGenre: string;
  translationPersona: string;
  voiceEngine: string;
  defaultVoiceId: string;
  autoMatchDuration: boolean;
  borrowGap: boolean;
  maxGapBorrowRatio?: number;
  maxBorrowSeconds?: number;
  autoDucking: boolean;
  duckingVolume: number;
  duckAttackMs: number;
  duckReleaseMs: number;
  sourceVolumeDb: number;
  ttsVolumeDb: number;
  exportSubtitleType: 'soft' | 'hard';
  videoCodec?: string;
  resolution?: string;
}

export interface SpeakerProfile {
  id: string; // e.g. "SPEAKER_00"
  name: string;
  color: string;
  gender: 'female' | 'male' | 'neutral';
  voiceId: string;
  pitch: number;
  speed: number;
  selfPronoun?: string;
  addressPronoun?: string;
}

export interface CueItem {
  id: number;
  startTime: number;
  endTime: number;
  duration?: number;
  originalText: string;
  translatedText?: string;
  speakerId: string;
  confidence?: number;
  isContinuation?: boolean;
  audioFile?: string;
  audioDuration?: number;
  speed?: number;
  playbackRate?: number;
  needsReview?: boolean;
  placedStartTime?: number;
  placedEndTime?: number;
  isCollisionShifted?: boolean;
  status?: 'pending' | 'synthesizing' | 'ready' | 'error';
  recommendedTtsSpeedRate?: number;
}

export interface ExportInfo {
  exportedFilePath?: string;
  exportedAt?: string;
  exportDurationSec?: number;
  fileSizeBytes?: number;
}

export interface Project {
  version: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number; // 1 | 2 | 3 | 4
  videoInfo: VideoInfo;
  settings: DubbingSettings;
  speakers: SpeakerProfile[];
  cues: CueItem[];
  exportInfo?: ExportInfo;
}

export interface HealthStatus {
  status: string;
  version: string;
  timestamp: string;
  system: {
    os: string;
    python: string;
    cuda_available: boolean;
    device_name: string;
    total_vram_mb: number;
    free_vram_mb: number;
  };
  modules: {
    asr: { available: boolean; path: string };
    mt: { available: boolean; path: string };
    tts: { available: boolean; path: string };
  };
}

export interface SSEProgressEvent {
  step?: number;
  task?: string;
  percent: number;
  stage?: string;
  message?: string;
  processedSec?: number;
  totalSec?: number;
  synopsis?: string;
  completedScenes?: number;
  totalScenes?: number;
  currentIndex?: number;
  cueId?: number;
  clipDuration?: number;
  audioUrl?: string;
  cuesCount?: number;
  cues?: CueItem[];
  benchmark?: { vramPeakMb: number; inferenceTimeSec: number };
  totalClipsGenerated?: number;
  clipsDir?: string;
  outputVideoPath?: string;
  outputVideoUrl?: string;
  fileSizeBytes?: number;
  durationSec?: number;
  error?: {
    code: string;
    message: string;
    step?: number;
    details?: Record<string, unknown>;
  };
}

export interface Step1RecognizeRequest {
  projectId: string;
  mode: 'asr' | 'ocr';
  model?: string;
  beamSize?: number;
  lang?: string;
  vad?: boolean;
  vadThreshold?: number;
  smartSplit?: boolean;
  maxPause?: number;
  maxDuration?: number;
}

export interface Step2TranslateRequest {
  projectId: string;
  genre: string;
  persona: string;
  srcLang: string;
  tgtLang: string;
  reconstruct?: boolean;
  stylePrompt?: string;
}

export interface Step2TranslateSingleRequest {
  projectId: string;
  cueId: number;
  sourceText: string;
  targetLang: string;
  persona?: string;
  customInstruction?: string;
}

export interface Step2TranslateSingleResponse {
  cueId: number;
  translatedText: string;
  recommendedSpeedRate?: number;
}

export interface Step3SynthesizeRequest {
  projectId: string;
  voiceId?: string;
  device?: string;
  autoMatchDuration?: boolean;
  borrowGap?: boolean;
  speed?: number;
}

export interface Step3SynthesizeSingleRequest {
  projectId: string;
  cueId: number;
  text: string;
  voiceId: string;
  speed?: number;
}

export interface Step3SynthesizeSingleResponse {
  cueId: number;
  audioFile: string;
  audioDuration: number;
  audioUrl: string;
  synthesisTimeSec?: number;
}

export interface Step4ExportRequest {
  projectId: string;
  autoDucking?: boolean;
  duckingVolume?: number;
  duckAttackMs?: number;
  duckReleaseMs?: number;
  sourceVolumeDb?: number;
  ttsVolumeDb?: number;
  exportSubtitleType?: 'soft' | 'hard';
  resolution?: string;
  videoCodec?: string;
}

export interface Step4ExportResponse {
  percent: number;
  outputVideoPath: string;
  outputVideoUrl: string;
  fileSizeBytes: number;
  durationSec: number;
}

export interface ModelItem {
  id: string;
  category: 'asr' | 'mt' | 'tts';
  name: string;
  size_mb: number;
  vram_required_mb: number;
  hardware_tier: 'cpu' | 'recommended' | 'high';
  description: string;
  download_url: string;
  dest_dir: string;
  target_file: string;
  is_downloaded: boolean;
  local_path: string;
  local_size_mb: number;
}

export interface HardwareInfo {
  cuda_available: boolean;
  device_name: string;
  total_ram_gb: number;
  total_vram_mb: number;
  free_vram_mb: number;
  suggested_tier: 'cpu' | 'recommended' | 'high';
}

export interface ModelRecommendationsResponse {
  hardware: HardwareInfo;
  recommended: {
    tier: 'cpu' | 'recommended' | 'high';
    asrModel: string;
    mtModel: string;
    ttsModel: string;
  };
}

export interface ModelStatusResponse {
  hardware: HardwareInfo;
  models: ModelItem[];
}
