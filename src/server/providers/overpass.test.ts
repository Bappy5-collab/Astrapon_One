import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWaterGeometry, OVERPASS_INSTANCES } from "./overpass";

const box = { west: 88.55, south: 24.34, east: 88.65, north: 24.42 };
const good = JSON.stringify({ elements: [{ type: "node", id: 1, lat: 24.4, lon: 88.6, tags: { natural: "spring" } }], osm3s: { timestamp_osm_base: "2026-11-09T00:00:00Z" } });
const [first, second] = OVERPASS_INSTANCES as [string, string];

/** Never answers; rejects only when the request is cancelled. */
function hang(init: RequestInit, aborted: string[], url: string) {
  return new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => {
      aborted.push(url);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

describe("fetchWaterGeometry", () => {
  beforeEach(() => vi.stubEnv("ASTRAPON_RETRY_BASE_MS", "1"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the first good answer and cancels the slower server", async () => {
    const aborted: string[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => (url === first ? hang(init, aborted, url) : Promise.resolve(new Response(good))));
    const res = await fetchWaterGeometry(box);
    expect(res.ok && res.endpoint).toBe(second);
    await vi.waitFor(() => expect(aborted).toEqual([first]));
  });

  it("uses the second server when the first fails quickly", async () => {
    vi.stubGlobal("fetch", (url: string) => Promise.resolve(url === first ? new Response("busy", { status: 502 }) : new Response(good)));
    const res = await fetchWaterGeometry(box);
    expect(res.ok && res.endpoint).toBe(second);
  });

  it("retries a quick 502 on the same server", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (url === second) return hang(init, [], url);
      calls += 1;
      return Promise.resolve(calls < 3 ? new Response("busy", { status: 502 }) : new Response(good));
    });
    const res = await fetchWaterGeometry(box);
    expect(res.ok && res.endpoint).toBe(first);
    expect(calls).toBe(3);
  });

  it("reports failure when every server fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("busy", { status: 502 })));
    const res = await fetchWaterGeometry(box);
    expect(res.ok).toBe(false);
  });

  it("stops at the deadline and cancels the requests", async () => {
    const aborted: string[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => hang(init, aborted, url));
    const res = await fetchWaterGeometry(box, 20);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("did not answer");
    await vi.waitFor(() => expect(aborted.sort()).toEqual([...OVERPASS_INSTANCES].sort()));
  });
});
