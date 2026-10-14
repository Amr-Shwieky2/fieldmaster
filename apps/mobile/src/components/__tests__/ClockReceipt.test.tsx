import { fireEvent, screen, within } from "@testing-library/react-native";
import ar from "../../i18n/messages";
import { expectArabicOnly, receiptReference, renderInArabic } from "../../screens/__tests__/clock-screens-test-utils";
import { AppText } from "../AppText";
import { ClockReceipt } from "../ClockReceipt";

/** The value shown on a receipt row (the row's second text). */
function rowValue(testID: string): string {
  const texts = within(screen.getByTestId(testID)).getAllByText(/./);
  return texts[texts.length - 1].props.children as string;
}

describe("ClockReceipt", () => {
  it("shows an online clock-in: action, server and phone times in Asia/Jerusalem, synced, and the clock event id left-to-right", async () => {
    const onDone = jest.fn();
    await renderInArabic(
      <ClockReceipt
        action="CLOCK_IN"
        queued={false}
        title={ar.clockIn.successTitle}
        shiftTitle="صيانة إشارات شارع هرتسل"
        serverTime="2026-01-15T08:31:05.000Z"
        deviceTime="2026-01-15T08:30:59.000Z"
        referenceId="0199c5a2-7c1d-7a3e-9a52-3f6c2d1e8b40"
        doneLabel={ar.clockIn.backHome}
        onDone={onDone}
      >
        <AppText>{"بدأ دوامك الساعة 10:31."}</AppText>
      </ClockReceipt>,
    );

    expect(screen.getByRole("header", { name: ar.clockIn.successTitle })).toBeOnTheScreen();
    expect(screen.getByTestId("receipt-shift")).toHaveTextContent("صيانة إشارات شارع هرتسل");
    expect(screen.getByText("بدأ دوامك الساعة 10:31.")).toBeOnTheScreen();

    expect(within(screen.getByTestId("receipt-action")).getByText(ar.receipt.action)).toBeOnTheScreen();
    expect(rowValue("receipt-action")).toBe("بدء الدوام");
    // Winter: UTC+2.
    expect(rowValue("receipt-server-time")).toBe("15 يناير 2026 في 10:31");
    expect(rowValue("receipt-device-time")).toBe("15 يناير 2026 في 10:30");
    expect(rowValue("receipt-sync-state")).toBe(ar.receipt.synced);
    expect(rowValue("receipt-sync-state")).toBe("تمت المزامنة");
    // The id keeps its order inside the Arabic layout: a left-to-right isolate around it.
    expect(screen.getByTestId("receipt-reference-id").props.children).toBe(`${String.fromCharCode(0x2066)}0199c5a2-7c1d-7a3e-9a52-3f6c2d1e8b40${String.fromCharCode(0x2069)}`);
    expect(receiptReference()).toBe("0199c5a2-7c1d-7a3e-9a52-3f6c2d1e8b40");
    expectArabicOnly([receiptReference()]);

    await fireEvent.press(screen.getByRole("button", { name: ar.clockIn.backHome }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows a clock-out waiting on the phone: no server time yet, waiting to sync, the client event id, and what was not sent", async () => {
    await renderInArabic(
      <ClockReceipt
        action="CLOCK_OUT"
        queued
        title={ar.clockOut.queuedTitle}
        serverTime={null}
        deviceTime="2026-07-15T21:30:00.000Z"
        referenceId="clockout-1784151000000"
        notes={[ar.clock.photosNotSent, ar.clock.voiceNotSent]}
        doneLabel={ar.clockOut.backHome}
        onDone={jest.fn()}
      />,
    );

    expect(rowValue("receipt-action")).toBe("إنهاء الدوام");
    expect(rowValue("receipt-server-time")).toBe(ar.receipt.serverTimePending);
    // Summer: UTC+3, across midnight.
    expect(rowValue("receipt-device-time")).toBe("16 يوليو 2026 في 00:30");
    expect(rowValue("receipt-sync-state")).toBe("بانتظار المزامنة");
    expect(receiptReference()).toBe("clockout-1784151000000");
    expect(screen.getByText(ar.clock.photosNotSent)).toBeOnTheScreen();
    expect(screen.getByText(ar.clock.voiceNotSent)).toBeOnTheScreen();
    expect(screen.queryByTestId("receipt-shift")).not.toBeOnTheScreen();
    expectArabicOnly([receiptReference()]);
  });
});
