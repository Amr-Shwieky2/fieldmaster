"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiRequestError, type AuthSession } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { useErrorMessage } from "@/lib/use-error-message";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrText } from "@/components/formatted";
import { DevQuickLogin, TestModeBanner, useDevLoginUsers } from "@/components/dev-quick-login";

type Step = "phone" | "code";

const DEV_FIXED_CODE = "123456";

export default function LoginPage() {
  const router = useRouter();
  const { client, login } = useAuth();
  const t = useTranslations("auth");
  const tShell = useTranslations("shell");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  // The cause is kept and translated while rendering. The forms use noValidate,
  // so an empty field gets this Arabic message instead of the browser's own bubble.
  const [failure, setFailure] = useState<{ cause: unknown } | { missing: "phoneRequired" | "codeRequired" } | null>(null);
  const error = failure ? ("missing" in failure ? t(failure.missing) : errorMessage(failure.cause)) : null;
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
    if (phoneNumber.trim() === "") {
      setFailure({ missing: "phoneRequired" });
      return;
    }
    setFailure(null);
    setSubmitting(true);
    try {
      await client.requestOtp(phoneNumber);
      setStep("code");
    } catch (err) {
      setFailure({ cause: err });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent, organizationId?: string) {
    e.preventDefault();
    if (code.trim() === "") {
      setFailure({ missing: "codeRequired" });
      return;
    }
    setFailure(null);
    setSubmitting(true);
    try {
      const session = await client.verifyOtp({ phoneNumber, code, deviceId: "admin-web", platform: "WEB", organizationId });
      completeLogin(session);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === "ORGANIZATION_SELECTION_REQUIRED") {
        setOrganizations((err.body.details?.organizations as { organizationId: string; role: string }[]) ?? []);
        return;
      }
      setFailure({ cause: err });
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
          <CardTitle>{tShell("brand")}</CardTitle>
          <h1 className="mt-1 text-sm text-slate-500">{t("subtitle")}</h1>
        </CardHeader>
        <CardContent>
          {step === "phone" && (
            <form noValidate onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <Label htmlFor="phone">{t("phoneLabel")}</Label>
                <Input
                  id="phone"
                  type="tel"
                  dir="ltr"
                  autoComplete="tel"
                  required
                  placeholder="+972501234567"
                  className="text-start"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t("sending") : t("sendCode")}
              </Button>
            </form>
          )}

          {step === "code" && !organizations && (
            <form noValidate onSubmit={(e) => handleVerify(e)} className="space-y-4">
              <p className="text-sm text-slate-600">
                {t.rich("codeSentTo", { phone: () => <LtrText className="font-medium">{phoneNumber}</LtrText> })}
              </p>
              <div>
                <Label htmlFor="code">{t("codeLabel")}</Label>
                <Input
                  id="code"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="123456"
                  className="text-start"
                  aria-describedby={devMode ? "code-hint" : undefined}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {devMode && (
                  <p id="code-hint" className="mt-1 text-xs text-amber-700">
                    {t.rich("testModeCodeHint", { code: () => <LtrText className="font-mono font-semibold">{DEV_FIXED_CODE}</LtrText> })}
                  </p>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t("verifying") : t("verify")}
              </Button>
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => setStep("phone")}>
                {t("useDifferentNumber")}
              </button>
            </form>
          )}

          {organizations && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{t("chooseOrganization")}</p>
              {organizations.map((org) => (
                <Button key={org.organizationId} variant="secondary" className="w-full justify-between" onClick={(e) => handleVerify(e, org.organizationId)}>
                  <LtrText>{org.organizationId}</LtrText>
                  <span className="text-slate-400">{enumLabel("OrgRole", org.role)}</span>
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
