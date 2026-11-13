"use client";

import GraphicEqRoundedIcon from "@mui/icons-material/GraphicEqRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import GlobalStyles from "@mui/material/GlobalStyles";
import IconButton from "@mui/material/IconButton";
import Slide from "@mui/material/Slide";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, keyframes } from "@mui/material/styles";
import { useCallback, useEffect, useRef, useState } from "react";

import type { VoiceLine } from "@/domain/simulation/voice-script";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { color, elevation, motion, radius, tokens } from "@/theme/tokens";

type Phase = "idle" | "loading" | "playing" | "paused" | "done" | "failed";

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 ${alpha(tokens.lime[400], 0.7)}; }
  70% { box-shadow: 0 0 0 14px ${alpha(tokens.lime[400], 0)}; }
  100% { box-shadow: 0 0 0 0 ${alpha(tokens.lime[400], 0)}; }
`;
const PREFETCH = 3;

/**
 * "Listen to your result": an AI voice reads the run's summary line by line. While a line plays,
 * the part of the page it talks about is scrolled into view and highlighted, and a caption bar
 * shows the exact sentence. The audio for every line is fetched ahead (a few at a time) so lines
 * follow each other without a pause. The text comes from the server (voiceScript), not from AI.
 */
export function VoiceResult({ runId, lines }: { runId: string; lines: VoiceLine[] }) {
  const t = useT();
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clips = useRef<(Promise<string> | undefined)[]>([]);
  const urls = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const session = useRef(0);
  const active = useRef<HTMLElement | null>(null);
  const playNext = useRef<(i: number, mine: number) => void>(() => {});
  // The first line is fetched as soon as the pointer or keyboard reaches the button, so a click
  // starts speaking with little or no wait.
  const warm = useRef<Promise<Blob> | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const highlight = useCallback((target: string | null) => {
    active.current?.removeAttribute("data-voice-active");
    active.current = null;
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    el.setAttribute("data-voice-active", "1");
    active.current = el;
    // Centre the part in the space between the site header and the caption bar, so the bar never
    // covers what is being read (it is tall on a phone). A part taller than that space starts at its top.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const header = (document.querySelector("header")?.getBoundingClientRect().bottom ?? 72) + 12;
    const bar = barRef.current?.getBoundingClientRect().height ?? (window.innerWidth < 600 ? 190 : 130);
    const room = window.innerHeight - header - bar - 32;
    const r = el.getBoundingClientRect();
    const offset = r.height < room ? header + (room - r.height) / 2 : header;
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - offset), behavior: reduce ? "auto" : "smooth" });
  }, []);

  const cleanup = useCallback(() => {
    session.current++;
    abort.current?.abort();
    abort.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute("src");
    }
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    clips.current = [];
    highlight(null);
  }, [highlight]);

  useEffect(() => cleanup, [cleanup]);

  // Fetches line i once; later calls reuse the same promise.
  const clip = useCallback(
    (i: number): Promise<string> => {
      const have = clips.current[i];
      if (have) return have;
      const signal = abort.current!.signal;
      const early = i === 0 ? warm.current : null;
      warm.current = i === 0 ? null : warm.current;
      const blob = (early ?? Promise.reject(new Error("none"))).catch(() =>
        fetch(`/runs/${runId}/voice?line=${i}&lang=${locale}`, { signal }).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        }),
      );
      const p = blob.then((b) => {
        if (signal.aborted) throw new Error("stopped");
        const url = URL.createObjectURL(b);
        urls.current.push(url);
        return url;
      });
      p.catch(() => {});
      clips.current[i] = p;
      return p;
    },
    [runId, locale],
  );

  const playLine = useCallback(
    async (i: number, mine: number) => {
      if (mine !== session.current) return;
      if (i >= lines.length) {
        setPhase("done");
        setProgress(1);
        highlight(null);
        return;
      }
      setIndex(i);
      setProgress(0);
      highlight(lines[i]!.target);
      // Keep the next few lines downloading while this one plays.
      for (let k = i; k < Math.min(lines.length, i + PREFETCH); k++) void clip(k);
      let url: string;
      try {
        const ready = clips.current[i];
        const settled = await Promise.race([ready!.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 120))]);
        if (!settled && mine === session.current) setPhase("loading");
        url = await clip(i);
      } catch {
        if (mine === session.current) {
          setPhase("failed");
          highlight(null);
        }
        return;
      }
      if (mine !== session.current || !audio.current) return;
      audio.current.src = url;
      audio.current.onended = () => playNext.current(i + 1, mine);
      try {
        await audio.current.play();
        if (mine === session.current) setPhase("playing");
      } catch {
        if (mine === session.current) setPhase("failed");
      }
    },
    [lines, clip, highlight],
  );
  useEffect(() => {
    playNext.current = (i, mine) => void playLine(i, mine);
  }, [playLine]);

  const warmUp = () => {
    if (warm.current || phase !== "idle") return;
    const p = fetch(`/runs/${runId}/voice?line=0&lang=${locale}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    });
    p.catch(() => {
      if (warm.current === p) warm.current = null;
    });
    warm.current = p;
  };

  const start = () => {
    cleanup();
    const mine = session.current;
    abort.current = new AbortController();
    // Created inside the click so mobile browsers allow the following lines to play on their own.
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = "auto";
      audio.current.ontimeupdate = () => {
        const a = audio.current!;
        if (a.duration > 0) setProgress(a.currentTime / a.duration);
      };
    }
    setPhase("loading");
    void playLine(0, mine);
  };

  const stop = () => {
    cleanup();
    setPhase("idle");
    setIndex(0);
    setProgress(0);
  };

  const togglePause = () => {
    const a = audio.current;
    if (!a) return;
    if (phase === "playing") {
      a.pause();
      setPhase("paused");
    } else if (phase === "paused") {
      void a.play().then(() => setPhase("playing"));
    }
  };

  useEffect(() => {
    if (phase !== "playing" && phase !== "paused" && phase !== "loading") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!lines.length) return null;
  const busy = phase === "loading" || phase === "playing" || phase === "paused";
  const line = lines[index]!;
  const overall = (index + (phase === "done" ? 1 : progress)) / lines.length;

  return (
    <>
      <GlobalStyles
        styles={{
          '[id^="voice-"]': { outline: "3px solid transparent", outlineOffset: 4, transition: `outline-color ${motion.base}ms ${motion.easing}, box-shadow ${motion.slow}ms ${motion.easing}` },
          '[data-voice-active="1"]': { outlineColor: `${tokens.lime[500]} !important`, boxShadow: `0 0 0 10px ${alpha(tokens.lime[400], 0.28)} !important` },
        }}
      />

      {/* Launcher: mic icon and title at the top of the result. */}
      <Box
        className="no-print"
        sx={{ mb: 3, p: { xs: 1.75, md: 2 }, borderRadius: `${radius.lg}px`, border: `1px solid ${busy ? tokens.lime[500] : color.line}`, bgcolor: busy ? "#F4F9E6" : color.surfaceRaised, boxShadow: elevation.raised, transition: `background-color ${motion.base}ms, border-color ${motion.base}ms` }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <ButtonBase
            onClick={busy ? togglePause : start}
            onPointerEnter={warmUp}
            onFocus={warmUp}
            onTouchStart={warmUp}
            aria-label={busy ? (phase === "paused" ? t("voice.resume") : t("voice.pause")) : t("voice.title")}
            sx={{
              width: 56,
              height: 56,
              flexShrink: 0,
              borderRadius: "50%",
              bgcolor: busy ? tokens.forest[800] : tokens.lime[400],
              color: busy ? tokens.neutral[50] : tokens.forest[950],
              transition: `background-color ${motion.base}ms, transform ${motion.fast}ms`,
              "&:hover": { transform: "scale(1.05)" },
              animation: phase === "playing" ? `${pulse} 1.6s ${motion.easing} infinite` : "none",
            }}
          >
            {phase === "loading" ? <CircularProgress size={24} sx={{ color: "inherit" }} /> : phase === "playing" ? <GraphicEqRoundedIcon /> : phase === "paused" ? <PlayArrowRoundedIcon /> : <MicRoundedIcon sx={{ fontSize: 28 }} />}
          </ButtonBase>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <ButtonBase onClick={busy ? undefined : start} disabled={busy} sx={{ display: "block", textAlign: "left", borderRadius: `${radius.sm}px` }}>
              <Typography component="h2" variant="h6" sx={{ fontSize: "1.05rem" }}>
                {phase === "done" ? t("voice.replay") : t("voice.title")}
              </Typography>
            </ButtonBase>
            <Typography variant="body2" color="text.secondary">
              {phase === "loading" && index === 0 ? t("voice.loading") : phase === "failed" ? t("voice.failed") : t("voice.sub")}
            </Typography>
          </Box>
          {phase === "done" || phase === "failed" ? (
            <Tooltip title={t("voice.replay")}>
              <IconButton onClick={start} aria-label={t("voice.replay")}>
                <ReplayRoundedIcon />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Box>

      {/* Caption bar: what is being read, which section, and how far along. */}
      <Box className="no-print" sx={{ position: "fixed", zIndex: (th) => th.zIndex.snackbar, left: 0, right: 0, bottom: { xs: 12, md: 20 }, px: 1.5, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <Slide direction="up" in={busy} mountOnEnter unmountOnExit>
        <Box
          ref={barRef}
          role="region"
          aria-label={t("voice.title")}
          aria-live="polite"
          sx={{
            pointerEvents: "auto",
            width: "100%",
            maxWidth: 720,
            borderRadius: `${radius.lg + 4}px`,
            bgcolor: tokens.forest[900],
            color: tokens.neutral[100],
            boxShadow: elevation.overlay,
            overflow: "hidden",
          }}
        >
          <Box sx={{ height: 4, bgcolor: alpha(tokens.neutral[0], 0.12) }}>
            <Box sx={{ height: "100%", width: `${Math.round(overall * 1000) / 10}%`, bgcolor: tokens.lime[400], transition: `width 250ms linear` }} />
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", p: { xs: 1.5, md: 2 } }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="overline" sx={{ color: tokens.lime[400], lineHeight: 1.4, display: "block" }}>
                {t("voice.reading")} · {t(`voice.sec.${line.section}` as MessageKey)} · {index + 1}/{lines.length}
              </Typography>
              <Typography key={index} variant="body2" sx={{ color: tokens.neutral[0], fontSize: { xs: "0.9rem", md: "0.98rem" }, lineHeight: 1.5, animation: `voiceFade ${motion.slow}ms ${motion.easing}`, "@keyframes voiceFade": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } } }}>
                {line.text}
              </Typography>
            </Box>
            <Tooltip title={phase === "paused" ? t("voice.resume") : t("voice.pause")}>
              <span>
                <IconButton onClick={togglePause} disabled={phase === "loading"} aria-label={phase === "paused" ? t("voice.resume") : t("voice.pause")} sx={{ color: tokens.neutral[0], bgcolor: alpha(tokens.neutral[0], 0.1), "&:hover": { bgcolor: alpha(tokens.neutral[0], 0.2) } }}>
                  {phase === "loading" ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : phase === "paused" ? <PlayArrowRoundedIcon /> : <PauseRoundedIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("voice.stop")}>
              <IconButton onClick={stop} aria-label={t("voice.stop")} sx={{ color: tokens.neutral[0], bgcolor: alpha(tokens.neutral[0], 0.1), "&:hover": { bgcolor: alpha(tokens.neutral[0], 0.2) } }}>
                <StopRoundedIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      </Slide>
      </Box>
    </>
  );
}
