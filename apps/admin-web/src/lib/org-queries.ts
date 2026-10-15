/** React Query keys of the flexible organization model (roles, member access, owner limit, work rules). */
export const orgKeys = {
  roles: ["roles"] as const,
  role: (roleId: string) => ["roles", roleId] as const,
  memberAccess: ["member-access"] as const,
  ownerLimit: ["owner-limit"] as const,
  workRules: ["work-rules"] as const,
  workRulesImpact: (effectiveFrom: string) => ["work-rules", "impact", effectiveFrom] as const,
};
