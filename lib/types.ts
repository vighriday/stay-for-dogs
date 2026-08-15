/** How Stay got hold of the owner's voice. */
export type VoicePath = "clone" | "byov" | "demo";

/** What a stored ElevenLabs key is actually allowed to do. */
export interface VoiceCapabilities {
  tier: string;
  /** Paid plans can create a voice through the API. Free plans cannot. */
  canCreateVoice: boolean;
  charactersLeft: number;
  characterLimit: number;
  voiceSlotsUsed: number;
  voiceSlotLimit: number;
}

export interface DogProfile {
  name: string;
  nickname: string;
  likes: string[];
  bannedWords: string[];
}

export type Mood = "calm" | "reassure" | "settle";

/** Which rule released a response — see the wait-for-quiet state machine. */
export type SpeakTrigger = "settled" | "ceiling" | "manual";

export type EventKind =
  | "session-start"
  | "session-end"
  | "upset"
  | "settled"
  | "spoke"
  | "held";

export interface StayEvent {
  id: string;
  at: number;
  kind: EventKind;
  /** Peak loudness during the episode, dBFS. Negative. */
  peakDb?: number;
  /** Share of energy inside the 300–2500 Hz band, 0–1. */
  bandRatio?: number;
  /** How long the dog vocalised, ms. */
  durationMs?: number;
  line?: string;
  trigger?: SpeakTrigger;
  /** True when the line came from the offline bank rather than Gemini. */
  fromBank?: boolean;
}

export interface BehaviourScores {
  pacingPercent: number;
  doorFixations: number;
  vocalEvents: number;
  settleLatencySec: number | null;
  notes: string;
}

export type VocalKind = "whine" | "separation-bark" | "alert-bark" | "howl" | "other";

export interface VocalReading {
  kind: VocalKind;
  confidence: number;
  note: string;
}

/** Every route failure has this shape. No bare 500s. */
export interface ApiError {
  error: { code: string; message: string; hint?: string };
}

export const DETECTOR_DEFAULTS = {
  /** Frame size at 48 kHz ≈ 43 ms. */
  frameSize: 2048,
  /** Barks and whines live here. Traffic rumble and HVAC do not. */
  bandLowHz: 300,
  bandHighHz: 2500,
  minBandRatio: 0.55,
  /**
   * Two ways an episode can start, because dogs make two different noises.
   *
   * Barking is repetitive: separate onsets with gaps between them. Counting
   * onsets inside a window catches that, and it is also what keeps a door
   * slam out — a slam is loud and in-band, but it is one event, not three.
   *
   * Whining and howling are continuous instead of repetitive, so an unbroken
   * stretch counts on its own.
   */
  onsetWindowMs: 1500,
  onsetCount: 3,
  continuousMs: 1200,
  /** Ignore a second onset inside this gap — a slam's ringing tail is one event. */
  refractoryMs: 200,
  /**
   * Voicing gate. A bark or whine has a pitch, so its waveform repeats; a
   * door slam is a broadband transient with none. Measured across the test
   * clips, this took false positives from four of seven to zero without
   * losing a single dog. 0.75 sits in the middle of the plateau where that
   * holds, rather than on its edge.
   */
  minPeriodicity: 0.75,
  pitchMinHz: 140,
  pitchMaxHz: 1200,
  /** Quiet this long after an episode releases a response. */
  quietMs: 2500,
  /** Unbroken noise this long responds anyway — never ignore a frantic dog. */
  ceilingMs: 20_000,
  /** No second response inside this window. */
  cooldownMs: 90_000,
  /** Detection stays deaf this long after Stay's own voice stops. */
  playbackTailMs: 3000,
  /** Episode ends after this much quiet with no response. */
  episodeEndMs: 10_000,
} as const;

export const LIMITS = {
  minSampleSeconds: 60,
  targetSampleSeconds: 180,
  maxClipSeconds: 60,
  maxClipBytes: 20 * 1024 * 1024,
  maxAudioClipBytes: 5 * 1024 * 1024,
  lineBufferTarget: 10,
  lineBufferFloor: 4,
  maxLineWords: 14,
  minLineWords: 3,
} as const;
