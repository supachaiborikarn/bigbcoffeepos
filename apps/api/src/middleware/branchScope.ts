import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";
import prisma from "../prisma.js";

export function canAccessBranch(user: AuthRequest["user"], branchId: number | null | undefined) {
  return Boolean(user && (user.role === "admin" || (Number.isInteger(branchId) && branchId! > 0 && user.branchId === branchId)));
}

/** A selected workspace is context; permission always comes from the current user record. */
export async function resolveBranchScope(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true, role: true, branchId: true, active: true, branch: { select: { active: true } } } });
    if (!user?.active) return res.status(401).json({ error: "บัญชีนี้ถูกปิดใช้งาน กรุณาเข้าสู่ระบบใหม่" });
    req.user = { id: user.id, name: user.name, role: user.role, branchId: user.branchId };
    if (req.path === "/auth/me") return next();
    if (user.role !== "admin" && (!user.branchId || !user.branch?.active)) {
      if (req.path === "/branches" && req.method === "GET") return res.json({ items: [] });
      return res.status(403).json({ error: "บัญชียังไม่มีสาขาที่เปิดใช้งาน ให้ผู้ดูแลตรวจสอบสาขาประจำของคุณ" });
    }
    // Check both sides of comparisons/transfers, even if a route only checks one.
    for (const source of [req.query, req.body ?? {}, { workspace: req.header("X-Branch-Id") }]) {
      for (const key of ["branchId", "branchIdA", "branchIdB", "fromBranchId", "toBranchId", "workspace"]) {
        const raw = source[key];
        if (raw === undefined || raw === null || raw === "") continue;
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0 || !canAccessBranch(req.user, id)) return res.status(403).json({ error: "คุณไม่มีสิทธิ์เข้าถึงสาขานี้" });
      }
    }
    const selected = Number(req.query.branchId || req.body?.branchId || req.header("X-Branch-Id") || user.branchId);
    if (selected > 0) {
      const branch = await prisma.branch.findFirst({ where: { id: selected, active: true }, select: { id: true, branchType: true } });
      if (!branch) return res.status(403).json({ error: "สาขานี้ไม่เปิดใช้งาน" });
      req.branchScope = branch;
    }
    next();
  } catch (error) { next(error); }
}

export function requireRecordBranch(resolve: (req: AuthRequest) => Promise<{ branchId: number } | null>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const record = await resolve(req);
      if (!record) return res.status(404).json({ error: "ไม่พบรายการ" });
      if (!canAccessBranch(req.user, record.branchId)) return res.status(403).json({ error: "คุณไม่มีสิทธิ์เข้าถึงรายการของสาขานี้" });
      next();
    } catch (error) { next(error); }
  };
}

// Catalogs and promotions are shared master data in the current schema.
// Only administrators may change a master record used by several branches.
export async function protectSharedConfiguration(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "admin") return next();
  if (/^\/inventory\/\d+$/.test(req.path) && req.method !== "GET" && ["name", "unit", "costPerUnit", "barcode"].some((field) => req.body?.[field] !== undefined)) return res.status(403).json({ error: "ชื่อ หน่วย ต้นทุน และบาร์โค้ดเป็นข้อมูลส่วนกลาง ให้ผู้ดูแลระบบแก้ไข" });
  if ((/^\/inventory\/\d+$/.test(req.path) && req.method !== "GET") || req.path === "/stock-adjustments") {
    try {
      const ingredientId = Number(req.path.split("/")[2] || req.body?.ingredientId);
      const stock = await prisma.ingredientStock.findFirst({ where: { branchId: req.user!.branchId!, ingredientId } });
      if (!stock) return res.status(403).json({ error: "ไม่พบสินค้าในสต็อกสาขานี้" });
    } catch (error) { return next(error); }
  }
  const alwaysAdmin = /^\/(?:migration|integrations|import|price-rules|product-variants)(?:\/|$)/;
  const sharedWrite = /^\/(?:menu|ingredients\/\d+|recipes|product-units|promotions|coupons)(?:\/|$)/;
  if (alwaysAdmin.test(req.path) || (req.method !== "GET" && sharedWrite.test(req.path) && req.path !== "/coupons/validate")) return res.status(403).json({ error: "รายการนี้เป็นข้อมูลส่วนกลาง ให้ผู้ดูแลระบบเป็นผู้แก้ไข" });
  next();
}
