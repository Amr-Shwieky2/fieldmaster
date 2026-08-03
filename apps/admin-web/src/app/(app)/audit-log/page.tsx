"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { OwnerOnly } from "@/components/owner-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

function AuditLogContent() {
  const { client } = useAuth();
  const auditQuery = useQuery({ queryKey: ["audit-logs"], queryFn: () => client.listAuditLogs() });
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; brokenAtId?: string } | null>(null);

  const verify = useMutation({
    mutationFn: () => client.verifyAuditChain(),
    onSuccess: setVerifyResult,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500">Append-only, SHA-256 hash-chained event history.</p>
        </div>
        <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? "Verifying…" : "Verify chain integrity"}
        </Button>
      </div>

      {verifyResult && (
        <Card>
          <CardContent className="py-4">
            {verifyResult.valid ? (
              <Badge tone="success">Chain verified — no tampering detected</Badge>
            ) : (
              <Badge tone="danger">Chain broken at audit log {verifyResult.brokenAtId}</Badge>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditQuery.isLoading && <LoadingState />}
          {auditQuery.isError && <ErrorState message={(auditQuery.error as Error).message} />}
          {auditQuery.data && auditQuery.data.items.length === 0 && <EmptyState title="No audit events yet" />}
          {auditQuery.data && auditQuery.data.items.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Entity</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {auditQuery.data.items.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{e.action}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {e.entityType} · {e.entityId.slice(0, 8)}…
                    </td>
                    <td className="px-5 py-3 text-slate-600">{e.reason ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <OwnerOnly>
      <AuditLogContent />
    </OwnerOnly>
  );
}
