import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetTheme = vi.fn();
let mockResolvedTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}));

import { ThemeSwitcher } from "@/components/theme-switcher";

function getThemeButton() {
  const buttons = screen.getAllByRole("button");
  return buttons[buttons.length - 1];
}

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    mockResolvedTheme = "light";
  });

  it("renders without crashing", () => {
    render(<ThemeSwitcher />);
    expect(getThemeButton()).toBeInTheDocument();
  });

  it("toggles from light to dark", () => {
    mockResolvedTheme = "light";
    render(<ThemeSwitcher />);
    fireEvent.click(getThemeButton());
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("toggles from dark to light", () => {
    mockResolvedTheme = "dark";
    render(<ThemeSwitcher />);
    fireEvent.click(getThemeButton());
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });
});
