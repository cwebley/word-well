import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("WordWell learner product", () => {
  it("renders a seeded published word lesson", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "candid" })).toBeVisible();
    expect(
      screen.getByText(
        "honest and direct, even when the truth may be uncomfortable"
      )
    ).toBeVisible();
    expect(screen.getByText("Use it when")).toBeVisible();
  });
});
