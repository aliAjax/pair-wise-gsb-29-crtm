/**
 * 判定层：同址订单合并与骑手时段释放规则
 * 全部为纯函数，不触碰 DOM 与 localStorage；页面只调用这里暴露的动作。
 */
import {
  HANDOFF_DELIVERED_REVISE,
  HANDOFF_FROZEN_ADJUST,
  STATUS_DELIVERED,
  STATUS_EMPTY,
  STATUS_UNDELIVERED,
  type Handoff,
  type HandoffChange,
  type Order,
  type OrderStatus,
  type PersistState
} from "../data/orders";

export interface Conflict {
  type:
    | "DIFFERENT_RIDER"
    | "TARGET_DELIVERED"
    | "SOURCE_DELIVERED"
    | "DIFFERENT_SLOT"
    | "DIFFERENT_ADDRESS"
    | "SAME_ORDER"
    | "OCCUPANCY_TAKEN"
    | "FROZEN_ORDER";
  message: string;
  address?: string;
  rider?: string;
  slot?: string;
  /** 原值：冲突时点上被保留/被占用的值 */
  oldValue?: string | number;
  sourceOrderNo?: string;
  targetOrderNo?: string;
}

export interface MergeResult {
  ok: boolean;
  orders: Order[];
  /** 合并后保留下来的主记录 id */
  targetId?: string;
  conflicts: Conflict[];
}

export interface AssignResult {
  ok: boolean;
  orders: Order[];
  conflicts: Conflict[];
}

export interface ReviseResult {
  ok: boolean;
  orders: Order[];
  handoffs: Handoff[];
  conflicts: Conflict[];
  newOrderId?: string;
}

export interface Occupancy {
  rider: string;
  slot: string;
  orderIds: string[];
  orderNos: string[];
  address: string;
}

const sameText = (a: string, b: string) => a.trim() === b.trim();

/** 合并前提：同地址、同时段、同骑手，且双方均为未送达（未分配不算在派中也不能并入派中记录） */
export function canMerge(source: Order, target: Order): { ok: boolean; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  if (source.id === target.id) {
    conflicts.push({ type: "SAME_ORDER", message: "不能与自身合并", sourceOrderNo: source.orderNo });
  }
  if (!sameText(source.address, target.address)) {
    conflicts.push({
      type: "DIFFERENT_ADDRESS",
      message: "地址不同，不能合并",
      address: source.address,
      oldValue: target.address,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  }
  if (source.slot !== target.slot) {
    conflicts.push({
      type: "DIFFERENT_SLOT",
      message: `配送时段不同（${source.orderNo}=${source.slot}，${target.orderNo}=${target.slot}），不能合并`,
      address: source.address,
      rider: source.rider,
      slot: source.slot,
      oldValue: target.slot,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  }
  if (source.rider !== target.rider) {
    conflicts.push({
      type: "DIFFERENT_RIDER",
      message: `骑手不同（${source.orderNo}=${source.rider || "未分配"}，${target.orderNo}=${target.rider || "未分配"}），不能合并，原记录保留`,
      address: source.address,
      slot: source.slot,
      rider: source.rider,
      oldValue: target.rider,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  } else if (!source.rider) {
    conflicts.push({
      type: "DIFFERENT_RIDER",
      message: `订单 ${source.orderNo} 与 ${target.orderNo} 均未分配骑手，不能合并，请先派单`,
      address: source.address,
      slot: source.slot,
      rider: source.rider,
      oldValue: target.rider,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  }
  if (target.status === STATUS_EMPTY) {
    conflicts.push({
      type: "TARGET_DELIVERED",
      message: `目标订单 ${target.orderNo} 尚未派单（未分配），不能作为并入主记录`,
      address: target.address,
      rider: target.rider,
      slot: target.slot,
      oldValue: STATUS_EMPTY,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  }
  if (source.status === STATUS_DELIVERED || target.status === STATUS_DELIVERED) {
    const frozen = source.status === STATUS_DELIVERED ? source : target;
    conflicts.push({
      type: frozen.id === source.id ? "SOURCE_DELIVERED" : "TARGET_DELIVERED",
      message: `订单 ${frozen.orderNo} 已送达冻结，不能并入或被并入，输入原样保留`,
      address: frozen.address,
      rider: frozen.rider,
      slot: frozen.slot,
      oldValue: STATUS_DELIVERED,
      sourceOrderNo: source.orderNo,
      targetOrderNo: target.orderNo
    });
  }
  return { ok: conflicts.length === 0, conflicts };
}

/**
 * 同址同时段同骑手合并：
 * - 仅并入未送达记录；原骑手、距离、备注以主记录（target）为准不变
 * - source 删除，其订单号追加到 target.mergedOrderNos，只保留一次骑手时段占用
 */
export function mergeOrders(orders: Order[], sourceId: string, targetId: string): MergeResult {
  const source = orders.find((o) => o.id === sourceId);
  const target = orders.find((o) => o.id === targetId);
  if (!source || !target) {
    return { ok: false, orders, conflicts: [{ type: "SAME_ORDER", message: "订单不存在" }] };
  }
  const check = canMerge(source, target);
  if (!check.ok) return { ok: false, orders, conflicts: check.conflicts };

  const mergedNos = [...new Set([...target.mergedOrderNos, source.orderNo, ...source.mergedOrderNos])];
  const next = orders
    .filter((o) => o.id !== sourceId)
    .map((o) => (o.id === targetId ? { ...o, mergedOrderNos: mergedNos } : o));
  return { ok: true, orders: next, targetId, conflicts: [] };
}

/** 骑手时段占用：未分配不占；同一骑手+同一时段的未送达记录聚合成一格（合并后自然只剩一次） */
export function buildOccupancies(orders: Order[]): Occupancy[] {
  const map = new Map<string, Occupancy>();
  for (const o of orders) {
    if (!o.rider || o.status === STATUS_DELIVERED) continue;
    const key = `${o.rider}@@${o.slot}`;
    const cell = map.get(key);
    if (cell) {
      cell.orderIds.push(o.id);
      cell.orderNos.push(o.orderNo);
    } else {
      map.set(key, {
        rider: o.rider,
        slot: o.slot,
        orderIds: [o.id],
        orderNos: [o.orderNo],
        address: o.address
      });
    }
  }
  return [...map.values()];
}

export function isOccupied(orders: Order[], rider: string, slot: string, exceptId?: string): boolean {
  return orders.some(
    (o) => o.rider === rider && o.slot === slot && o.status !== STATUS_DELIVERED && o.id !== exceptId
  );
}

/**
 * 改派（未送达记录）：先释放原骑手占用，再占用新骑手时段。
 * 新骑手该时段若已被他人占用则拒绝，原值保留，并回报冲突（地址/骑手/时段/原值）。
 */
export function reassignRider(
  orders: Order[],
  orderId: string,
  newRider: string,
  newSlot: string
): AssignResult {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, orders, conflicts: [{ type: "SAME_ORDER", message: "订单不存在" }] };

  if (order.status === STATUS_DELIVERED) {
    return {
      ok: false,
      orders,
      conflicts: [
        {
          type: "FROZEN_ORDER",
          message: `订单 ${order.orderNo} 已送达冻结，改派须另存交接新版本`,
          address: order.address,
          rider: order.rider,
          slot: order.slot,
          oldValue: order.rider,
          sourceOrderNo: order.orderNo
        }
      ]
    };
  }
  if (!newRider.trim()) {
    return {
      ok: false,
      orders,
      conflicts: [
        {
          type: "OCCUPANCY_TAKEN",
          message: "请选择新骑手",
          address: order.address,
          rider: order.rider,
          slot: newSlot,
          oldValue: order.rider
        }
      ]
    };
  }

  // 释放原占用：以当前订单自身除外来判定新时段是否被别人占用
  if (isOccupied(orders, newRider, newSlot, order.id)) {
    const keeper = orders.find(
      (o) => o.rider === newRider && o.slot === newSlot && o.status !== STATUS_DELIVERED && o.id !== order.id
    )!;
    return {
      ok: false,
      orders,
      conflicts: [
        {
          type: "OCCUPANCY_TAKEN",
          message: `骑手 ${newRider} 在 ${newSlot} 已被订单 ${keeper.orderNo}（${keeper.address}）占用，改派被拒绝，原骑手 ${order.rider}、时段 ${order.slot} 保留`,
          address: order.address,
          rider: newRider,
          slot: newSlot,
          oldValue: `${keeper.orderNo}/${keeper.address}`,
          sourceOrderNo: order.orderNo
        }
      ]
    };
  }

  const next = orders.map((o) =>
    o.id === order.id ? { ...o, rider: newRider, slot: newSlot, status: STATUS_UNDELIVERED as OrderStatus } : o
  );
  return { ok: true, orders: next, conflicts: [] };
}

/** 标记送达：占用随之释放（buildOccupancies 自动排除已送达） */
export function markDelivered(orders: Order[], orderId: string, atIso: string): Order[] {
  return orders.map((o) =>
    o.id === orderId && o.status !== STATUS_DELIVERED
      ? { ...o, status: STATUS_DELIVERED, deliveredAt: atIso }
      : o
  );
}

export function withdrawAssignment(orders: Order[], orderId: string): Order[] {
  return orders.map((o) =>
    o.id === orderId && o.status === STATUS_UNDELIVERED
      ? { ...o, rider: "", status: STATUS_EMPTY }
      : o
  );
}

const FIELD_LABELS: Record<string, string> = {
  rider: "骑手",
  slot: "配送时段",
  address: "地址",
  distance: "距离km",
  notes: "备注"
};

function diffFields(source: Order, patch: { rider?: string; slot?: string; address?: string; distance?: number; notes?: string }): HandoffChange[] {
  const changes: HandoffChange[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const nextVal = (patch as Record<string, string | number | undefined>)[field];
    if (nextVal === undefined) continue;
    const oldVal = source[field as keyof Order] as string | number;
    if (oldVal !== nextVal) {
      changes.push({ field, label, oldValue: oldVal, newValue: nextVal });
    }
  }
  return changes;
}

const nextVersionOf = (orders: Order[], orderNo: string) =>
  orders.filter((o) => o.orderNo === orderNo).reduce((max, o) => Math.max(max, o.version), 0) + 1;

const cloneOrderForRevision = (source: Order, id: string, version: number, atIso: string): Order => ({
  ...source,
  id,
  version,
  // 新版本是一条新的在途处理单：未送达、重新占用骑手时段；不带历史合并号
  mergedOrderNos: [],
  derivedFromId: source.id,
  status: STATUS_UNDELIVERED,
  createdAt: atIso,
  deliveredAt: undefined
});

/**
 * 已送达记录冻结：任何后续调整都不改原件，
 * 而是生成一条同 orderNo 的新版本记录，并登记交接原因与字段差异。
 */
export function reviseDelivered(
  state: PersistState,
  sourceId: string,
  patch: { rider?: string; slot?: string; address?: string; distance?: number; notes?: string },
  reason: string,
  memo: string
): ReviseResult {
  const source = state.orders.find((o) => o.id === sourceId);
  if (!source) return { ok: false, orders: state.orders, handoffs: state.handoffs, conflicts: [{ type: "FROZEN_ORDER", message: "订单不存在" }] };
  if (source.status !== STATUS_DELIVERED) {
    return {
      ok: false,
      orders: state.orders,
      handoffs: state.handoffs,
      conflicts: [
        {
          type: "FROZEN_ORDER",
          message: `订单 ${source.orderNo} 尚未送达，应直接改派，无需交接新版本`,
          address: source.address,
          rider: source.rider,
          slot: source.slot
        }
      ]
    };
  }

  const changes = diffFields(source, patch);
  if (changes.length === 0) {
    return {
      ok: false,
      orders: state.orders,
      handoffs: state.handoffs,
      conflicts: [
        {
          type: "FROZEN_ORDER",
          message: "没有任何字段变化，无需另存新版本",
          address: source.address,
          rider: source.rider,
          slot: source.slot,
          oldValue: source.rider
        }
      ]
    };
  }

  const atIso = new Date().toISOString();
  const newId = crypto.randomUUID();
  const newVersion = nextVersionOf(state.orders, source.orderNo);
  const revised = cloneOrderForRevision(source, newId, newVersion, atIso);
  if (patch.rider !== undefined) revised.rider = patch.rider;
  if (patch.slot !== undefined) revised.slot = patch.slot;
  if (patch.address !== undefined) revised.address = patch.address;
  if (patch.distance !== undefined) revised.distance = patch.distance;
  if (patch.notes !== undefined) revised.notes = patch.notes;

  // 新版本要占用新骑手时段；若已被他人占用，原件与新动作全部不落地
  if (revised.rider && isOccupied(state.orders, revised.rider, revised.slot)) {
    const keeper = state.orders.find(
      (o) => o.rider === revised.rider && o.slot === revised.slot && o.status !== STATUS_DELIVERED
    )!;
    return {
      ok: false,
      orders: state.orders,
      handoffs: state.handoffs,
      conflicts: [
        {
          type: "OCCUPANCY_TAKEN",
          message: `新版本要占用的 ${revised.rider} / ${revised.slot} 已被 ${keeper.orderNo} 占用，交接未保存`,
          address: revised.address,
          rider: revised.rider,
          slot: revised.slot,
          oldValue: `${keeper.orderNo}/${keeper.address}`,
          sourceOrderNo: source.orderNo
        }
      ]
    };
  }

  const handoff: Handoff = {
    id: crypto.randomUUID(),
    reason: changes.some((c) => c.field === "rider" || c.field === "slot")
      ? HANDOFF_DELIVERED_REVISE
      : HANDOFF_FROZEN_ADJUST,
    memo: memo || reason || "已送达记录后续调整",
    sourceOrderId: source.id,
    sourceOrderNo: source.orderNo,
    newOrderId: newId,
    changes,
    createdAt: atIso
  };

  return {
    ok: true,
    orders: [...state.orders, revised],
    handoffs: [...state.handoffs, handoff],
    conflicts: [],
    newOrderId: newId
  };
}

/** 刷新一致性校验：占用唯一性、合并目标有效性、交接指向完整性 */
export function auditConsistency(orders: Order[], handoffs: Handoff[]): Conflict[] {
  const conflicts: Conflict[] = [];

  const seen = new Map<string, Order>();
  for (const o of orders) {
    if (o.rider && o.status !== STATUS_DELIVERED) {
      const key = `${o.rider}@@${o.slot}`;
      const prev = seen.get(key);
      if (prev) {
        conflicts.push({
          type: "OCCUPANCY_TAKEN",
          message: `骑手 ${o.rider} 在 ${o.slot} 存在多条在途占用：${prev.orderNo} 与 ${o.orderNo}（同址同时段应先合并）`,
          rider: o.rider,
          slot: o.slot,
          address: o.address,
          oldValue: prev.orderNo,
          sourceOrderNo: prev.orderNo,
          targetOrderNo: o.orderNo
        });
      } else {
        seen.set(key, o);
      }
    }
    if (o.status === STATUS_DELIVERED && !o.deliveredAt) {
      conflicts.push({
        type: "FROZEN_ORDER",
        message: `订单 ${o.orderNo} 状态为已送达但缺少送达时间`,
        address: o.address,
        rider: o.rider,
        slot: o.slot
      });
    }
  }

  for (const h of handoffs) {
    const source = orders.find((o) => o.id === h.sourceOrderId);
    const target = orders.find((o) => o.id === h.newOrderId);
    if (!source || source.status !== STATUS_DELIVERED) {
      conflicts.push({
        type: "FROZEN_ORDER",
        message: `交接记录 ${h.id} 的原始订单 ${h.sourceOrderNo} 不存在或未冻结`,
        sourceOrderNo: h.sourceOrderNo
      });
    }
    if (!target) {
      conflicts.push({
        type: "FROZEN_ORDER",
        message: `交接记录指向的新版本订单缺失（源单 ${h.sourceOrderNo}）`,
        sourceOrderNo: h.sourceOrderNo
      });
    }
  }
  return conflicts;
}

export function findMergeTargets(orders: Order[], source: Order): Order[] {
  return orders.filter((t) => t.id !== source.id && canMerge(source, t).ok);
}
