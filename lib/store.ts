"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DogProfile, StayEvent, VoicePath } from "./types";

interface StayState {
  /** The user's own ElevenLabs key. Browser only — never sent anywhere but our own routes. */
  elKey: string;
  /** Optional override so a visitor can skip our shared Gemini quota. */
  geminiKey: string;
  voiceId: string;
  voiceName: string;
  path: VoicePath | null;
  profile: DogProfile | null;
  sensitivity: number;

  setElKey: (k: string) => void;
  setGeminiKey: (k: string) => void;
  setVoice: (id: string, name: string, path: VoicePath) => void;
  setProfile: (p: DogProfile) => void;
  setSensitivity: (v: number) => void;
  reset: () => void;

  /** True once there is enough saved to start a real session. */
  isReady: () => boolean;
}

export const useStay = create<StayState>()(
  persist(
    (set, get) => ({
      elKey: "",
      geminiKey: "",
      voiceId: "",
      voiceName: "",
      path: null,
      profile: null,
      sensitivity: 0.5,

      setElKey: (elKey) => set({ elKey: elKey.trim() }),
      setGeminiKey: (geminiKey) => set({ geminiKey: geminiKey.trim() }),
      setVoice: (voiceId, voiceName, path) => set({ voiceId, voiceName, path }),
      setProfile: (profile) => set({ profile }),
      setSensitivity: (sensitivity) => set({ sensitivity }),
      reset: () =>
        set({
          elKey: "",
          geminiKey: "",
          voiceId: "",
          voiceName: "",
          path: null,
          profile: null,
          sensitivity: 0.5,
        }),

      isReady: () => {
        const s = get();
        return Boolean(s.elKey && s.voiceId && s.profile?.name);
      },
    }),
    {
      name: "stay.session",
      version: 1,
    },
  ),
);

/* ── Session events ────────────────────────────────────────────
   Kept out of the persisted store on purpose: a session log belongs
   to one sitting, and writing every frame to localStorage would be
   both wasteful and wrong.                                          */

interface SessionState {
  events: StayEvent[];
  startedAt: number | null;
  push: (e: Omit<StayEvent, "id" | "at"> & { at?: number }) => StayEvent;
  begin: () => void;
  end: () => void;
  clear: () => void;
}

let eventSeq = 0;

export const useSession = create<SessionState>((set) => ({
  events: [],
  startedAt: null,

  push: (partial) => {
    const event: StayEvent = {
      id: `e${++eventSeq}`,
      at: partial.at ?? Date.now(),
      ...partial,
    } as StayEvent;
    set((s) => ({ events: [...s.events, event] }));
    return event;
  },

  begin: () =>
    set({
      startedAt: Date.now(),
      events: [{ id: `e${++eventSeq}`, at: Date.now(), kind: "session-start" }],
    }),

  end: () =>
    set((s) => ({
      events: [...s.events, { id: `e${++eventSeq}`, at: Date.now(), kind: "session-end" }],
    })),

  clear: () => set({ events: [], startedAt: null }),
}));
