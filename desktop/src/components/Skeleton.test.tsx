import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonTree, SkeletonNote, SkeletonGraph } from "./Skeleton";

describe("skeletons", () => {
  it("announce what is loading and draw shimmer blocks", () => {
    const { container } = render(
      <>
        <SkeletonTree rows={5} />
        <SkeletonNote />
        <SkeletonGraph />
      </>,
    );
    expect(screen.getByRole("status", { name: "Loading notes" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading note" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading graph" })).toBeTruthy();
    expect(container.querySelectorAll(".skeleton-tree .skeleton")).toHaveLength(5);
    expect(container.querySelectorAll(".skeleton-note-line").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll(".skeleton-graph-node").length).toBeGreaterThan(3);
  });
});
