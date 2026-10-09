import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { ApiRequestError, NetworkError, type AuthSession, type DevLoginUser } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { isolateLtr } from "../../components/LtrText";
import { IntlRoot } from "../../i18n/IntlRoot";
import ar from "../../i18n/messages";
import { TOUCH_TARGET } from "../../lib/theme";
import { LoginScreen } from "../LoginScreen";

const mockClient = {
  listDevLoginUsers: jest.fn(),
  devLogin: jest.fn(),
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
};
const mockLogin = jest.fn();
const mockOfflineSync = { isOnline: true };

jest.mock("../../lib/auth-context", () => ({
  useAuth: () => ({ client: mockClient, login: mockLogin }),
}));
jest.mock("../../lib/offline-sync-context", () => ({
  useOfflineSync: () => mockOfflineSync,
}));

const DEVICE_ID = "device-test-1";
const PHONE = "+972501234567";

const session: AuthSession = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 900,
  organizationId: "org-1",
  role: OrgRole.WORKER,
};

function devUser(overrides: Partial<DevLoginUser> & Pick<DevLoginUser, "membershipId" | "fullLegalName" | "phoneNumber" | "role">): DevLoginUser {
  return { userId: `user-${overrides.membershipId}`, preferredName: null, organizationId: "org-1", organizationName: "شركة الميدان", ...overrides };
}

const owner = devUser({ membershipId: "m-owner", fullLegalName: "أحمد منصور", phoneNumber: "+972501000001", role: OrgRole.OWNER });
const manager = devUser({ membershipId: "m-manager", fullLegalName: "سامي حداد", phoneNumber: "+972501000002", role: OrgRole.FIELD_MANAGER });
const worker1 = devUser({ membershipId: "m-worker-1", fullLegalName: "خالد عيسى", phoneNumber: "+972501000003", role: OrgRole.WORKER });
const worker2 = devUser({ membershipId: "m-worker-2", fullLegalName: "يوسف ناصر", phoneNumber: "+972501000004", role: OrgRole.WORKER });
const DEV_USERS = [owner, manager, worker1, worker2];

function apiError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return new ApiRequestError(status, { statusCode: status, code, message, details, correlationId: "corr-1" });
}

function fill(message: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), message);
}

function signInAs(user: DevLoginUser): string {
  return fill(ar.devLogin.signInAs, { name: user.fullLegalName, role: ar.enums.OrgRole[user.role] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderLogin() {
  await render(
    <IntlRoot
      onError={(error) => {
        throw error;
      }}
    >
      <LoginScreen />
    </IntlRoot>,
  );
  // Let the dev-login probe (listDevLoginUsers) settle.
  await act(async () => {});
}

type JsonNode = { props?: Record<string, unknown>; children?: (JsonNode | string)[] | null } | string | null | undefined;

/** Every string a worker can see or hear: text content plus accessibility labels and placeholders. */
function visibleStrings(node: JsonNode | JsonNode[], out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const child of node) visibleStrings(child, out);
    return out;
  }
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  for (const prop of ["accessibilityLabel", "aria-label", "placeholder"]) {
    const value = node.props?.[prop];
    if (typeof value === "string") out.push(value);
  }
  visibleStrings(node.children ?? null, out);
  return out;
}

/**
 * No English UI text and no Arabic-Indic digits. Legitimate Latin data is
 * stripped first: the brand name, "SMS", "API" and the seed command inside
 * Arabic sentences, and any test data (phone numbers, organization ids).
 */
function expectArabicOnly(knownData: string[] = []) {
  let text = visibleStrings(screen.toJSON() as JsonNode).join("\n");
  for (const data of [ar.app.brand, "SMS", "API", "pnpm db:seed", ...knownData]) text = text.split(data).join(" ");
  expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([]);
  expect(text).not.toMatch(/[٠-٩۰-۹]/);
}

beforeEach(async () => {
  await SecureStore.setItemAsync("fieldmaster.deviceId", DEVICE_ID);
  mockOfflineSync.isOnline = true;
  mockClient.listDevLoginUsers.mockResolvedValue(null);
  mockClient.devLogin.mockResolvedValue(session);
  mockClient.requestOtp.mockResolvedValue(undefined);
  mockClient.verifyOtp.mockResolvedValue(session);
  mockLogin.mockResolvedValue(undefined);
});

async function goToCodeStep(phone = PHONE) {
  await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), phone);
  await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
  await screen.findByLabelText(ar.auth.codeLabel);
}

/** The number belongs to several organizations: the first verify asks which one, the second (with organizationId) runs `second`. */
function mockOrganizationChoice(organizations: unknown, second: (organizationId: string) => Promise<AuthSession> = async () => session) {
  mockClient.verifyOtp.mockImplementation(async (input: { organizationId?: string }) => {
    if (!input.organizationId) {
      throw apiError(400, "ORGANIZATION_SELECTION_REQUIRED", "Select which organization to sign in to.", { organizations });
    }
    return second(input.organizationId);
  });
}

const TWO_ORGANIZATIONS = [
  { organizationId: "org-north", role: OrgRole.WORKER },
  { organizationId: "org-south", role: OrgRole.FIELD_MANAGER },
];

async function goToOrganizationStep() {
  await renderLogin();
  await goToCodeStep();
  await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "123456");
  await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));
  await screen.findByText(ar.auth.chooseOrganization);
}

function organizationCard(roleLabel: string) {
  return screen.getByRole("button", { name: new RegExp(roleLabel) });
}

describe("LoginScreen (Arabic, RTL)", () => {
  it("shows the Arabic phone step with the brand and subtitle, and no test options when dev login is off", async () => {
    await renderLogin();

    expect(screen.getByRole("header", { name: ar.app.brand })).toBeOnTheScreen();
    expect(screen.getByText(ar.auth.subtitle)).toBeOnTheScreen();
    const phoneInput = screen.getByLabelText(ar.auth.phoneLabel);
    expect(phoneInput).toHaveProp("keyboardType", "phone-pad");
    expect(phoneInput).toHaveProp("placeholder", ar.auth.phonePlaceholder);
    expect(phoneInput).toHaveProp("editable", true);
    // The label is on screen, but hidden from screen readers: the input already carries it, so it is read once.
    expect(screen.getByText(ar.auth.phoneLabel, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(ar.auth.phoneLabel)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeEnabled();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.devLogin.bannerTitle)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.devLogin.quickLoginTitle)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("keeps the test options hidden when the dev-login probe fails (API unreachable)", async () => {
    mockClient.listDevLoginUsers.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderLogin();

    expect(screen.queryByText(ar.devLogin.bannerTitle)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("warns above the form when the phone has no internet, and still lets the worker try", async () => {
    mockOfflineSync.isOnline = false;
    await renderLogin();

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(ar.connection.offline, { exact: false });
    expect(notice).toHaveTextContent(ar.auth.offlineHint, { exact: false });
    expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeEnabled();
    expectArabicOnly();
  });

  describe("test mode (dev login)", () => {
    beforeEach(() => {
      mockClient.listDevLoginUsers.mockResolvedValue(DEV_USERS);
    });

    it("shows the Arabic test-mode banner and the quick-login list grouped by role with LTR phone numbers", async () => {
      await renderLogin();

      expect(screen.getByText(ar.devLogin.bannerTitle)).toBeOnTheScreen();
      expect(screen.getByText(ar.devLogin.bannerBody)).toBeOnTheScreen();
      expect(screen.getByText(ar.devLogin.quickLoginTitle)).toBeOnTheScreen();
      expect(screen.getByText(ar.devLogin.quickLoginDescription)).toBeOnTheScreen();
      expect(screen.getByText(`${ar.devLogin.groupOwners} ${fill(ar.devLogin.groupCount, { count: "1" })}`)).toBeOnTheScreen();
      expect(screen.getByText(`${ar.devLogin.groupFieldManagers} ${fill(ar.devLogin.groupCount, { count: "1" })}`)).toBeOnTheScreen();
      expect(screen.getByText(`${ar.devLogin.groupWorkers} ${fill(ar.devLogin.groupCount, { count: "2" })}`)).toBeOnTheScreen();

      for (const user of DEV_USERS) {
        const button = screen.getByRole("button", { name: signInAs(user) });
        expect(button).toBeEnabled();
        expect(button).toHaveTextContent(user.fullLegalName, { exact: false });
        // The phone number is wrapped in left-to-right isolate marks so "+972..." keeps its order inside RTL text.
        expect(screen.getByText(isolateLtr(user.phoneNumber))).toBeOnTheScreen();
      }
      // One organization only: no organization name on each row.
      expect(screen.queryByText(owner.organizationName)).not.toBeOnTheScreen();
      expect(screen.queryByText(ar.devLogin.noUsers)).not.toBeOnTheScreen();
      expectArabicOnly(DEV_USERS.map((u) => u.phoneNumber));
    });

    it("shows the organization name on each row when the seeded users belong to several organizations", async () => {
      const other = devUser({ ...worker2, organizationId: "org-2", organizationName: "شركة الطرق" });
      mockClient.listDevLoginUsers.mockResolvedValue([owner, other]);
      await renderLogin();

      expect(screen.getByText(owner.organizationName)).toBeOnTheScreen();
      expect(screen.getByText(other.organizationName)).toBeOnTheScreen();
      expectArabicOnly([owner.phoneNumber, other.phoneNumber]);
    });

    it("explains in Arabic when there are no seeded users", async () => {
      mockClient.listDevLoginUsers.mockResolvedValue([]);
      await renderLogin();

      expect(screen.getByText(ar.devLogin.bannerTitle)).toBeOnTheScreen();
      expect(screen.getByText(ar.devLogin.noUsers)).toBeOnTheScreen();
      expect(screen.queryByText(new RegExp(ar.devLogin.groupWorkers))).not.toBeOnTheScreen();
      expectArabicOnly();
    });

    it("signs in with one tap: devLogin({membershipId, deviceId, platform}) then login(session), showing the busy state meanwhile", async () => {
      const pending = deferred<AuthSession>();
      mockClient.devLogin.mockReturnValue(pending.promise);
      await renderLogin();

      await fireEvent.press(screen.getByRole("button", { name: signInAs(worker1) }));

      await waitFor(() => expect(mockClient.devLogin).toHaveBeenCalledTimes(1));
      expect(mockClient.devLogin).toHaveBeenCalledWith({ membershipId: worker1.membershipId, deviceId: DEVICE_ID, platform: "IOS" });
      expect(screen.getByText(ar.devLogin.signingIn)).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: signInAs(worker1) })).toBeBusy();
      expect(screen.getByRole("button", { name: signInAs(owner) })).toBeDisabled();
      expectArabicOnly(DEV_USERS.map((u) => u.phoneNumber));

      await act(async () => pending.resolve(session));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
    });

    it("shows the Arabic quick-login failure when the API cannot be reached, and clears it when the worker tries again", async () => {
      mockClient.devLogin.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
      await renderLogin();

      await fireEvent.press(screen.getByRole("button", { name: signInAs(owner) }));

      expect(await screen.findByText(ar.devLogin.failed)).toBeOnTheScreen();
      expect(mockLogin).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: signInAs(owner) })).toBeEnabled();
      expect(screen.queryByText(ar.devLogin.signingIn)).not.toBeOnTheScreen();
      expectArabicOnly(DEV_USERS.map((u) => u.phoneNumber));

      // Second try: the old message goes away while signing in, and the sign-in completes.
      const retry = deferred<AuthSession>();
      mockClient.devLogin.mockReturnValueOnce(retry.promise);
      await fireEvent.press(screen.getByRole("button", { name: signInAs(owner) }));
      expect(screen.queryByText(ar.devLogin.failed)).not.toBeOnTheScreen();
      expect(screen.getByText(ar.devLogin.signingIn)).toBeOnTheScreen();

      await act(async () => retry.resolve(session));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
      expect(mockClient.devLogin).toHaveBeenCalledTimes(2);
    });

    it("translates an API error from quick login and never shows the English API message", async () => {
      mockClient.devLogin.mockRejectedValue(apiError(403, "FORBIDDEN", "Dev login is not allowed for this membership."));
      await renderLogin();

      await fireEvent.press(screen.getByRole("button", { name: signInAs(manager) }));

      expect(await screen.findByText(ar.errors.FORBIDDEN)).toBeOnTheScreen();
      expect(screen.queryByText(/Dev login is not allowed/)).not.toBeOnTheScreen();
      expectArabicOnly(DEV_USERS.map((u) => u.phoneNumber));
    });

    it("shows the general Arabic error (not 'is the API running?') when quick login fails on the phone itself", async () => {
      // e.g. saving the session in SecureStore failed: the API is not the problem.
      mockLogin.mockRejectedValue(new Error("SecureStore is unavailable"));
      await renderLogin();

      await fireEvent.press(screen.getByRole("button", { name: signInAs(worker2) }));

      expect(await screen.findByText(ar.errors.unknown)).toBeOnTheScreen();
      expect(screen.queryByText(ar.devLogin.failed)).not.toBeOnTheScreen();
      expect(screen.queryByText(/SecureStore/)).not.toBeOnTheScreen();
      expect(screen.getByRole("button", { name: signInAs(worker2) })).toBeEnabled();
      expectArabicOnly(DEV_USERS.map((u) => u.phoneNumber));
    });

    it("shows the fixed test code hint (LTR) on the code step", async () => {
      await renderLogin();
      await goToCodeStep();

      expect(screen.getByText(fill(ar.auth.testModeCodeHint.replace("<code></code>", "{code}"), { code: isolateLtr("123456") }))).toBeOnTheScreen();
      expectArabicOnly([PHONE, ...DEV_USERS.map((u) => u.phoneNumber)]);
    });
  });

  describe("OTP sign-in", () => {
    it("requests a code for the trimmed phone number, then verifies with the exact payload and logs in", async () => {
      await renderLogin();

      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), `  ${PHONE} `);
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));

      expect(mockClient.requestOtp).toHaveBeenCalledTimes(1);
      expect(mockClient.requestOtp).toHaveBeenCalledWith(PHONE);
      const codeInput = await screen.findByLabelText(ar.auth.codeLabel);
      expect(codeInput).toHaveProp("keyboardType", "number-pad");
      // No example code: in production it could be mistaken for the real one.
      expect(codeInput).not.toHaveProp("placeholder");
      // "Enter the code sent to <phone>": the phone number is an LTR island inside the Arabic sentence.
      expect(screen.getByText(ar.auth.codeSentTo.replace("<phone></phone>", isolateLtr(PHONE)))).toBeOnTheScreen();
      expect(screen.getByText(ar.auth.codeLabel, { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.queryByText(ar.auth.codeLabel)).not.toBeOnTheScreen();
      // Not in test mode: no fixed-code hint.
      expect(screen.queryByText(isolateLtr("123456"), { exact: false })).not.toBeOnTheScreen();
      // The way back is a full-size button (56 points), easy to hit with gloves.
      expect(screen.getByRole("button", { name: ar.auth.useDifferentNumber })).toHaveStyle({ minHeight: TOUCH_TARGET });
      expectArabicOnly([PHONE]);

      await fireEvent.changeText(codeInput, " 123456 ");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));

      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
      expect(mockClient.verifyOtp).toHaveBeenCalledTimes(1);
      expect(mockClient.verifyOtp).toHaveBeenCalledWith({
        phoneNumber: PHONE,
        code: "123456",
        deviceId: DEVICE_ID,
        platform: "IOS",
        organizationId: undefined,
      });
    });

    it("sends the code and verifies from the keyboard's submit key too", async () => {
      await renderLogin();

      const phoneInput = screen.getByLabelText(ar.auth.phoneLabel);
      await fireEvent.changeText(phoneInput, PHONE);
      await fireEvent(phoneInput, "submitEditing");

      expect(mockClient.requestOtp).toHaveBeenCalledTimes(1);
      expect(mockClient.requestOtp).toHaveBeenCalledWith(PHONE);
      const codeInput = await screen.findByLabelText(ar.auth.codeLabel);

      await fireEvent.changeText(codeInput, "123456");
      await fireEvent(codeInput, "submitEditing");

      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
      expect(mockClient.verifyOtp).toHaveBeenCalledTimes(1);
      expect(mockClient.verifyOtp).toHaveBeenCalledWith({
        phoneNumber: PHONE,
        code: "123456",
        deviceId: DEVICE_ID,
        platform: "IOS",
        organizationId: undefined,
      });
    });

    it("shows the Arabic busy labels and locks the fields while sending and verifying", async () => {
      const sending = deferred<undefined>();
      mockClient.requestOtp.mockReturnValue(sending.promise);
      const verifying = deferred<AuthSession>();
      mockClient.verifyOtp.mockReturnValue(verifying.promise);
      await renderLogin();

      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), PHONE);
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      const sendingButton = screen.getByRole("button", { name: ar.auth.sending });
      expect(sendingButton).toBeBusy();
      expect(sendingButton).toBeDisabled();
      expect(screen.getByLabelText(ar.auth.phoneLabel)).toHaveProp("editable", false);
      expectArabicOnly([PHONE]);

      await act(async () => sending.resolve(undefined));
      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "123456");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));
      expect(screen.getByRole("button", { name: ar.auth.verifying })).toBeBusy();
      expect(screen.getByRole("button", { name: ar.auth.useDifferentNumber })).toBeDisabled();
      expect(screen.getByLabelText(ar.auth.codeLabel)).toHaveProp("editable", false);
      expectArabicOnly([PHONE]);

      await act(async () => verifying.resolve(session));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
    });

    it("validates empty fields with Arabic messages instead of calling the API", async () => {
      await renderLogin();

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      expect(screen.getByRole("alert")).toHaveTextContent(ar.auth.phoneRequired);
      expect(mockClient.requestOtp).not.toHaveBeenCalled();
      expectArabicOnly();

      // Spaces only is still empty.
      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), "   ");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      expect(screen.getByText(ar.auth.phoneRequired)).toBeOnTheScreen();
      expect(mockClient.requestOtp).not.toHaveBeenCalled();

      // Typing clears the message.
      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), PHONE);
      expect(screen.queryByText(ar.auth.phoneRequired)).not.toBeOnTheScreen();

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      await screen.findByLabelText(ar.auth.codeLabel);

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));
      expect(screen.getByRole("alert")).toHaveTextContent(ar.auth.codeRequired);
      expect(mockClient.verifyOtp).not.toHaveBeenCalled();
      expectArabicOnly([PHONE]);

      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "1");
      expect(screen.queryByText(ar.auth.codeRequired)).not.toBeOnTheScreen();
    });

    it("goes back to the phone step with the number kept, and a new code starts with an empty code field", async () => {
      mockClient.verifyOtp.mockRejectedValue(apiError(401, "OTP_INVALID_OR_EXPIRED", "Incorrect verification code."));
      await renderLogin();
      await goToCodeStep();
      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "000000");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));
      expect(await screen.findByText(ar.errors.OTP_INVALID_OR_EXPIRED)).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.useDifferentNumber }));

      expect(screen.getByLabelText(ar.auth.phoneLabel)).toHaveDisplayValue(PHONE);
      expect(screen.queryByLabelText(ar.auth.codeLabel)).not.toBeOnTheScreen();
      expect(screen.queryByText(ar.errors.OTP_INVALID_OR_EXPIRED)).not.toBeOnTheScreen();
      expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeEnabled();
      expectArabicOnly();

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));

      expect(await screen.findByLabelText(ar.auth.codeLabel)).toHaveDisplayValue("");
      expect(mockClient.requestOtp).toHaveBeenCalledTimes(2);
      expect(mockClient.requestOtp).toHaveBeenLastCalledWith(PHONE);
      expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
    });

    it("tells the worker in plain Arabic that no account uses this number (verify answers 404)", async () => {
      // A request for an unknown route (phone step) keeps the general message...
      mockClient.requestOtp.mockRejectedValueOnce(apiError(404, "NOT_FOUND", "Cannot POST /auth/otp/request"));
      await renderLogin();
      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), "0501234567");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      expect(await screen.findByText(ar.errors.NOT_FOUND)).toBeOnTheScreen();
      expect(screen.queryByText(ar.auth.noAccount)).not.toBeOnTheScreen();

      // ...but on the code step 404 means the number has no active account (e.g. typed as "05...").
      mockClient.verifyOtp.mockRejectedValue(apiError(404, "NOT_FOUND", "No active account found for this phone number."));
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));
      await fireEvent.changeText(await screen.findByLabelText(ar.auth.codeLabel), "123456");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));

      expect(await screen.findByRole("alert")).toHaveTextContent(ar.auth.noAccount);
      expect(screen.queryByText(ar.errors.NOT_FOUND)).not.toBeOnTheScreen();
      expect(screen.queryByText(/No active account/)).not.toBeOnTheScreen();
      expect(mockLogin).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: ar.auth.useDifferentNumber })).toBeEnabled();
      expectArabicOnly(["0501234567"]);
    });

    it("lets the worker choose an organization (translated roles), showing the busy card while signing in", async () => {
      const signingIn = deferred<AuthSession>();
      mockOrganizationChoice(TWO_ORGANIZATIONS, () => signingIn.promise);
      await goToOrganizationStep();

      expect(screen.getByText(ar.auth.chooseOrganization)).toBeOnTheScreen();
      expect(organizationCard(ar.enums.OrgRole.WORKER)).toBeEnabled();
      expect(organizationCard(ar.enums.OrgRole.FIELD_MANAGER)).toHaveTextContent(isolateLtr("org-south"), { exact: false });
      expect(screen.queryByText(/Select which organization/)).not.toBeOnTheScreen();
      expect(screen.queryByText("FIELD_MANAGER")).not.toBeOnTheScreen();
      expect(screen.queryByLabelText(ar.auth.codeLabel)).not.toBeOnTheScreen();
      expect(mockLogin).not.toHaveBeenCalled();
      expectArabicOnly([PHONE, "org-north", "org-south"]);

      await fireEvent.press(organizationCard(ar.enums.OrgRole.FIELD_MANAGER));

      // The chosen card shows "verifying" with a spinner; everything else waits.
      const busyCard = organizationCard(ar.auth.verifying);
      expect(busyCard).toBeBusy();
      expect(busyCard).toHaveTextContent(isolateLtr("org-south"), { exact: false });
      expect(organizationCard(ar.enums.OrgRole.WORKER)).toBeDisabled();
      expect(screen.getByRole("button", { name: ar.auth.useDifferentNumber })).toBeDisabled();
      expectArabicOnly([PHONE, "org-north", "org-south"]);

      await act(async () => signingIn.resolve(session));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
      expect(mockClient.verifyOtp).toHaveBeenCalledTimes(2);
      expect(mockClient.verifyOtp).toHaveBeenLastCalledWith({
        phoneNumber: PHONE,
        code: "123456",
        deviceId: DEVICE_ID,
        platform: "IOS",
        organizationId: "org-south",
      });
    });

    it("shows each organization's name with the role under it when the API sends the name", async () => {
      mockOrganizationChoice([
        { organizationId: "org-north", role: OrgRole.WORKER, organizationName: "شركة الشمال" },
        { organizationId: "org-south", role: OrgRole.WORKER, organizationName: "شركة الجنوب" },
      ]);
      await goToOrganizationStep();

      const north = organizationCard("شركة الشمال");
      expect(north).toHaveTextContent(ar.enums.OrgRole.WORKER, { exact: false });
      expect(organizationCard("شركة الجنوب")).toBeEnabled();
      // The id is only a fallback when there is no name.
      expect(screen.queryByText(isolateLtr("org-north"))).not.toBeOnTheScreen();
      expectArabicOnly([PHONE]);

      await fireEvent.press(north);
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(session));
      expect(mockClient.verifyOtp).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: "org-north" }));
    });

    it("goes back to the phone step from the organization step", async () => {
      mockOrganizationChoice(TWO_ORGANIZATIONS);
      await goToOrganizationStep();

      await fireEvent.press(screen.getByRole("button", { name: ar.auth.useDifferentNumber }));

      expect(screen.getByLabelText(ar.auth.phoneLabel)).toHaveDisplayValue(PHONE);
      expect(screen.queryByText(ar.auth.chooseOrganization)).not.toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: new RegExp(ar.enums.OrgRole.WORKER) })).not.toBeOnTheScreen();
      expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeEnabled();
      expect(mockLogin).not.toHaveBeenCalled();
      expectArabicOnly();
    });

    it("shows a translated error on the organization step when signing in to the chosen organization fails", async () => {
      mockOrganizationChoice([{ organizationId: "org-north", role: OrgRole.WORKER }], async () => {
        throw apiError(403, "FORBIDDEN", "You are not a member of the requested organization.");
      });
      await goToOrganizationStep();
      await fireEvent.press(organizationCard(ar.enums.OrgRole.WORKER));

      expect(await screen.findByText(ar.errors.FORBIDDEN)).toBeOnTheScreen();
      expect(screen.getByText(ar.auth.chooseOrganization)).toBeOnTheScreen();
      expect(organizationCard(ar.enums.OrgRole.WORKER)).toBeEnabled();
      expect(screen.queryByText(/not a member/)).not.toBeOnTheScreen();
      expectArabicOnly([PHONE, "org-north"]);
    });

    it.each([
      ["OTP_INVALID_OR_EXPIRED", "This verification code is invalid or has expired."],
      ["OTP_MAX_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Request a new code."],
    ] as const)("returns to the code step with an empty field when the code is no longer usable on the organization step (%s)", async (code, english) => {
      mockOrganizationChoice(TWO_ORGANIZATIONS, async () => {
        throw apiError(401, code, english);
      });
      await goToOrganizationStep();
      await fireEvent.press(organizationCard(ar.enums.OrgRole.WORKER));

      expect(await screen.findByText(ar.errors[code])).toBeOnTheScreen();
      expect(screen.queryByText(ar.auth.chooseOrganization)).not.toBeOnTheScreen();
      expect(screen.getByLabelText(ar.auth.codeLabel)).toHaveDisplayValue("");
      expect(screen.getByRole("button", { name: ar.auth.verify })).toBeEnabled();
      expect(screen.getByRole("button", { name: ar.auth.useDifferentNumber })).toBeEnabled();
      expect(screen.queryByText(english)).not.toBeOnTheScreen();
      expect(mockLogin).not.toHaveBeenCalled();
      expectArabicOnly([PHONE]);
    });

    it.each([
      ["an empty list", []],
      ["no list", undefined],
      ["entries without an organization id", [{ role: OrgRole.WORKER }, null, "org-north"]],
    ])("stays on the code step with the general Arabic error when the organization choice has %s", async (_label, organizations) => {
      mockOrganizationChoice(organizations);
      await renderLogin();
      await goToCodeStep();
      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "123456");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));

      expect(await screen.findByRole("alert")).toHaveTextContent(ar.errors.unknown);
      expect(screen.queryByText(ar.auth.chooseOrganization)).not.toBeOnTheScreen();
      expect(screen.getByLabelText(ar.auth.codeLabel)).toHaveDisplayValue("123456");
      expect(screen.getByRole("button", { name: ar.auth.verify })).toBeEnabled();
      expect(mockLogin).not.toHaveBeenCalled();
      expectArabicOnly([PHONE]);
    });

    it("shows the Arabic message for a known API error code (OTP_RATE_LIMITED), never the English API text", async () => {
      mockClient.requestOtp.mockRejectedValue(apiError(429, "OTP_RATE_LIMITED", "Too many verification codes requested. Try again later."));
      await renderLogin();

      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), PHONE);
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));

      expect(await screen.findByText(ar.errors.OTP_RATE_LIMITED)).toBeOnTheScreen();
      expect(screen.queryByText(/Too many/)).not.toBeOnTheScreen();
      // Still on the phone step, ready to retry.
      expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeEnabled();
      expect(screen.getByLabelText(ar.auth.phoneLabel)).toHaveProp("editable", true);
      expectArabicOnly();
    });

    it("shows the Arabic message for a wrong code", async () => {
      mockClient.verifyOtp.mockRejectedValue(apiError(401, "OTP_INVALID_OR_EXPIRED", "Invalid or expired verification code."));
      await renderLogin();
      await goToCodeStep();
      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "000000");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));

      expect(await screen.findByText(ar.errors.OTP_INVALID_OR_EXPIRED)).toBeOnTheScreen();
      expect(screen.queryByText(/Invalid or expired/)).not.toBeOnTheScreen();
      expect(mockLogin).not.toHaveBeenCalled();
      // The worker can correct the code they typed.
      expect(screen.getByLabelText(ar.auth.codeLabel)).toHaveDisplayValue("000000");
      expectArabicOnly([PHONE]);
    });

    it("falls back to the Arabic status message for an unknown error code", async () => {
      mockClient.verifyOtp.mockRejectedValue(apiError(503, "SOME_NEW_CODE", "The SMS gateway is down."));
      await renderLogin();
      await goToCodeStep();
      await fireEvent.changeText(screen.getByLabelText(ar.auth.codeLabel), "123456");
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.verify }));

      expect(await screen.findByText(ar.errors.SERVICE_UNAVAILABLE)).toBeOnTheScreen();
      expect(screen.queryByText(/gateway/)).not.toBeOnTheScreen();
      expectArabicOnly([PHONE]);
    });

    it("shows the Arabic connection message when the API cannot be reached", async () => {
      mockClient.requestOtp.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
      await renderLogin();

      await fireEvent.changeText(screen.getByLabelText(ar.auth.phoneLabel), PHONE);
      await fireEvent.press(screen.getByRole("button", { name: ar.auth.sendCode }));

      expect(await screen.findByText(ar.errors.network)).toBeOnTheScreen();
      expect(screen.queryByText(/Network request failed|Check your connection/)).not.toBeOnTheScreen();
      expectArabicOnly();
    });
  });
});
