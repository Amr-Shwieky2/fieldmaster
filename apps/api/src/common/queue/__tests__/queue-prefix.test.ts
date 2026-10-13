import { queuePrefix } from "../queue.constants";

describe("queuePrefix", () => {
  it("is one prefix per database, so the dev server and the e2e tests never take each other's jobs", () => {
    expect(queuePrefix({ DATABASE_URL: "postgresql://u:p@localhost:5433/fieldmaster?schema=public" })).toBe("fm:fieldmaster");
    expect(queuePrefix({ DATABASE_URL: "postgresql://u:p@localhost:5433/fieldmaster_test?schema=public" })).toBe("fm:fieldmaster_test");
  });

  it("uses QUEUE_PREFIX when set, and a fixed default without a database URL", () => {
    expect(queuePrefix({ QUEUE_PREFIX: "custom", DATABASE_URL: "postgresql://u:p@localhost/fieldmaster" })).toBe("custom");
    expect(queuePrefix({})).toBe("fm:fieldmaster");
    expect(queuePrefix({ DATABASE_URL: "not a url" })).toBe("fm:fieldmaster");
  });
});
