import prisma from "../prisma.js";

const roundQty = (value: number) => Math.round(value * 1000) / 1000;

export async function getCentralWarehouses() {
  return prisma.centralWarehouse.findMany({
    where: { active: true },
    include: { managerBranch: true },
    orderBy: { id: "asc" }
  });
}

export async function ensureCentralWarehouse(input: { name?: string; managerBranchId?: number | null }) {
  const existing = await prisma.centralWarehouse.findFirst({ where: { active: true }, orderBy: { id: "asc" } });
  if (existing) {
    return prisma.centralWarehouse.update({
      where: { id: existing.id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.managerBranchId !== undefined ? { managerBranchId: input.managerBranchId } : {})
      },
      include: { managerBranch: true }
    });
  }
  return prisma.centralWarehouse.create({
    data: {
      name: input.name?.trim() || "สต็อกกลางน้ำมันเครื่อง",
      managerBranchId: input.managerBranchId ?? null
    },
    include: { managerBranch: true }
  });
}

export async function getWarehouseInventory(warehouseId: number) {
  const stocks = await prisma.warehouseStock.findMany({
    where: { warehouseId },
    include: { ingredient: true },
    orderBy: { ingredient: { name: "asc" } }
  });
  const reserved = await prisma.restockRequestItem.groupBy({
    by: ["ingredientId"],
    where: {
      reservedQty: { gt: 0 },
      request: { warehouseId, status: { in: ["SUBMITTED", "PICKING", "PARTIAL"] } }
    },
    _sum: { reservedQty: true }
  });
  const reservedMap = new Map(reserved.map((row) => [row.ingredientId, Number(row._sum.reservedQty ?? 0)]));
  return stocks.map((stock) => {
    const reservedQty = roundQty(reservedMap.get(stock.ingredientId) ?? 0);
    return {
      warehouseId,
      ingredientId: stock.ingredientId,
      name: stock.ingredient.name,
      unit: stock.ingredient.unit,
      stockQty: stock.stockQty,
      reservedQty,
      availableQty: roundQty(stock.stockQty - reservedQty),
      reorderLevel: stock.reorderLevel
    };
  });
}

export async function adjustWarehouseStock(input: {
  warehouseId: number;
  ingredientId: number;
  qty: number;
  reorderLevel?: number;
  reason: string;
  actorUserId?: number | null;
}) {
  if (!Number.isFinite(input.qty) || input.qty === 0) throw new Error("จำนวนปรับสต็อกไม่ถูกต้อง");
  return prisma.$transaction(async (tx) => {
    const stock = await tx.warehouseStock.upsert({
      where: { warehouseId_ingredientId: { warehouseId: input.warehouseId, ingredientId: input.ingredientId } },
      update: {
        stockQty: { increment: input.qty },
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {})
      },
      create: {
        warehouseId: input.warehouseId,
        ingredientId: input.ingredientId,
        stockQty: input.qty,
        reorderLevel: input.reorderLevel ?? 0
      }
    });
    if (stock.stockQty < 0) throw new Error("สต็อกกลางไม่พอสำหรับรายการนี้");
    const movement = await tx.warehouseStockMovement.create({
      data: {
        warehouseId: input.warehouseId,
        ingredientId: input.ingredientId,
        qty: input.qty,
        reason: input.reason,
        actorUserId: input.actorUserId ?? null
      }
    });
    return { stock, movement };
  });
}

export async function listRestockRequests(input: { branchId?: number; warehouseId?: number } = {}) {
  return prisma.restockRequest.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.warehouseId ? { warehouseId: input.warehouseId } : {})
    },
    include: {
      branch: true,
      warehouse: true,
      items: { include: { ingredient: true } },
      shipments: { include: { items: { include: { ingredient: true } } }, orderBy: { id: "asc" } }
    },
    orderBy: { id: "desc" }
  });
}

export async function createRestockRequest(input: {
  warehouseId: number;
  branchId: number;
  note?: string;
  requestedByUserId?: number | null;
  items: { ingredientId: number; requestedQty: number }[];
}) {
  if (!input.items.length) throw new Error("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
  if (input.items.some((item) => !Number.isFinite(item.requestedQty) || item.requestedQty <= 0)) throw new Error("จำนวนเบิกต้องมากกว่า 0");
  const unique = new Set(input.items.map((item) => item.ingredientId));
  if (unique.size !== input.items.length) throw new Error("มีสินค้าซ้ำในใบเบิก");
  return prisma.restockRequest.create({
    data: {
      warehouseId: input.warehouseId,
      branchId: input.branchId,
      note: input.note?.trim() ?? "",
      requestedByUserId: input.requestedByUserId ?? null,
      items: { create: input.items.map((item) => ({ ingredientId: item.ingredientId, requestedQty: roundQty(item.requestedQty) })) }
    },
    include: { branch: true, warehouse: true, items: { include: { ingredient: true } } }
  });
}

export async function submitRestockRequest(id: number) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.restockRequest.findUnique({ where: { id }, include: { items: true } });
    if (!request) throw new Error("ไม่พบใบเบิก");
    if (request.status !== "DRAFT" && request.status !== "PARTIAL") throw new Error("ใบเบิกนี้ส่งคำขอแล้ว");

    for (const item of request.items) {
      const outstanding = roundQty(item.requestedQty - item.receivedQty - item.shippedQty - item.reservedQty);
      if (outstanding <= 0) continue;
      const warehouseStock = await tx.warehouseStock.findUnique({
        where: { warehouseId_ingredientId: { warehouseId: request.warehouseId, ingredientId: item.ingredientId } }
      });
      const otherReserved = await tx.restockRequestItem.aggregate({
        where: {
          ingredientId: item.ingredientId,
          requestId: { not: request.id },
          reservedQty: { gt: 0 },
          request: { warehouseId: request.warehouseId, status: { in: ["SUBMITTED", "PICKING", "PARTIAL"] } }
        },
        _sum: { reservedQty: true }
      });
      const available = Math.max(0, Number(warehouseStock?.stockQty ?? 0) - Number(otherReserved._sum.reservedQty ?? 0));
      const reserve = roundQty(Math.min(outstanding, available));
      if (reserve > 0) await tx.restockRequestItem.update({ where: { id: item.id }, data: { reservedQty: { increment: reserve } } });
    }

    return tx.restockRequest.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: request.submittedAt ?? new Date() },
      include: { branch: true, warehouse: true, items: { include: { ingredient: true } } }
    });
  });
}

export async function startRestockPicking(id: number) {
  const request = await prisma.restockRequest.findUnique({ where: { id } });
  if (!request) throw new Error("ไม่พบใบเบิก");
  if (!["SUBMITTED", "PARTIAL", "PICKING"].includes(request.status)) throw new Error("ใบเบิกนี้ยังไม่พร้อมจัดของ");
  return prisma.restockRequest.update({ where: { id }, data: { status: "PICKING", pickingAt: request.pickingAt ?? new Date() } });
}

export async function dispatchRestockShipment(input: {
  requestId: number;
  dispatchedByUserId?: number | null;
  note?: string;
  items: { requestItemId: number; qty: number }[];
}) {
  if (!input.items.length) throw new Error("กรุณาเลือกสินค้าที่จะส่ง");
  return prisma.$transaction(async (tx) => {
    const request = await tx.restockRequest.findUnique({ where: { id: input.requestId }, include: { items: true } });
    if (!request) throw new Error("ไม่พบใบเบิก");
    if (!["SUBMITTED", "PICKING", "PARTIAL"].includes(request.status)) throw new Error("ใบเบิกนี้ไม่สามารถออกส่งได้");
    const requestItems = new Map(request.items.map((item) => [item.id, item]));

    for (const line of input.items) {
      const item = requestItems.get(line.requestItemId);
      if (!item) throw new Error("พบรายการสินค้าที่ไม่อยู่ในใบเบิก");
      const qty = roundQty(line.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > item.reservedQty) throw new Error("จำนวนส่งต้องมากกว่า 0 และไม่เกินจำนวนที่จองไว้");
      const stock = await tx.warehouseStock.findUnique({ where: { warehouseId_ingredientId: { warehouseId: request.warehouseId, ingredientId: item.ingredientId } } });
      if (!stock || stock.stockQty < qty) throw new Error("สต็อกกลางไม่พอสำหรับการส่ง");
    }

    const shipment = await tx.restockShipment.create({
      data: {
        restockRequestId: request.id,
        dispatchedByUserId: input.dispatchedByUserId ?? null,
        note: input.note?.trim() ?? "",
        items: {
          create: input.items.map((line) => {
            const item = requestItems.get(line.requestItemId)!;
            return { requestItemId: item.id, ingredientId: item.ingredientId, shippedQty: roundQty(line.qty) };
          })
        }
      }
    });

    for (const line of input.items) {
      const item = requestItems.get(line.requestItemId)!;
      const qty = roundQty(line.qty);
      await tx.warehouseStock.update({
        where: { warehouseId_ingredientId: { warehouseId: request.warehouseId, ingredientId: item.ingredientId } },
        data: { stockQty: { decrement: qty } }
      });
      await tx.restockRequestItem.update({
        where: { id: item.id },
        data: { reservedQty: { decrement: qty }, shippedQty: { increment: qty } }
      });
      await tx.warehouseStockMovement.create({
        data: {
          warehouseId: request.warehouseId,
          ingredientId: item.ingredientId,
          qty: -qty,
          reason: "RESTOCK_DISPATCH",
          referenceType: "RESTOCK_SHIPMENT",
          referenceId: shipment.id,
          actorUserId: input.dispatchedByUserId ?? null
        }
      });
    }

    await tx.restockRequest.update({ where: { id: request.id }, data: { status: "IN_TRANSIT" } });
    return tx.restockShipment.findUnique({
      where: { id: shipment.id },
      include: { request: { include: { branch: true } }, items: { include: { ingredient: true } } }
    });
  });
}

export async function receiveRestockShipment(input: {
  shipmentId: number;
  receivedByUserId?: number | null;
  items: { shipmentItemId: number; receivedQty: number }[];
}) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.restockShipment.findUnique({
      where: { id: input.shipmentId },
      include: { request: { include: { items: true } }, items: true }
    });
    if (!shipment) throw new Error("ไม่พบรายการส่ง");
    if (shipment.status !== "IN_TRANSIT") throw new Error("รายการส่งนี้รับของไปแล้ว");
    const receiptMap = new Map(input.items.map((item) => [item.shipmentItemId, roundQty(item.receivedQty)]));
    let hasDiscrepancy = false;

    for (const shipmentItem of shipment.items) {
      const receivedQty = receiptMap.has(shipmentItem.id) ? receiptMap.get(shipmentItem.id)! : shipmentItem.shippedQty;
      if (!Number.isFinite(receivedQty) || receivedQty < 0 || receivedQty > shipmentItem.shippedQty) throw new Error("จำนวนรับไม่ถูกต้อง");
      if (receivedQty !== shipmentItem.shippedQty) hasDiscrepancy = true;
      await tx.restockShipmentItem.update({ where: { id: shipmentItem.id }, data: { receivedQty } });
      await tx.restockRequestItem.update({ where: { id: shipmentItem.requestItemId }, data: { receivedQty: { increment: receivedQty } } });
      if (receivedQty > 0) {
        await tx.ingredientStock.upsert({
          where: { branchId_ingredientId: { branchId: shipment.request.branchId, ingredientId: shipmentItem.ingredientId } },
          update: { stockQty: { increment: receivedQty } },
          create: { branchId: shipment.request.branchId, ingredientId: shipmentItem.ingredientId, stockQty: receivedQty, reorderLevel: 0 }
        });
        await tx.stockMovement.create({
          data: {
            branchId: shipment.request.branchId,
            ingredientId: shipmentItem.ingredientId,
            qty: receivedQty,
            reason: `RESTOCK_RECEIVE#${shipment.id}`
          }
        });
      }
    }

    await tx.restockShipment.update({
      where: { id: shipment.id },
      data: { status: hasDiscrepancy ? "DISCREPANCY" : "RECEIVED", receivedByUserId: input.receivedByUserId ?? null, receivedAt: new Date() }
    });

    const refreshedItems = await tx.restockRequestItem.findMany({ where: { requestId: shipment.request.id } });
    const allReceived = refreshedItems.every((item) => item.receivedQty >= item.requestedQty);
    const anyInTransit = await tx.restockShipment.count({ where: { restockRequestId: shipment.request.id, status: "IN_TRANSIT" } });
    const nextStatus = allReceived ? "RECEIVED" : anyInTransit > 0 ? "IN_TRANSIT" : "PARTIAL";
    await tx.restockRequest.update({ where: { id: shipment.request.id }, data: { status: nextStatus } });

    return tx.restockShipment.findUnique({ where: { id: shipment.id }, include: { items: { include: { ingredient: true } }, request: { include: { branch: true } } } });
  });
}
