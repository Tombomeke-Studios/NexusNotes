import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Snippet } from "./Snippet";

describe("Snippet", () => {
  it("renders note content as text, never as markup", () => {
    const hostile = '<img src=x onerror="window.__snippetXss=1"><script>window.__snippetXss=2</script> <em>match</em>';
    const { container } = render(<Snippet text={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect((window as unknown as { __snippetXss?: number }).__snippetXss).toBeUndefined();
  });

  it("emphasises the highlighted match", () => {
    const { container } = render(<Snippet text="buy <em>milk</em>" />);
    const em = container.querySelectorAll("em");
    expect(em).toHaveLength(1);
    expect(em[0].textContent).toBe("milk");
  });
});
