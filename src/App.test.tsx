import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("WordWell learner product", () => {
  it("records familiarity before rendering the daily lesson and makes it available in history", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "How familiar is this word?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Seen it, unsure" }));
    expect(screen.getByRole("heading", { name: "candid" })).toBeVisible();
    expect(
      screen.getByText(
        "honest and direct, even when the truth may be uncomfortable"
      )
    ).toBeVisible();
    expect(screen.getByText("Use it when")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/candid/)).toBeVisible();
  });
});
