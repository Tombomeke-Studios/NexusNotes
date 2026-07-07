export function wordCount(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function readingTimeMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / 200));
}

export function relativeTimeLabel(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - from.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return from.toLocaleDateString();
}

export function cursorPosition(
  content: string,
  selectionStart: number,
): { line: number; col: number } {
  const upto = content.slice(0, selectionStart).split("\n");
  return { line: upto.length, col: upto[upto.length - 1].length + 1 };
}
