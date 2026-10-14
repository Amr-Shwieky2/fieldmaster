import { ApiRequestError, NetworkError, type FieldMasterClient } from "@fieldmaster/api-client";
import { requestTokenRefresh, withSessionRecovery } from "../session-recovery";

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("POST /auth/refresh", () => {
  it("returns the new token pair", async () => {
    const fetchImpl = jest.fn(async () => response(200, { accessToken: "new-access", refreshToken: "family:new", expiresIn: 900 }));
    expect(await requestTokenRefresh("http://api.test/api/v1", "family:old", fetchImpl as unknown as typeof fetch)).toEqual({
      accessToken: "new-access",
      refreshToken: "family:new",
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/v1/auth/refresh", expect.objectContaining({ method: "POST", body: JSON.stringify({ refreshToken: "family:old" }) }));
  });

  it("throws the API's error code, or a NetworkError when the server was not reached", async () => {
    const refused = jest.fn(async () => response(401, { statusCode: 401, code: "NO_ACTIVE_MEMBERSHIP", message: "x", correlationId: "c" }));
    await expect(requestTokenRefresh("http://api.test", "r", refused as unknown as typeof fetch)).rejects.toMatchObject({ status: 401, body: { code: "NO_ACTIVE_MEMBERSHIP" } });

    const offline = jest.fn(async () => Promise.reject(new TypeError("Network request failed")));
    await expect(requestTokenRefresh("http://api.test", "r", offline as unknown as typeof fetch)).rejects.toBeInstanceOf(NetworkError);

    const malformed = jest.fn(async () => response(200, { accessToken: "only-one" }));
    await expect(requestTokenRefresh("http://api.test", "r", malformed as unknown as typeof fetch)).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe("client recovery wrapper", () => {
  const expired = new ApiRequestError(401, { statusCode: 401, code: "UNAUTHENTICATED", message: "expired", correlationId: "c" });

  function fakeClient() {
    return {
      listShifts: jest.fn(),
      verifyOtp: jest.fn(async () => Promise.reject(expired)),
      notificationsStreamUrl: jest.fn(() => "http://api.test/stream"),
    };
  }

  it("calls once more when the session was refreshed, with the token seen when the call started", async () => {
    const raw = fakeClient();
    raw.listShifts.mockRejectedValueOnce(expired).mockResolvedValueOnce(["shift"]);
    const onError = jest.fn(async () => "retry" as const);
    const client = withSessionRecovery(raw as unknown as FieldMasterClient, onError, () => "token-1");

    expect(await client.listShifts()).toEqual(["shift"]);
    expect(raw.listShifts).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expired, "token-1");
  });

  it("lets the error through when the provider says so, and retries at most once", async () => {
    const raw = fakeClient();
    raw.listShifts.mockRejectedValue(expired);
    const client = withSessionRecovery(raw as unknown as FieldMasterClient, async () => "retry", () => "token-1");
    await expect(client.listShifts()).rejects.toBe(expired);
    expect(raw.listShifts).toHaveBeenCalledTimes(2);

    const other = fakeClient();
    other.listShifts.mockRejectedValueOnce(expired);
    const refusing = withSessionRecovery(other as unknown as FieldMasterClient, async () => "throw", () => "token-1");
    await expect(refusing.listShifts()).rejects.toBe(expired);
    expect(other.listShifts).toHaveBeenCalledTimes(1);
  });

  it("never touches the sign-in calls (a wrong code is a 401 too) or synchronous helpers", async () => {
    const raw = fakeClient();
    const onError = jest.fn(async () => "retry" as const);
    const client = withSessionRecovery(raw as unknown as FieldMasterClient, onError, () => null);
    await expect(client.verifyOtp({ phoneNumber: "+972500000000", code: "000000", deviceId: "d", platform: "IOS" })).rejects.toBe(expired);
    expect(raw.verifyOtp).toHaveBeenCalledTimes(1);
    expect(client.notificationsStreamUrl("t")).toBe("http://api.test/stream");
    expect(onError).not.toHaveBeenCalled();
  });
});
