"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError, type AuthSession } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DevQuickLogin, TestModeBanner, useDevLoginUsers } from "@/components/dev-quick-login";

type Step = "phone" | "code";

export default function LoginPage() {
  const router = useRouter();
  const { client, login } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<{ organizationId: string; role: string }[] | null>(null);
  // Non-null only while the API runs in dev login (test) mode; otherwise every test option stays hidden.
  const devUsers = useDevLoginUsers().data ?? null;
  const devMode = devUsers !== null;

  function completeLogin(session: AuthSession) {
    login(session);
    router.replace("/dashboard");
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await client.requestOtp(phoneNumber);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent, organizationId?: string) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await client.verifyOtp({ phoneNumber, code, deviceId: "admin-web", platform: "WEB", organizationId });
      completeLogin(session);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === "ORGANIZATION_SELECTION_REQUIRED") {
        setOrganizations((err.body.details?.organizations as { organizationId: string; role: string }[]) ?? []);
        return;
      }
      setError(err instanceof ApiRequestError ? err.body.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4 py-10">
      {devMode && (
        <div className="w-full max-w-xl">
          <TestModeBanner />
        </div>
      )}
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>FieldMaster</CardTitle>
          <p className="mt-1 text-sm text-slate-500">Sign in to the admin dashboard</p>
        </CardHeader>
        <CardContent>
          {step === "phone" && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" type="tel" required placeholder="+972501234567" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending…" : "Send verification code"}
              </Button>
            </form>
          )}

          {step === "code" && !organizations && (
            <form onSubmit={(e) => handleVerify(e)} className="space-y-4">
              <p className="text-sm text-slate-600">
                Enter the code sent to <span className="font-medium">{phoneNumber}</span>.
              </p>
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="123456"
                  aria-describedby={devMode ? "code-hint" : undefined}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {devMode && (
                  <p id="code-hint" className="mt-1 text-xs text-amber-700">
                    Test mode — code: <span className="font-mono font-semibold">123456</span>
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Verifying…" : "Verify and sign in"}
              </Button>
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => setStep("phone")}>
                Use a different phone number
              </button>
            </form>
          )}

          {organizations && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">This phone number belongs to multiple organizations. Choose one:</p>
              {organizations.map((org) => (
                <Button key={org.organizationId} variant="secondary" className="w-full justify-between" onClick={(e) => handleVerify(e, org.organizationId)}>
                  <span>{org.organizationId}</span>
                  <span className="text-slate-400">{org.role}</span>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {devMode && (
        <div className="w-full max-w-xl">
          <DevQuickLogin users={devUsers} onLoggedIn={completeLogin} />
        </div>
      )}
    </main>
  );
}
