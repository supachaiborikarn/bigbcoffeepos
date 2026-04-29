type LoginPayload = {
  user: { id: number; name: string; role: string };
  token: string;
};

type Branch = {
  id: number;
  name: string;
  branchType?: string;
};

type Shift = {
  id: number;
  branchId: number;
  status: "OPEN" | "CLOSED";
  openingCash: number;
  cashSales: number;
};

const API_URL = process.env.API_URL || "http://localhost:5175/api";
const CHECK_PIN = process.env.CHECK_PIN || "1234";

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : response.statusText;
    throw new Error(`${init?.method || "GET"} ${path} failed: ${message}`);
  }
  return payload as T;
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const login = await readJson<LoginPayload>("/auth/pin", {
  method: "POST",
  body: JSON.stringify({ pin: CHECK_PIN })
});

const authHeaders = { Authorization: `Bearer ${login.token}` };

const health = await readJson<{ ok: boolean }>("/health", { headers: authHeaders });
assert(health.ok, "Health check did not return ok=true");

const branchesPayload = await readJson<{ items: Branch[] }>("/branches", { headers: authHeaders });
assert(branchesPayload.items.length > 0, "No branches returned");

const branchResults: string[] = [];
for (const branch of branchesPayload.items) {
  const currentPayload = await readJson<{ shift: Shift | null }>(
    `/shifts/current?branchId=${branch.id}`,
    { headers: authHeaders }
  );

  if (currentPayload.shift) {
    branchResults.push(`${branch.name}: existing open shift #${currentPayload.shift.id}, open/close mutation skipped`);
    continue;
  }

  const openedPayload = await readJson<{ shift: Shift }>("/shifts/open", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ branchId: branch.id, userId: login.user.id, openingCash: 0 })
  });
  assert(openedPayload.shift.status === "OPEN", `${branch.name}: opened shift is not OPEN`);

  const refreshedPayload = await readJson<{ shift: Shift | null }>(
    `/shifts/current?branchId=${branch.id}`,
    { headers: authHeaders }
  );
  assert(refreshedPayload.shift?.id === openedPayload.shift.id, `${branch.name}: current shift did not refresh`);

  const closingCash = openedPayload.shift.openingCash + openedPayload.shift.cashSales;
  const closedPayload = await readJson<{ shift: Shift }>(`/shifts/${openedPayload.shift.id}/close`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ closingCash })
  });
  assert(closedPayload.shift.status === "CLOSED", `${branch.name}: closed shift is not CLOSED`);

  branchResults.push(`${branch.name}: opened and closed shift #${openedPayload.shift.id}`);
}

const backupStatusPayload = await readJson<{ status: { enabled: boolean; message?: string } }>("/backups/status", {
  headers: authHeaders
});
assert(backupStatusPayload.status.enabled === false, "PostgreSQL runtime should not expose SQLite backups");

let backupUnavailable = false;
try {
  await readJson<{ backup: { filename: string; sizeBytes: number } }>("/backups", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ reason: "phase13-check" })
  });
} catch (error) {
  backupUnavailable = String((error as Error).message).includes("503") || String((error as Error).message).includes("unavailable");
}
assert(backupUnavailable, "Manual SQLite backup should be unavailable in PostgreSQL runtime");

const auditPayload = await readJson<{ items: unknown[] }>("/audit?limit=5", {
  headers: authHeaders
});
assert(Array.isArray(auditPayload.items), "Audit search did not return an items array");

await readJson<unknown>("/audit.csv?limit=5", {
  headers: authHeaders
});

const integrationSummary = await readJson<{ summary: { maxAttempts: number; byStatus: unknown[] } }>("/integrations/summary", {
  headers: authHeaders
});
assert(integrationSummary.summary.maxAttempts >= 1, "Integration summary missing retry max attempts");

/*
const backupPayload = await readJson<{ backup: { filename: string; sizeBytes: number } }>("/backups", {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ reason: "phase13-check" })
});
assert(backupPayload.backup.sizeBytes > 0, "Manual backup was empty");

const statusPayload = await readJson<{ status: { backups: unknown[]; enabled: boolean } }>("/backups/status", {
  headers: authHeaders
});
assert(statusPayload.status.backups.length > 0, "Backup status did not include backups");
*/

console.log("Phase 1.3 infrastructure check passed");
console.log(`User: ${login.user.name} (${login.user.role})`);
console.log(`Branches checked: ${branchesPayload.items.length}`);
branchResults.forEach((line) => console.log(`- ${line}`));
console.log("PostgreSQL backup policy: provider snapshot required; SQLite runtime backup disabled");
console.log(`Audit sample rows: ${auditPayload.items.length}`);
