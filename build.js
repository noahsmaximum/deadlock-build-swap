// Deadlock hero build string codec.
// A build string is base64( zstd( CMsgHeroBuild protobuf ) ). Top-level fields we care about:
//   1 build id · 2 hero id · 3 author account id · 4 last-updated unix time · 5 name · 6 description
// Everything else (field 10 = items/abilities/notes) is carried through byte-for-byte.
import { Zstd } from './vendor/zstd.js';

export const F = { BUILD_ID: 1, HERO_ID: 2, AUTHOR: 3, UPDATED: 4, NAME: 5, DESC: 6 };

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const LEVEL = 19;

let zstdPromise;
const zstd = () => (zstdPromise ??= Zstd.load());

// Varints use plain arithmetic, not bit ops: some fields (f11 hashes) exceed 2^31.
function readVarint(b, p) {
  let v = 0, mul = 1, c;
  do {
    if (p >= b.length) throw new Error('truncated varint');
    c = b[p++];
    v += (c & 127) * mul;
    mul *= 128;
  } while (c & 128);
  return [v, p];
}

function writeVarint(v) {
  const out = [];
  do {
    let c = v % 128;
    v = Math.floor(v / 128);
    if (v) c |= 128;
    out.push(c);
  } while (v);
  return out;
}

function parseFields(buf) {
  const fields = [];
  let p = 0;
  while (p < buf.length) {
    const start = p;
    let tag;
    [tag, p] = readVarint(buf, p);
    const field = Math.floor(tag / 8), wire = tag % 8;
    const f = { field, wire, start };
    if (wire === 0) [f.value, p] = readVarint(buf, p);
    else if (wire === 2) {
      let len;
      [len, p] = readVarint(buf, p);
      if (p + len > buf.length) throw new Error('truncated field');
      f.bytes = buf.subarray(p, p + len);
      p += len;
    } else if (wire === 5) p += 4;
    else if (wire === 1) p += 8;
    else throw new Error(`unsupported wire type ${wire}`);
    f.end = p;
    fields.push(f);
  }
  return fields;
}

function b64ToBytes(s) {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const utf8 = new TextDecoder();

/** Decode a build string. Throws with a user-readable message if it isn't one. */
export async function decodeBuild(text) {
  if (!text || !text.trim()) throw new Error('Empty');
  let compressed;
  try { compressed = b64ToBytes(text); } catch { throw new Error('Not a build string (bad base64)'); }
  if (!ZSTD_MAGIC.every((b, i) => compressed[i] === b)) throw new Error('Not a build string (missing zstd header)');

  let raw;
  try { raw = (await zstd()).decompress(compressed); } catch { throw new Error('Build string is damaged (zstd failed)'); }

  let fields;
  try { fields = parseFields(raw); } catch (e) { throw new Error(`Build data is damaged (${e.message})`); }

  const num = n => fields.find(f => f.field === n && f.wire === 0)?.value;
  const str = n => { const f = fields.find(f => f.field === n && f.wire === 2); return f ? utf8.decode(f.bytes) : ''; };
  const heroId = num(F.HERO_ID);
  if (heroId === undefined) throw new Error('No hero ID in this build');

  return {
    raw,
    buildId: num(F.BUILD_ID),
    heroId,
    author: num(F.AUTHOR),
    updated: num(F.UPDATED),
    name: str(F.NAME),
    desc: str(F.DESC),
  };
}

const utf8Encode = new TextEncoder();

function encodeField(field, value) {
  if (typeof value === 'string') {
    const bytes = utf8Encode.encode(value);
    return [...writeVarint(field * 8 + 2), ...writeVarint(bytes.length), ...bytes];
  }
  return [...writeVarint(field * 8), ...writeVarint(value)];
}

/**
 * Re-encode `build.raw` with top-level fields replaced: numbers as varints, strings as UTF-8,
 * e.g. { [F.HERO_ID]: 88, [F.NAME]: 'x' }. Overrides for fields the build lacks are appended.
 */
export async function encodeBuild(build, overrides) {
  const parts = [];
  const pending = new Set(Object.keys(overrides).map(Number));
  for (const f of parseFields(build.raw)) {
    if (pending.has(f.field)) {
      parts.push(...encodeField(f.field, overrides[f.field]));
      pending.delete(f.field);
    } else parts.push(...build.raw.subarray(f.start, f.end));
  }
  for (const field of pending) parts.push(...encodeField(field, overrides[field]));
  return bytesToB64((await zstd()).compress(new Uint8Array(parts), LEVEL));
}

export const warmup = () => zstd();
