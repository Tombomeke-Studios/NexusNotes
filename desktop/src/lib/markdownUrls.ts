import { defaultUrlTransform } from "react-markdown";

/**
 * react-markdown's default urlTransform strips URLs with unknown protocols,
 * which silently removes the wikilink:// hrefs produced by remarkWikilinks
 * before the anchor renderer can turn them into buttons. Whitelist the
 * internal protocol and defer to the default sanitizer for everything else.
 */
export function wikiUrlTransform(url: string): string {
  if (url.startsWith("wikilink://")) return url;
  return defaultUrlTransform(url);
}
