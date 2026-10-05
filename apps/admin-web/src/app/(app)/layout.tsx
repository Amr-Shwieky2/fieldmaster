"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";
import { LoadingState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isReady, session, logout } = useAuth();

  useEffect(() => {
    if (isReady && !isAuthenticated) router.replace("/login");
  }, [isReady, isAuthenticated, router]);

  if (!isAuthenticated) return <LoadingState />;

  // The dashboard is for Owners and Field Managers; every page would only
  // show 403 errors to a Worker (the API enforces that regardless).
  if (session?.role === OrgRole.WORKER) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Workers use the mobile app</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              The FieldMaster admin dashboard is for Owners and Field Managers. As a worker, use the FieldMaster mobile app to clock in and out
              and to see your shifts and attendance history.
            </p>
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 overflow-y-auto bg-slate-50 p-8">{children}</main>
    </div>
  );
}
