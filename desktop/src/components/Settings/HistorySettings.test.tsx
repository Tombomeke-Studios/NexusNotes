import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistorySettings } from "./HistorySettings";

const owned = { id: "v1", name: "Personal", role: "owner" as const };

describe("HistorySettings", () => {
  it("shows the vault's retention and saves a change", async () => {
    const save = vi.fn(async () => {});
    render(<HistorySettings vault={owned} load={async () => ({ keep_count: 50, keep_days: 0 })} save={save} />);
    const count = (await screen.findByLabelText("Versions kept per note")) as HTMLSelectElement;
    const days = screen.getByLabelText("Delete versions older than") as HTMLSelectElement;
    expect(count.value).toBe("50");
    expect(days.value).toBe("0");

    fireEvent.change(days, { target: { value: "30" } });
    await waitFor(() => expect(save).toHaveBeenCalledWith("v1", { keep_count: 50, keep_days: 30 }));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("keeps a value that is not one of the presets selectable", async () => {
    render(<HistorySettings vault={owned} load={async () => ({ keep_count: 75, keep_days: 12 })} save={vi.fn()} />);
    expect(((await screen.findByLabelText("Versions kept per note")) as HTMLSelectElement).value).toBe("75");
    expect((screen.getByLabelText("Delete versions older than") as HTMLSelectElement).value).toBe("12");
  });

  it("reports a failed save and shows the stored value again", async () => {
    const save = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<HistorySettings vault={owned} load={async () => ({ keep_count: 50, keep_days: 0 })} save={save} />);
    const count = (await screen.findByLabelText("Versions kept per note")) as HTMLSelectElement;
    fireEvent.change(count, { target: { value: "10" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(count.value).toBe("50");
  });

  it("is read-only for members", async () => {
    render(<HistorySettings vault={{ ...owned, role: "editor" }} load={async () => ({ keep_count: 50, keep_days: 7 })} save={vi.fn()} />);
    expect(((await screen.findByLabelText("Versions kept per note")) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Only the vault owner/)).toBeTruthy();
  });
});
