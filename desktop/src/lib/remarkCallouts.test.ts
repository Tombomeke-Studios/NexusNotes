import { describe, it, expect } from "vitest";
import { remarkCallouts } from "./remarkCallouts";

interface TestNode {
  type: string;
  value?: string;
  children?: TestNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function run(tree: TestNode): TestNode {
  remarkCallouts()(tree);
  return tree;
}

// Builds a blockquote whose first paragraph's leading text is `firstLine`,
// with the rest of the paragraph text on subsequent lines.
function blockquote(firstLine: string, body = ""): TestNode {
  const value = body ? `${firstLine}\n${body}` : firstLine;
  return {
    type: "root",
    children: [
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value }] }] },
    ],
  };
}

describe("remarkCallouts", () => {
  it("turns a [!NOTE] blockquote into a callout div with a data-callout attribute", () => {
    const tree = run(blockquote("[!NOTE]", "some body"));
    const bq = tree.children![0];
    expect(bq.data?.hName).toBe("div");
    expect(bq.data?.hProperties?.className).toEqual(["callout", "callout-note"]);
    expect(bq.data?.hProperties?.["data-callout"]).toBe("note");
  });

  it("prepends a callout-title using the type when no custom title is given", () => {
    const tree = run(blockquote("[!WARNING]", "careful"));
    const title = tree.children![0].children![0];
    expect(title.data?.hProperties?.className).toEqual(["callout-title"]);
    expect(title.children![0].value).toBe("Warning");
  });

  it("uses a custom title when present and lowercases the type", () => {
    const tree = run(blockquote("[!TIP] Pro tip", "do this"));
    const bq = tree.children![0];
    expect(bq.data?.hProperties?.["data-callout"]).toBe("tip");
    expect(bq.children![0].children![0].value).toBe("Pro tip");
  });

  it("keeps the body text and strips the marker line", () => {
    const tree = run(blockquote("[!INFO] Title", "line one"));
    const bodyPara = tree.children![0].children![1];
    expect(bodyPara.children![0].value).toBe("line one");
  });

  it("handles a marker-only callout with no body", () => {
    const tree = run(blockquote("[!DANGER]"));
    const bq = tree.children![0];
    expect(bq.data?.hProperties?.["data-callout"]).toBe("danger");
    // Only the injected title paragraph remains.
    expect(bq.children!.length).toBe(1);
    expect(bq.children![0].data?.hProperties?.className).toEqual(["callout-title"]);
  });

  it("leaves ordinary blockquotes untouched", () => {
    const tree = run(blockquote("just a quote"));
    expect(tree.children![0].data).toBeUndefined();
  });
});
