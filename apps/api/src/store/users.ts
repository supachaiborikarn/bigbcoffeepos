import prisma from "../prisma.js";

export type UserRole = "admin" | "manager" | "cashier";

export async function authenticatePin(pin: string) {
  const user = await prisma.user.findFirst({
    where: { pin, active: true },
    select: { id: true, name: true, role: true, branchId: true }
  });
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
  const existing = await prisma.user.findFirst({ where: { pin: data.pin } });
  if (existing) throw new Error("PIN นี้ถูกใช้แล้ว");

  const created = await prisma.user.create({
    data: { name: data.name, pin: data.pin, role: data.role, branchId: data.branchId }
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
    const existing = await prisma.user.findFirst({
      where: { pin: data.pin, id: { not: id } }
    });
    if (existing) throw new Error("PIN นี้ถูกใช้แล้ว");
  }

  const activeBool = data.active !== undefined 
    ? (typeof data.active === "number" ? data.active === 1 : data.active) 
    : undefined;

  await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.pin !== undefined ? { pin: data.pin } : {}),
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
