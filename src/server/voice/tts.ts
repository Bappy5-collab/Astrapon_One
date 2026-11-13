import "server-only";

import { createHash } from "node:crypto";

import { getServerSecrets } from "@/server/env";

/**
 * Text-to-speech for the spoken run summary, through OpenAI's speech endpoint. Server-side only:
 * the key never reaches the browser. The text sent is always one of Astrapon's own summary lines
 * (built by voiceScript from the stored result), never free text from the browser. Bounded: a
 * timeout, a per-user limit on uncached lines, a byte-capped in-memory cache, and one request per
 * line even when the browser asks twice at once.
 */

export const TTS_MODEL = "gpt-4o-mini-tts";
const VOICE = "coral";
const INSTRUCTIONS: Record<"en" | "bn", string> = {
  en: "Speak clearly and warmly, at a calm, even pace, like an agricultural adviser explaining results to a farmer. Read numbers slowly.",
  bn: "Speak in clear, natural Bangla (Bengali) as spoken in Bangladesh, warmly and at a calm, even pace, like an agricultural adviser explaining results to a farmer. Read numbers slowly in Bangla.",
};

const RATE = { windowMs: 10 * 60_000, max: 80 };
const CACHE_BYTES = 48 * 1024 * 1024;
const hits = new Map<string, number[]>();
const cache = new Map<string, Uint8Array>();
let cacheBytes = 0;
const inflight = new Map<string, Promise<TtsOutcome>>();

export type TtsOutcome = { ok: true; audio: Uint8Array } | { ok: false; status: number; reason: string };

export function voiceConfigured(): boolean {
  return Boolean(getServerSecrets().openaiApiKey);
}

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE.windowMs);
  const over = recent.length >= RATE.max;
  if (!over) recent.push(now);
  hits.set(userId, recent);
  return over;
}

function remember(key: string, audio: Uint8Array) {
  cache.set(key, audio);
  cacheBytes += audio.byteLength;
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value!;
    cacheBytes -= cache.get(oldest)!.byteLength;
    cache.delete(oldest);
  }
}

export async function speak(args: { userId: string; text: string; locale: "en" | "bn" }): Promise<TtsOutcome> {
  const apiKey = getServerSecrets().openaiApiKey;
  if (!apiKey) return { ok: false, status: 503, reason: "voice is not configured" };
  const key = createHash("sha256").update(`${TTS_MODEL}|${VOICE}|${args.locale}|${args.text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) {
    // Refresh its place so often-heard lines stay cached.
    cache.delete(key);
    cache.set(key, hit);
    return { ok: true, audio: hit };
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  if (limited(args.userId)) return { ok: false, status: 429, reason: "too many voice requests in a short time; wait a few minutes" };

  const job = (async (): Promise<TtsOutcome> => {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: TTS_MODEL, voice: VOICE, input: args.text, instructions: INSTRUCTIONS[args.locale], response_format: "mp3" }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (!res.ok) {
        // Log the provider's own error code (never the key or the text) so a hosted failure can be diagnosed.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
        console.warn(`[voice] OpenAI speech failed: HTTP ${res.status} ${body?.error?.code ?? body?.error?.type ?? ""}`.trim());
        if (body?.error?.code === "insufficient_quota") return { ok: false, status: 402, reason: "the voice account has no credit left (OpenAI billing)" };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, status: 502, reason: "the server's voice credentials were rejected" };
      if (res.status === 429) return { ok: false, status: 429, reason: "the voice provider is busy or the account has no credit left" };
      if (!res.ok) return { ok: false, status: 502, reason: `the voice provider returned an error (${res.status})` };
      const audio = new Uint8Array(await res.arrayBuffer());
      if (!audio.byteLength) return { ok: false, status: 502, reason: "the voice provider returned no audio" };
      remember(key, audio);
      return { ok: true, audio };
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      // A bad header's error message can quote the header value, so the key is scrubbed before logging.
      const msg = e instanceof Error ? e.message.split(apiKey).join("[key]").replace(/sk-[\w-]+/g, "[key]").slice(0, 160) : "unknown error";
      console.warn(`[voice] OpenAI speech request threw: ${e instanceof Error ? e.name : "Error"}: ${msg}`);
      return { ok: false, status: timeout ? 504 : 502, reason: timeout ? "the voice provider did not answer in time" : "the voice provider could not be reached" };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
