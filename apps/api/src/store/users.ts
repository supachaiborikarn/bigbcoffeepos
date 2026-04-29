import prisma from "../prisma.js";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

export type UserRole = "admin" | "manager" | "cashier";

const PIN_HASH_PREFIX = "pbkdf2_sha256";

function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, 100_000, 32, "sha256").toString("hex");
  return `${PIN_HASH_PREFIX}$${salt}$${hash}`;
}

function verifyPin(pin: string, stored: string) {
  if (!stored.startsWith(`${PIN_HASH_PREFIX}$`)) return stored === pin;
  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = pbkdf2Sync(pin, salt, 100_000, 32, "sha256").toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function authenticatePin(pin: string) {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true, branchId: true, pin: true }
  });
  const user = users.find((candidate) => verifyPin(pin, candidate.pin));
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role as UserRole, branchId: user.branchId };
}

export async function getUsers() {
  return prisma.user.findMany({
    select: { id: true, name: true, role: true, active: true, createdAt: true, branchId: true, branch: { select: { id: true, name: true } } },
    orderBy: { id: "asc" }
  });
}

export async function getUser(id: number) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, active: true, createdAt: true, branchId: true, branch: { select: { id: true, name: true } } }
  });
}

export async function addUser(data: { name: string; pin: string; role: UserRole; branchId?: number }) {
  const activeUsers = await prisma.user.findMany({ select: { id: true, pin: true } });
  const existing = activeUsers.find((user) => verifyPin(data.pin, user.pin));
  if (existing) throw new Error("PIN นี้ถูกใช้แล้ว");

  const created = await prisma.user.create({
    data: { name: data.name, pin: hashPin(data.pin), role: data.role, branchId: data.branchId }
  });
  return getUser(created.id);
}

export async function updateUser(
  id: number,
  data: { name?: string; pin?: string; role?: UserRole; active?: boolean | number; branchId?: number | null }
) {
  const user = await getUser(id);
  if (!user) return null;

  if (data.pin) {
    const users = await prisma.user.findMany({ where: { id: { not: id } }, select: { id: true, pin: true } });
    const existing = users.find((candidate) => verifyPin(data.pin!, candidate.pin));
    if (existing) throw new Error("PIN นี้ถูกใช้แล้ว");
  }

  const activeBool = data.active !== undefined 
    ? (typeof data.active === "number" ? data.active === 1 : data.active) 
    : undefined;

  await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.pin !== undefined ? { pin: hashPin(data.pin) } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(activeBool !== undefined ? { active: activeBool } : {}),
      ...(data.branchId !== undefined ? { branchId: data.branchId } : {})
    }
  });

  return getUser(id);
}

export async function deleteUser(id: number) {
  await prisma.user.update({
    where: { id },
    data: { active: false }
  });
  return getUser(id);
}
