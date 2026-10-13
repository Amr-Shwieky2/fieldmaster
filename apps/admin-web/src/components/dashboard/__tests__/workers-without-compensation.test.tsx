import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { WorkersWithoutCompensation } from "../workers-without-compensation";

describe("WorkersWithoutCompensation", () => {
  it("warns about approved entries without a rate, which no figure includes, with a link to each worker", () => {
    const workers = [
      { workerProfileId: "wp-13", fullLegalName: "رامي سعيد", entries: 1 },
      { workerProfileId: "wp-14", fullLegalName: "نور الهدى", entries: 2 },
      { workerProfileId: "wp-15", fullLegalName: "جاد معلوف", entries: 4 },
      { workerProfileId: "wp-16", fullLegalName: "سارة يعقوب", entries: 12 },
    ];
    renderWithIntl(<WorkersWithoutCompensation workers={workers} />);

    const warning = screen.getByRole("region", { name: "حضور معتمد بلا أجر مسجّل" });
    expect(
      within(warning).getByText(
        "سجلات هؤلاء العمال المعتمدة غير محسوبة في أرقام هذه الصفحة، إذ لا يوجد أجر مسجّل في تواريخها. سجّل الأجر من صفحة العامل لتدخل في الرواتب.",
      ),
    ).toBeTruthy();
    const items = within(warning).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["رامي سعيدسجل واحد", "نور الهدىسجلان", "جاد معلوف4 سجلات", "سارة يعقوب12 سجلًا"]);
    expect(within(warning).getByRole("link", { name: "رامي سعيد" }).getAttribute("href")).toBe("/workers/wp-13");
    // A persistent warning, not an alert that interrupts screen readers.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing when every approved entry has a rate", () => {
    const { container } = renderWithIntl(<WorkersWithoutCompensation workers={[]} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("region")).toBeNull();
  });
});
