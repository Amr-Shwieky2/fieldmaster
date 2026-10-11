/** Sets env vars for the duration of a describe block (the API reads them when the app module is created). */
export function useEnv(vars: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [key, value] of Object.entries(vars)) {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
