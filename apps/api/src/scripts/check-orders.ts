import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [totalOrders, activeOrders, reversedOrders, latestOrders] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: { notIn: ["CANCELLED", "REFUNDED"] } } }),
    prisma.order.count({ where: { status: { in: ["CANCELLED", "REFUNDED"] } } }),
    prisma.order.findMany({
      orderBy: { id: "desc" },
      take: 5,
      select: {
        id: true,
        branchId: true,
        status: true,
        total: true,
        paymentMethod: true,
        createdAt: true
      }
    })
  ]);

  console.log(JSON.stringify({
    totalOrders,
    activeOrders,
    reversedOrders,
    latestOrders: latestOrders.map((order) => ({
      ...order,
      createdAt: order.createdAt.toISOString()
    }))
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
