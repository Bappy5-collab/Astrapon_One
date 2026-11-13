import { inflateSync } from "node:zlib";

import { fetchText } from "./http";

/**
 * ISRIC SoilGrids 2.0 WCS (maps.isric.org): the fallback route for water-retention values when the
 * REST query is paused, slow or masked. One GetCoverage per layer × depth returns a tiny GeoTIFF of
 * the 250 m pixels in a box around the point. The values are the same mapped integers as the REST
 * service (10⁻³ cm³/cm³); 0 is nodata (ISRIC sets no nodata tag).
 */
export const SOILGRIDS_WCS = "https://maps.isric.org/mapserv";

export function wcsUrl(property: "wv0033" | "wv1500", depth: string, lat: number, lon: number, halfDeg: number): string {
  const p = new URLSearchParams({ map: `/map/${property}.map`, SERVICE: "WCS", VERSION: "2.0.1", REQUEST: "GetCoverage", COVERAGEID: `${property}_${depth}_mean`, FORMAT: "image/tiff", SUBSETTINGCRS: "http://www.opengis.net/def/crs/EPSG/0/4326", OUTPUTCRS: "http://www.opengis.net/def/crs/EPSG/0/4326" });
  p.append("SUBSET", `long(${(lon - halfDeg).toFixed(5)},${(lon + halfDeg).toFixed(5)})`);
  p.append("SUBSET", `lat(${(lat - halfDeg).toFixed(5)},${(lat + halfDeg).toFixed(5)})`);
  return `${SOILGRIDS_WCS}?${p}`;
}

/**
 * Reads the pixel values of a small single-band GeoTIFF as ISRIC serves them: little- or big-endian,
 * 16- or 32-bit signed/unsigned integers, uncompressed or Deflate, optional horizontal predictor,
 * strips or tiles. Anything else throws (never guessed).
 */
export function readSmallTiff(buf: Buffer): { width: number; height: number; values: number[] } {
  const le = buf.toString("latin1", 0, 2) === "II";
  if (!le && buf.toString("latin1", 0, 2) !== "MM") throw new Error("Not a TIFF");
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error("BigTIFF or unknown TIFF version");
  const ifd = u32(4);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size) continue;
    const at = count * size <= 4 ? e + 8 : u32(e + 8);
    tags.set(tag, Array.from({ length: count }, (_, k) => (size === 2 ? u16(at + k * 2) : u32(at + k * 4))));
  }
  const one = (t: number, d?: number) => tags.get(t)?.[0] ?? d;
  const width = one(256)!, height = one(257)!, bits = one(258, 1)!, compression = one(259, 1)!, predictor = one(317, 1)!, format = one(339, 1)!, spp = one(277, 1)!;
  if (spp !== 1 || (bits !== 16 && bits !== 32) || (compression !== 1 && compression !== 8 && compression !== 32946) || (predictor !== 1 && predictor !== 2)) throw new Error(`Unsupported TIFF layout (bits ${bits}, compression ${compression}, predictor ${predictor}, samples ${spp})`);
  const tiled = tags.has(322);
  const bw = tiled ? one(322)! : width, bh = tiled ? one(323)! : one(278, height)!;
  const offsets = tags.get(tiled ? 324 : 273)!, counts = tags.get(tiled ? 325 : 279)!;
  const across = Math.ceil(width / bw);
  const bytes = bits / 8;
  const read = (b: Buffer, o: number) => (bits === 16 ? (format === 2 ? (le ? b.readInt16LE(o) : b.readInt16BE(o)) : le ? b.readUInt16LE(o) : b.readUInt16BE(o)) : format === 2 ? (le ? b.readInt32LE(o) : b.readInt32BE(o)) : le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const wrap = (v: number) => (bits === 16 ? (format === 2 ? ((v + 32768) & 0xffff) - 32768 : v & 0xffff) : format === 2 ? v | 0 : v >>> 0);
  const values = new Array<number>(width * height).fill(0);
  offsets.forEach((off, k) => {
    const raw = buf.subarray(off, off + counts[k]!);
    const data = compression === 1 ? raw : inflateSync(raw);
    const bx = (k % across) * bw, by = Math.floor(k / across) * bh;
    for (let r = 0; r < bh; r++) {
      let prev = 0;
      for (let c = 0; c < bw; c++) {
        const o = (r * bw + c) * bytes;
        if (o + bytes > data.length) break;
        let v = read(data, o);
        if (predictor === 2 && c > 0) v = wrap(v + prev);
        prev = v;
        const x = bx + c, y = by + r;
        if (x < width && y < height) values[y * width + x] = v;
      }
    }
  });
  return { width, height, values };
}

/** Mean of the valid (non-zero) pixels in a box of ±halfDeg around the point, ÷10 → vol %; null when all are nodata. */
export async function fetchWcsMean(property: "wv0033" | "wv1500", depth: string, lat: number, lon: number, halfDeg = 0.003): Promise<{ ok: true; value: number | null; pixels: number; url: string; sha256: string; bytes: number; retrievedAt: string } | { ok: false; error: string; url: string }> {
  const url = wcsUrl(property, depth, lat, lon, halfDeg);
  const res = await fetchText(url, { timeoutMs: 45_000, binary: true });
  if (!res.ok) return { ok: false, error: res.error, url };
  if (!res.bytes || !/tiff/.test(res.retrieval.contentType ?? "")) return { ok: false, error: `WCS answered ${res.retrieval.contentType ?? "no content type"}, not a GeoTIFF`, url };
  const { values } = readSmallTiff(res.bytes);
  const valid = values.filter((v) => v > 0 && v < 1000);
  return { ok: true, value: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length / 10 : null, pixels: valid.length, url, sha256: res.retrieval.bodySha256, bytes: res.retrieval.bodyBytes, retrievedAt: res.retrieval.retrievedAt };
}
