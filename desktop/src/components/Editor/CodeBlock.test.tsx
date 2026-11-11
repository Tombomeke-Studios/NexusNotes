import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { CodeBlock, COPY_FEEDBACK_MS } from "./CodeBlock";

const writeText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.useRealTimers());

const renderBlock = (markdown: string) => render(<ReactMarkdown components={{ pre: CodeBlock }}>{markdown}</ReactMarkdown>);

const click = async (button: HTMLElement) => {
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("CodeBlock (#615)", () => {
  it("copies the block's text, without the language label", async () => {
    renderBlock("```js\nconst a = 1;\nconsole.log(a);\n```");
    expect(screen.getByText("js").className).toBe("code-lang");
    await click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("const a = 1;\nconsole.log(a);\n");
  });

  it("confirms with Copied, announces it, then offers Copy again", async () => {
    renderBlock("```\nplain\n```");
    const button = screen.getByRole("button", { name: "Copy code" });
    await click(button);
    expect(button.textContent).toBe("Copied");
    expect(screen.getByRole("status").textContent).toBe("Copied");
    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(button.textContent).toBe("Copy");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderBlock("```\nplain\n```");
    const button = screen.getByRole("button", { name: "Copy code" });
    await click(button);
    expect(button.textContent).toBe("Couldn't copy");
  });

  it("shows no language label for a block without one", () => {
    const { container } = renderBlock("```\nplain\n```");
    expect(container.querySelector(".code-lang")).toBeNull();
  });
});
