/** Imported contacts can predate branch assignments. Never infer their branch from a name. */
export function customerHomeBranch(customer: { metadata?: string; orders?: Array<{ branchId: number }> }): number | null {
  try {
    const metadata = JSON.parse(customer.metadata || "{}");
    if (Number.isInteger(metadata.workspaceBranchId) && metadata.workspaceBranchId > 0) return metadata.workspaceBranchId;
  } catch { /* Legacy metadata may be malformed. */ }
  const branches = new Set(customer.orders?.map((order) => order.branchId) ?? []);
  return branches.size === 1 ? [...branches][0] : null;
}
