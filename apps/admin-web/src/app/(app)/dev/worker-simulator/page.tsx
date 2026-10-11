import { notFound } from "next/navigation";
import { isDevLoginEnabledOnServer } from "@/lib/dev-mode";
import { WorkerSimulator } from "@/components/worker-simulator/worker-simulator";

// Decided per request: the API's dev login mode can change without a rebuild.
export const dynamic = "force-dynamic";

/**
 * Test tool: act as any seeded worker through the real API. Exists only while
 * the API is in dev login (test) mode -- otherwise this route is a 404, the
 * same as a page that does not exist.
 */
export default async function WorkerSimulatorPage() {
  if (!(await isDevLoginEnabledOnServer())) notFound();
  return <WorkerSimulator />;
}
