import { describe, it, expect, vi, afterEach } from "vitest";
import { editTextarea } from "./textareaEdit";

function textarea(value: string) {
  const ta = document.createElement("textarea");
  ta.value = value;
  document.body.appendChild(ta);
  return ta;
}

describe("editTextarea", () => {
  const original = document.execCommand;
  afterEach(() => {
    document.execCommand = original;
    document.body.innerHTML = "";
  });

  it("inserts through execCommand so the edit can be undone", () => {
    const ta = textarea("hello world");
    document.execCommand = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
      expect(cmd).toBe("insertText");
      ta.setRangeText(value ?? "", ta.selectionStart, ta.selectionEnd, "end");
      return true;
    }) as typeof document.execCommand;
    const fallback = vi.fn();
    editTextarea(ta, 6, 11, "there", "hello there", fallback);
    expect(ta.value).toBe("hello there");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to setting the whole text when the command does nothing", () => {
    const ta = textarea("abc");
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;
    const fallback = vi.fn();
    editTextarea(ta, 0, 3, "xyz", "xyz", fallback);
    expect(fallback).toHaveBeenCalledWith("xyz");
  });

  it("gives focus back to the element that had it", () => {
    const ta = textarea("abc");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;
    editTextarea(ta, 0, 0, "x", "xabc", () => {});
    expect(document.activeElement).toBe(input);
  });
});
