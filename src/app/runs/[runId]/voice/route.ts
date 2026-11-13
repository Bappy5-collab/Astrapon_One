import { type NextRequest } from "next/server";

import { isLocale } from "@/lib/i18n/messages";
import { getAuth } from "@/server/auth/session";
import { runVoiceLines } from "@/server/voice/script";
import { speak } from "@/server/voice/tts";

/**
 * Audio for one line of a run's spoken summary (?line=0&lang=en). The line is rebuilt here from
 * the caller's own stored result (RLS), so only Astrapon's summary sentences are ever spoken and
 * nobody can send other text through the server's voice key.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/runs/[runId]/voice">) {
  const { runId } = await ctx.params;
  const err = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return err("Unknown run.", 404);
  const line = Number(req.nextUrl.searchParams.get("line"));
  const lang = req.nextUrl.searchParams.get("lang");
  if (!Number.isInteger(line) || line < 0 || line > 50 || !isLocale(lang)) return err("Bad request.", 400);

  const auth = await getAuth();
  if (auth.state === "unreachable") return err("The account service did not respond. Try again.", 503);
  if (auth.state !== "signed_in") return err("Sign in to listen to your runs.", 401);
  const lines = await runVoiceLines(auth.supabase, runId, lang);
  if (!lines) return err("Run not found.", 404);

  const text = lines[line]?.text;
  if (!text) return err("No such line.", 404);
  const out = await speak({ userId: auth.userId, text, locale: lang });
  if (!out.ok) return err(`The voice could not be made: ${out.reason}.`, out.status);
  return new Response(out.audio as BodyInit, {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(out.audio.byteLength), "Cache-Control": "private, max-age=600" },
  });
}
