import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const localJwtFallbackModes = new Set(["", "development", "test", "local"]);
const nodeEnv = process.env.NODE_ENV || "";

if (!localJwtFallbackModes.has(nodeEnv) && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required when NODE_ENV is not development/test/local");
}

const JWT_SECRET = process.env.JWT_SECRET || "bb_pos_secret_key_dev";
if (!process.env.JWT_SECRET) console.warn("[Auth] JWT_SECRET not set - using dev fallback (unsafe outside local/test)");

export interface AuthRequest extends Request {
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

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing Token" });
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: number; name: string; role: string; branchId?: number | null };
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
    if (req.user.role === "admin" || req.user.role === "manager") return next();

    const requestedBranchId = resolveBranchId(req);
    if (requestedBranchId === null) return res.status(400).json({ error: "ระบุสาขา" });
    if (req.user.branchId !== requestedBranchId) {
      return res.status(403).json({ error: "Forbidden: branch access denied" });
    }
    next();
  };
}
