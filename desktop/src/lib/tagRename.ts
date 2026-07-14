/**
 * Renames a tag across a note's content (#154). Handles both inline `#tag`
 * occurrences and YAML front-matter `tags:` entries, and cascades to nested
 * tags: renaming `work` → `job` also turns `#work/projects` into
 * `#job/projects`. Both names are matched case-insensitively and written
 * lowercased, since tags are always lowercased on extraction.
 *
 * Kept purely string-based so it works identically for e2ee vaults, where the
 * rename runs on decrypted content in memory and re-encrypts on save.
 */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Normalizes a user-entered tag: strip a leading #, lowercase, trim slashes. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Replaces `old` (and any `old/child`) with `next` in content. Returns the new
 * content, or the original string unchanged when nothing matched.
 */
export function renameTagInContent(content: string, old: string, next: string): string {
  const from = normalizeTag(old);
  const to = normalizeTag(next);
  if (!from || !to || from === to) return content;

  // Inline: `#from` or `#from/...`, bounded so `#fromage` is left alone. The
  // tag char class matches the extractor (letters, digits, _, -, /).
  const inline = new RegExp(`(^|\\s)#${escapeRegExp(from)}(?=$|[\\s/]|[^a-zA-Z0-9_/-])`, "gim");
  let out = content.replace(inline, (_m, pre) => `${pre}#${to}`);

  // Front-matter list/array entries: replace a whole tag token that is `from`
  // or starts with `from/`. Only touch lines inside the leading --- block.
  const fm = out.match(/^(---\n[\s\S]*?\n---)/);
  if (fm) {
    const block = fm[1];
    const token = new RegExp(`(^|[\\s,\\[])(${escapeRegExp(from)})(?=$|[\\s,\\]/])`, "gim");
    const renamed = block.replace(token, (_m, pre) => `${pre}${to}`);
    if (renamed !== block) out = renamed + out.slice(block.length);
  }

  return out;
}

/** True when the note carries the tag or one of its descendants. */
export function contentHasTag(tags: string[], tag: string): boolean {
  const t = normalizeTag(tag);
  return tags.some((x) => x === t || x.startsWith(`${t}/`));
}
