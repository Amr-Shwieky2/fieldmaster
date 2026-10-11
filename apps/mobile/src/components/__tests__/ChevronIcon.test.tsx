import { I18nManager } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ChevronIcon } from "../ChevronIcon";

describe("ChevronIcon (back arrow)", () => {
  it("is mirrored in the RTL layout so it points to the start edge", async () => {
    await render(<ChevronIcon />);
    expect(screen.getByTestId("chevron-icon")).toHaveStyle({ transform: [{ scaleX: -1 }] });
  });

  it("is not mirrored in an LTR layout", async () => {
    jest.replaceProperty(I18nManager, "isRTL", false);
    await render(<ChevronIcon />);
    expect(screen.getByTestId("chevron-icon")).toHaveStyle({ transform: [{ scaleX: 1 }] });
  });
});
