import { CLINIC, TREATMENTS } from '../lib/clinic.mjs';
import { llmReady, providerChain } from '../lib/llm.mjs';
import { sttReady } from '../lib/stt.mjs';
import { cacheStats, elevenStats, ttsProvider, ttsReady } from '../lib/tts.mjs';
import { cors, sendJson } from '../lib/http.mjs';

/** Tells the widget which pipeline to use before it records anything. */
export default function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.end();
  const llm = llmReady();
  sendJson(res, 200, {
    ok: true,
    clinic: CLINIC.name,
    mode: llm ? 'live' : 'demo',
    providers: {
      llm: llm ? providerChain()[0].model : null,
      llmFallback: providerChain()[1]?.model ?? null,
      stt: sttReady() ? (process.env.STT_MODEL || 'whisper-large-v3-turbo') : null,
      tts: ttsReady() ? ttsProvider() : null,
    },
    // The browser can cover for a missing server key: Chrome/Edge ship free
    // speech recognition and speech synthesis.
    clientFallbacks: {
      stt: !sttReady(),
      tts: !ttsReady(),
    },
    voices: {
      ur: process.env.TTS_VOICE_UR || 'ur-PK-UzmaNeural',
      en: process.env.TTS_VOICE_EN || 'en-US-JennyNeural',
      ps: process.env.TTS_VOICE_PS || 'ps-AF-LatifaNeural',
    },
    treatments: TREATMENTS.map((t) => ({ id: t.id, label: t.label })),
    ttsCache: cacheStats(),
    elevenlabs: elevenStats(),
  });
}
