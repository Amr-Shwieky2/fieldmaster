import { act, fireEvent, screen } from "@testing-library/react-native";
import ar from "../../i18n/messages";
import type { AccountState } from "../../lib/account-state";
import { navigationRef } from "../../lib/linking";
import { RootNavigator } from "../../navigation/RootNavigator";
import { AccountStateScreen } from "../AccountStateScreen";
import { expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockAuth: { accountState: AccountState | null; dismissAccountState: jest.Mock; isAuthenticated: boolean; isLoading: boolean } = {
  accountState: null,
  dismissAccountState: jest.fn(),
  isAuthenticated: false,
  isLoading: false,
};
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  mockAuth.accountState = null;
  mockAuth.isAuthenticated = false;
});

describe("AccountStateScreen (Arabic, RTL)", () => {
  it.each([
    ["PENDING_APPROVAL", "طلب الانضمام قيد المراجعة", ar.errors.ACCOUNT_PENDING_APPROVAL, ar.account.backToLogin],
    ["REJECTED", "لم تتم الموافقة على طلب الانضمام", ar.errors.ACCOUNT_REJECTED, ar.account.backToLogin],
    ["SUSPENDED", "الحساب موقوف", ar.errors.ACCOUNT_SUSPENDED, ar.common.signOut],
    ["DEVICE_KEY_REVOKED", "يلزم تسجيل الدخول من جديد", ar.errors.DEVICE_KEY_REVOKED, ar.account.signInAgain],
  ] as const)("explains %s in Arabic with one action back to the sign-in screen", async (kind, title, message, action) => {
    mockAuth.accountState = { kind };
    await renderInArabic(<AccountStateScreen />);

    expect(screen.getByRole("header", { name: title })).toBeOnTheScreen();
    expect(screen.getByText(ar.account.title[kind])).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.getByText(ar.account.hint[kind])).toBeOnTheScreen();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expectArabicOnly([ar.app.brand]);

    await fireEvent.press(screen.getByRole("button", { name: action }));
    expect(mockAuth.dismissAccountState).toHaveBeenCalledTimes(1);
  });

  it("says how many saved records were removed when the device key was revoked", async () => {
    mockAuth.accountState = { kind: "DEVICE_KEY_REVOKED", droppedEvents: 3 };
    await renderInArabic(<AccountStateScreen />);
    expect(screen.getByText(fill(ar.account.droppedEvents, { count: "3" }))).toBeOnTheScreen();
    expect(screen.getByText("التسجيلات المحفوظة على الهاتف التي لم تُرسل وحُذفت: 3. يُرجى إبلاغ المدير لتصحيح الحضور.")).toBeOnTheScreen();
    expectArabicOnly([ar.app.brand]);
  });

  it("does not mention removed records when there were none", async () => {
    mockAuth.accountState = { kind: "DEVICE_KEY_REVOKED", droppedEvents: 0 };
    await renderInArabic(<AccountStateScreen />);
    expect(screen.queryByText(/لم تُرسل وحُذفت/)).not.toBeOnTheScreen();
  });
});

describe("RootNavigator with an account state", () => {
  it.each(["PENDING_APPROVAL", "SUSPENDED"] as const)("mounts the account-state screen only (%s), even with a session", async (kind) => {
    mockAuth.accountState = { kind };
    mockAuth.isAuthenticated = true;
    await renderInArabic(<RootNavigator />);
    await act(async () => undefined);

    expect(screen.getByText(ar.account.title[kind])).toBeOnTheScreen();
    expect(navigationRef.getRootState()?.routeNames).toEqual(["AccountState"]);
  });
});
