import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";

const localJwtFallbackModes = new Set(["", "development", "test", "local"]);
const nodeEnv = process.env.NODE_ENV || "";

if (!localJwtFallbackModes.has(nodeEnv) && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required when NODE_ENV is not development/test/local");
}

const JWT_SECRET = process.env.JWT_SECRET || "bb_pos_secret_key_dev";
if (!process.env.JWT_SECRET) console.warn("[Auth] JWT_SECRET not set - using dev fallback (unsafe outside local/test)");

export interface AuthRequest extends Request {
  branchScope?: { id: number; branchType: string };
  user?: {
    id: number;
    name: string;
    role: string;
    branchId?: number | null;
  };
}

export function generateToken(user: { id: number; name: string; role: string; branchId?: number | null }) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, branchId: user.branchId ?? null },
    JWT_SECRET,
    { expiresIn: "12h" } // Token expires in 12 hours
  );
}

function discountDraftIdentity(value: any) {
  if (!value || typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || !Array.isArray(value.items) || !value.items.length) return null;
  const draft = {
    idempotencyKey: value.idempotencyKey.trim().slice(0, 120),
    customerId: value.customerId == null ? null : Number(value.customerId),
    items: value.items.map((item: any) => ({ menuItemId: Number(item.menuItemId), productUnitId: item.productUnitId == null ? null : Number(item.productUnitId), qty: Number(item.qty), modifiers: (Array.isArray(item.modifiers) ? item.modifiers : []).map((modifier: any) => ({ name: modifier.name, value: modifier.value })) })),
    discountType: value.discountType ?? null, discountValue: Number(value.discountValue) || 0,
    discounts: (Array.isArray(value.discounts) ? value.discounts : []).map((rule: any) => ({ type: rule.type, value: Number(rule.value) || 0, category: rule.category ?? null, buyQty: rule.buyQty ?? null, getQty: rule.getQty ?? null, maxDiscount: rule.maxDiscount ?? null })),
    couponCode: String(value.couponCode ?? "").trim().toUpperCase(), skipPromotions: value.skipPromotions === true,
    loyaltyPointsToUse: Number(value.loyaltyPointsToUse) || 0
  };
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}

/** Approval belongs to one checkout key and its exact draft; checkout idempotency prevents replay into a second bill. */
export function signDiscountApproval(approver: { id: number; name: string }, branchId: number, draft: unknown) {
  const draftHash = discountDraftIdentity(draft);
  if (!draftHash) throw new Error("กรุณาเลือกสินค้าและระบุบิลที่ต้องการอนุมัติส่วนลด");
  return jwt.sign({ kind: "discount-approval", approverId: approver.id, approverName: approver.name, branchId, draftHash }, JWT_SECRET, { expiresIn: "15m" });
}

export function verifyDiscountApproval(token: unknown, branchId: number, draft: unknown): { approverId: number; approverName: string } | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { kind?: string; approverId?: number; approverName?: string; branchId?: number; draftHash?: string };
    if (payload.kind !== "discount-approval" || payload.branchId !== branchId || !payload.approverId || !payload.draftHash || payload.draftHash !== discountDraftIdentity(draft)) return null;
    return { approverId: payload.approverId, approverName: payload.approverName ?? "" };
  } catch { return null; }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing Token" });
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: number; name: string; role: string; branchId?: number | null; kind?: string };
    if (payload.kind || !Number.isInteger(payload.id) || payload.id <= 0 || !["admin", "manager", "cashier"].includes(payload.role)) throw new Error("Invalid session token");
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}

export function requireBranchAccess(resolveBranchId: (req: AuthRequest) => number | null) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "admin") return next();

    const requestedBranchId = resolveBranchId(req);
    if (requestedBranchId === null) return res.status(400).json({ error: "ระบุสาขา" });
    if (req.user.branchId !== requestedBranchId) {
      return res.status(403).json({ error: "Forbidden: branch access denied" });
    }
    next();
  };
}
