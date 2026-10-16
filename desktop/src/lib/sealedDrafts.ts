import { base64ToBytes, bytesToBase64, decryptBytes, encryptBytes } from "./crypto";

/**
 * Local drafts of notes in end-to-end encrypted vaults (#549), sealed under
 * the vault key so plaintext never touches disk.
 *
 * Standard vaults mirror unsaved text to localStorage in clear (drafts.ts);
 * an e2ee vault's text may only be stored encrypted. Each draft is stored
 * under `nexus_sealed_draft_<note id>` (note ids are random UUIDs, so the
 * name says nothing about the note) as `{ v, vault, data }`: `data` is
 * AES-256-GCM with a fresh IV per write over the text and the checksum it
 * was written against, with the vault and note id as additional data, so a
 * draft only opens for the note it belongs to. Nothing else is stored.
 *
 * Writes are asynchronous (Web Crypto) and serialised per note: a write that
 * a newer one has overtaken is skipped, and a clear (the server has the text)
 * wins over any write still under way.
 */

const KEY_PREFIX = "nexus_sealed_draft_";
const FORMAT = 1;

export interface SealedDraft {
  content: string;
  /** Checksum of the server version the text was written against, if known. */
  base: string | null;
}

/** A draft that is on disk but could not be opened (another or a rotated key, damage). It is kept. */
export class UnreadableDraftError extends Error {
  constructor(public noteId: string) {
    super("a locally kept draft could not be decrypted");
    this.name = "UnreadableDraftError";
  }
}

/** stored: on disk. superseded: a newer write or a clear took its place. failed: storage refused it. */
export type SealedWriteResult = "stored" | "superseded" | "failed";

interface Stored {
  v: number;
  vault: string;
  data: string;
}

const encoder = new TextEncoder();

function additionalData(vaultId: string, noteId: string): Uint8Array {
  return encoder.encode(`nexusnotes:draft:v${FORMAT}:${vaultId}:${noteId}`);
}

/** Seals a draft for storage; the result holds no plaintext. */
export async function sealDraft(vaultId: string, noteId: string, draft: SealedDraft, key: Uint8Array): Promise<string> {
  const payload = encoder.encode(JSON.stringify({ c: draft.content, b: draft.base }));
  const sealed = await encryptBytes(payload, key, additionalData(vaultId, noteId));
  const stored: Stored = { v: FORMAT, vault: vaultId, data: bytesToBase64(sealed) };
  return JSON.stringify(stored);
}

/** Opens a stored draft; throws UnreadableDraftError when it is not this note's, or the key is wrong. */
export async function openDraft(stored: string, vaultId: string, noteId: string, key: Uint8Array): Promise<SealedDraft> {
  try {
    const parsed = JSON.parse(stored) as Partial<Stored>;
    if (parsed.v !== FORMAT || parsed.vault !== vaultId || typeof parsed.data !== "string") throw new Error("format");
    const plain = await decryptBytes(base64ToBytes(parsed.data), key, additionalData(vaultId, noteId));
    const body = JSON.parse(new TextDecoder().decode(plain)) as { c?: unknown; b?: unknown };
    if (typeof body.c !== "string") throw new Error("format");
    return { content: body.c, base: typeof body.b === "string" ? body.b : null };
  } catch {
    throw new UnreadableDraftError(noteId);
  }
}

function read(noteId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + noteId);
  } catch {
    return null;
  }
}

/** The vault a stored draft says it belongs to (not secret: an opaque id), or null. */
function vaultOfStored(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const vault = (JSON.parse(raw) as Partial<Stored>).vault;
    return typeof vault === "string" ? vault : null;
  } catch {
    return null;
  }
}

// --- Per-note serialisation ---

const chains = new Map<string, Promise<unknown>>();
/** Bumped by every clear: a write or rebase begun before it must not land. */
const generations = new Map<string, number>();
/** The newest write requested per note; older ones still waiting are skipped. */
const newestWrite = new Map<string, number>();
let writeSeq = 0;

const generationOf = (noteId: string) => generations.get(noteId) ?? 0;

function serialise<T>(noteId: string, op: () => Promise<T>): Promise<T> {
  const previous = chains.get(noteId) ?? Promise.resolve();
  const next = previous.then(op, op);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(noteId, settled);
  void settled.then(() => {
    if (chains.get(noteId) === settled) chains.delete(noteId);
  });
  return next;
}

/**
 * Seals the note's unsaved text to disk. Resolves once it is stored, or
 * once it no longer needs to be (a newer write or a clear took over).
 */
export function writeSealedDraft(
  vaultId: string,
  noteId: string,
  draft: SealedDraft,
  key: Uint8Array,
): Promise<SealedWriteResult> {
  const seq = ++writeSeq;
  newestWrite.set(noteId, seq);
  const generation = generationOf(noteId);
  return serialise(noteId, async (): Promise<SealedWriteResult> => {
    if (newestWrite.get(noteId) !== seq || generationOf(noteId) !== generation) return "superseded";
    let stored: string;
    try {
      stored = await sealDraft(vaultId, noteId, draft, key);
    } catch {
      return "failed";
    }
    if (newestWrite.get(noteId) !== seq || generationOf(noteId) !== generation) return "superseded";
    try {
      localStorage.setItem(KEY_PREFIX + noteId, stored);
      return "stored";
    } catch {
      return "failed";
    }
  });
}

/**
 * The note's sealed draft, opened; null when there is none. Waits for writes
 * under way. Throws UnreadableDraftError (the draft stays on disk).
 */
export async function readSealedDraft(vaultId: string, noteId: string, key: Uint8Array): Promise<SealedDraft | null> {
  await (chains.get(noteId) ?? Promise.resolve());
  const raw = read(noteId);
  if (raw === null) return null;
  return openDraft(raw, vaultId, noteId, key);
}

/**
 * Moves the draft's base to `to` if it is still on `from` (our own save
 * landed while newer text was typed). Needs the key: the base is sealed too.
 */
export function rebaseSealedDraft(vaultId: string, noteId: string, from: string, to: string, key: Uint8Array): Promise<void> {
  const generation = generationOf(noteId);
  return serialise(noteId, async () => {
    const raw = read(noteId);
    if (raw === null || generationOf(noteId) !== generation) return;
    let draft: SealedDraft;
    try {
      draft = await openDraft(raw, vaultId, noteId, key);
    } catch {
      return;
    }
    if (draft.base !== from) return;
    const stored = await sealDraft(vaultId, noteId, { ...draft, base: to }, key);
    if (generationOf(noteId) !== generation || read(noteId) !== raw) return;
    try {
      localStorage.setItem(KEY_PREFIX + noteId, stored);
    } catch {
      /* the old draft stays: at worst a false conflict on replay */
    }
  });
}

/** Removes the note's sealed draft at once; writes still under way don't land. */
export function clearSealedDraft(noteId: string): void {
  generations.set(noteId, generationOf(noteId) + 1);
  try {
    localStorage.removeItem(KEY_PREFIX + noteId);
  } catch {
    /* ignore */
  }
}

/** Whether the note has a sealed draft on disk. */
export function hasSealedDraft(noteId: string): boolean {
  return read(noteId) !== null;
}

/** Ids of the notes of a vault that have a sealed draft on disk. */
export function sealedDraftNoteIds(vaultId: string): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(KEY_PREFIX)) continue;
      if (vaultOfStored(localStorage.getItem(name)) === vaultId) ids.push(name.slice(KEY_PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
  return ids;
}

/** Resolves once every sealed-draft write and rebase under way has finished. */
export async function flushSealedDrafts(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()]);
}
