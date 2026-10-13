import { describe, expect, it, vi } from "vitest";

// Step 8: the approval form moved to the Owner's review page (its tests now live in
// src/app/(app)/workers/_components/__tests__/approval-form.test.tsx); this route only redirects there.

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    // Like Next's redirect(), it never returns.
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import ApproveWorkerPage from "../page";

describe("Old approve worker route", () => {
  it("redirects to the worker's review page", async () => {
    await expect(ApproveWorkerPage({ params: Promise.resolve({ id: "w-pending" }) })).rejects.toThrow("NEXT_REDIRECT /workers/w-pending/review");
    expect(navigation.redirect).toHaveBeenCalledWith("/workers/w-pending/review");
  });
});
