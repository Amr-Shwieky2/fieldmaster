"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const router = useRouter();
  const { isAuthenticated, isReady } = useAuth();

  useEffect(() => {
    if (isReady) router.replace(isAuthenticated ? "/dashboard" : "/login");
  }, [isReady, isAuthenticated, router]);

  return null;
}
