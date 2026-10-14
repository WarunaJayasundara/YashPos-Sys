import type { MovementType } from '@prisma/client';
import type { Tx } from '../db.js';
import { conflict, notFound } from '../lib/http.js';

export interface MovementInput {
  productId: number;
  qtyChange: number; // signed, non-zero
  type: MovementType;
  userId: number;
  /** Cost per unit for incoming stock. When `updateAverage` is true it is blended into avgCost. */
  unitCost?: number;
  updateAverage?: boolean;
  refType?: string;
  refId?: number;
  reason?: string;
}

/**
 * The only place stock quantities change. Decrements are a single conditional UPDATE, so two
 * concurrent sales of the last unit cannot both succeed. Increments lock the row (FOR UPDATE)
 * to keep the weighted-average cost consistent.
 */
export async function applyMovement(tx: Tx, m: MovementInput) {
  if (!Number.isInteger(m.qtyChange) || m.qtyChange === 0) throw new Error('qtyChange must be a non-zero integer');
  let qtyAfter: number;
  let unitCost: number;

  if (m.qtyChange < 0) {
    const need = -m.qtyChange;
    const updated = await tx.$executeRaw`
      UPDATE products SET qtyOnHand = qtyOnHand - ${need}, updatedAt = NOW(3)
      WHERE id = ${m.productId} AND qtyOnHand - qtyReserved >= ${need}`;
    const p = await tx.product.findUnique({ where: { id: m.productId }, select: { name: true, qtyOnHand: true, qtyReserved: true, avgCost: true } });
    if (!p) throw notFound('Product not found');
    if (updated === 0) {
      throw conflict(`Not enough stock for ${p.name}: ${p.qtyOnHand - p.qtyReserved} available, ${need} needed`, 'INSUFFICIENT_STOCK', {
        productId: m.productId,
        available: p.qtyOnHand - p.qtyReserved,
        requested: need,
      });
    }
    qtyAfter = p.qtyOnHand;
    unitCost = m.unitCost ?? Number(p.avgCost);
  } else {
    const rows = await tx.$queryRaw<{ qtyOnHand: number; avgCost: string }[]>`
      SELECT qtyOnHand, avgCost FROM products WHERE id = ${m.productId} FOR UPDATE`;
    if (!rows.length) throw notFound('Product not found');
    const oldQty = Number(rows[0].qtyOnHand);
    const oldAvg = Number(rows[0].avgCost);
    unitCost = m.unitCost ?? oldAvg;
    qtyAfter = oldQty + m.qtyChange;
    let newAvg = oldAvg;
    if (m.updateAverage) {
      newAvg = oldQty <= 0 ? unitCost : (oldQty * oldAvg + m.qtyChange * unitCost) / qtyAfter;
    }
    await tx.product.update({
      where: { id: m.productId },
      data: { qtyOnHand: qtyAfter, avgCost: newAvg.toFixed(4) },
    });
  }

  await tx.stockMovement.create({
    data: {
      productId: m.productId,
      type: m.type,
      qtyChange: m.qtyChange,
      qtyAfter,
      unitCost: unitCost.toFixed(4),
      refType: m.refType,
      refId: m.refId,
      reason: m.reason,
      userId: m.userId,
    },
  });
  return { qtyAfter, unitCost };
}
