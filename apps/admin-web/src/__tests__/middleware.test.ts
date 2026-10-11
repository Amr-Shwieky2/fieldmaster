import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { API_URL } from "@/lib/api-url";
import { DEV_PAGE_UNAVAILABLE_PATH, config, middleware } from "../middleware";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDevUsers(answer: () => Promise<Response>) {
  const fetchMock = vi.fn(answer);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const request = () => new NextRequest("http://localhost:3001/dev/worker-simulator");

describe("/dev/* middleware (real 404 when dev login is off)", () => {
  it("only guards the /dev pages", () => {
    expect(config.matcher).toEqual(["/dev/:path*"]);
  });

  it("lets the page render while the API is in dev login mode", async () => {
    const fetchMock = stubDevUsers(async () => new Response("[]", { status: 200 }));
    const response = await middleware(request());
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/auth/dev/users`, { cache: "no-store" });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each([
    ["the API answers 404", async () => new Response("{}", { status: 404 })],
    [
      "the API cannot be reached",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("serves the not-found page when %s", async (_case, answer) => {
    stubDevUsers(answer);
    const response = await middleware(request());
    expect(response.headers.get("x-middleware-rewrite")).toBe(`http://localhost:3001${DEV_PAGE_UNAVAILABLE_PATH}`);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
