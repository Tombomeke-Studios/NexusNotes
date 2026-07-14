import { defaultUrlTransform } from "react-markdown";

/**
 * react-markdown's default urlTransform strips URLs with unknown protocols,
 * which silently removes the wikilink:// hrefs from remarkWikilinks and the
 * tag:// hrefs from remarkTags before the anchor renderer can turn them into
 * buttons. Whitelist the internal protocols and defer to the default
 * sanitizer for everything else.
 */
export function wikiUrlTransform(url: string): string {
  if (url.startsWith("wikilink://") || url.startsWith("tag://") || url.startsWith("attachment://")) return url;
  return defaultUrlTransform(url);
}
