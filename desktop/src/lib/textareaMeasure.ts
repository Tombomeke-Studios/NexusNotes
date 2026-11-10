/**
 * Where `offset` sits from the top of the source textarea's content: a hidden
 * copy of the highlight layer, holding the text up to the offset, wraps
 * exactly like the textarea. Used to scroll a match (#547) or a heading
 * (#558) into view.
 */
export function measureTop(ta: HTMLTextAreaElement, offset: number): number {
  const parent = ta.parentElement;
  if (!parent) return 0;
  const mirror = document.createElement("pre");
  mirror.className = "editor-highlight";
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.fontSize = ta.style.fontSize;
  mirror.style.visibility = "hidden";
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​"; // zero-width space
  mirror.appendChild(marker);
  parent.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}
