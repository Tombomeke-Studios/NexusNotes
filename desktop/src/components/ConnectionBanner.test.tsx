import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../lib/useServerStatus", () => ({ useServerStatus: () => null }));
let exposed = false;
vi.mock("../lib/useBackendExposed", () => ({ useBackendExposed: () => exposed }));

import { ConnectionBanner } from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  it("shows nothing while all is well", () => {
    exposed = false;
    const { container } = render(<ConnectionBanner />);
    expect(container.textContent).toBe("");
  });

  // A server the network can reach is not the app's own backend (#336).
  it("warns when the server on this computer is reachable from the network", () => {
    exposed = true;
    render(<ConnectionBanner />);
    expect(screen.getByRole("status").textContent).toMatch(/other computers on your network/i);
  });
});
