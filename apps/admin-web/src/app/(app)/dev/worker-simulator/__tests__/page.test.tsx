import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "@/lib/api-url";
import { WorkerSimulator } from "@/components/worker-simulator/worker-simulator";
import WorkerSimulatorPage, { dynamic } from "../page";

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/worker-simulator/worker-simulator", () => ({ WorkerSimulator: () => null }));

function stubFetch(answer: () => Promise<Response>) {
  const fetchMock = vi.fn(answer);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  notFound.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/dev/worker-simulator (server-side gate)", () => {
  it("asks the API on every request, with the same signal as the login page", async () => {
    const fetchMock = stubFetch(async () => new Response("[]", { status: 200 }));
    const element = await WorkerSimulatorPage();
    expect(dynamic).toBe("force-dynamic");
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/auth/dev/users`, { cache: "no-store" });
    expect(element.type).toBe(WorkerSimulator);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("is a 404 when the API is not in dev login mode", async () => {
    stubFetch(async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }));
    await expect(WorkerSimulatorPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("is a 404 when the API cannot be reached", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(WorkerSimulatorPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
