import { ensureRtl, RTL_RELOAD_FLAG, type RtlEnvironment } from "../rtl";

function environment(overrides: Partial<RtlEnvironment> = {}): RtlEnvironment & { stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    os: "ios",
    isRTL: false,
    inExpoGo: false,
    allowRTL: jest.fn(),
    forceRTL: jest.fn(),
    reload: jest.fn(async () => undefined),
    storage: {
      getItem: async (key) => stored.get(key) ?? null,
      setItem: async (key, value) => {
        stored.set(key, value);
      },
      removeItem: async (key) => {
        stored.delete(key);
      },
    },
    ...overrides,
    stored,
  };
}

describe("ensureRtl (one-time RTL bootstrap)", () => {
  it("does nothing when the layout is already RTL (configured build, Expo Go with extra.forcesRTL) and clears the reload flag", async () => {
    const env = environment({ isRTL: true });
    env.stored.set(RTL_RELOAD_FLAG, "1");
    expect(await ensureRtl(env)).toBe("ok");
    expect(env.forceRTL).not.toHaveBeenCalled();
    expect(env.reload).not.toHaveBeenCalled();
    expect(env.stored.has(RTL_RELOAD_FLAG)).toBe(false);
  });

  it("forces RTL and reloads exactly once on a native build that started LTR", async () => {
    const env = environment();
    expect(await ensureRtl(env)).toBe("reloading");
    expect(env.allowRTL).toHaveBeenCalledWith(true);
    expect(env.forceRTL).toHaveBeenCalledWith(true);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("never loops: a second LTR start after the reload does not reload again", async () => {
    const env = environment();
    await ensureRtl(env);
    expect(await ensureRtl(env)).toBe("unavailable");
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload in Expo Go, which only honours app.json extra.forcesRTL", async () => {
    const env = environment({ inExpoGo: true });
    expect(await ensureRtl(env)).toBe("unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("does nothing on web, where RTL comes from dir=\"rtl\" (I18nManager.isRTL is undefined there)", async () => {
    const env = environment({ os: "web", isRTL: undefined });
    expect(await ensureRtl(env)).toBe("ok");
    expect(env.forceRTL).not.toHaveBeenCalled();
    expect(env.reload).not.toHaveBeenCalled();
  });
});
