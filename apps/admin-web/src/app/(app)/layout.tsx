"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";
import { AppHeader } from "@/components/app-header";
import { LoadingState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isReady, session, logout } = useAuth();
  const t = useTranslations("workerNotice");
  const tShell = useTranslations("shell");

  useEffect(() => {
    if (isReady && !isAuthenticated) router.replace("/login");
  }, [isReady, isAuthenticated, router]);

  if (!isAuthenticated) return <LoadingState />;

  // The dashboard is for Owners and Field Managers; every page would only
  // show 403 errors to a Worker (the API enforces that regardless).
  if (session?.role === OrgRole.WORKER) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">{t("body")}</p>
            <Button variant="secondary" onClick={logout}>
              {tShell("signOut")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        {tShell("skipToContent")}
      </a>
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main id="main" className="flex-1 overflow-y-auto bg-slate-50 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
