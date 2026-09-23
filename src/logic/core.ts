import type {
  ActionResult,
  ConflictDraft,
  DeliveryOrder,
  DeskState,
  HandoffRecord,
  MergeResult,
  NewOrderInput,
  OccupancyEntry,
  OrderSnapshot
} from "../types";

// 判定层：全部为纯函数，输入状态产出新状态，不碰 localStorage / 时间 / 随机数。
// 业务约束集中在此，页面与资料层不内联判定规则。

export const UNASSIGNED: DeliveryOrder["status"] = "未分配";
export const ASSIGNED: DeliveryOrder["status"] = "已分配";
export const DELIVERED: DeliveryOrder["status"] = "已送达";

export const KEEP = "__keep__";

export function emptyState(): DeskState {
  return { orders: [], occupancies: [], handoffs: [] };
}

export function cloneState(state: DeskState): DeskState {
  return {
    orders: state.orders.map((o) => ({ ...o, absorbedCodes: [...o.absorbedCodes] })),
    occupancies: state.occupancies.map((e) => ({ ...e })),
    handoffs: state.handoffs.map((h) => ({ ...h, snapshot: { ...h.snapshot }, changes: { ...h.changes } }))
  };
}

/* ---------- 基础判定 ---------- */

export function isDelivered(order: DeliveryOrder): boolean {
  return order.status === DELIVERED;
}

export function isActive(order: DeliveryOrder): boolean {
  return order.mergedIntoId === null;
}

export function isAssignedActive(order: DeliveryOrder): boolean {
  return isActive(order) && order.status === ASSIGNED && order.rider !== "";
}

export function occupancyKey(rider: string, slot: string): string {
  return `${rider}@@${slot}`;
}

/** 骑手在同一时段只记一次占用 */
export function deriveOccupancies(orders: DeliveryOrder[]): OccupancyEntry[] {
  const best = new Map<string, OccupancyEntry>();
  for (const order of orders) {
    if (!isAssignedActive(order) || order.rider === "") continue;
    const key = occupancyKey(order.rider, order.slot);
    const earlier = best.get(key);
    if (!earlier || order.id < earlier.orderId) {
      best.set(key, {
        key,
        rider: order.rider,
        slot: order.slot,
        address: order.address,
        orderId: order.id,
        orderCode: order.code
      });
    }
  }
  return [...best.values()].sort((a, b) => a.rider.localeCompare(b.rider, "zh") || a.slot.localeCompare(b.slot));
}

/** 释放某订单当前的骑手时段占用；同骑手同时段还有其它在配订单时，台账指向剩余最早订单 */
function releaseOccupancy(state: DeskState, order: DeliveryOrder) {
  if (!order.rider) return;
  const key = occupancyKey(order.rider, order.slot);
  const others = state.orders
    .filter((o) => isAssignedActive(o) && o.id !== order.id && occupancyKey(o.rider, o.slot) === key)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (others.length > 0) {
    const next = others[0];
    const entry = state.occupancies.find((e) => e.key === key);
    if (entry) {
      entry.orderId = next.id;
      entry.orderCode = next.code;
      entry.address = next.address;
    }
  } else {
    state.occupancies = state.occupancies.filter((e) => e.key !== key);
  }
}

function ensureOccupancy(state: DeskState, order: DeliveryOrder) {
  if (!order.rider || order.status !== ASSIGNED) return;
  const key = occupancyKey(order.rider, order.slot);
  const existing = state.occupancies.find((e) => e.key === key);
  if (!existing) {
    state.occupancies.push({
      key,
      rider: order.rider,
      slot: order.slot,
      address: order.address,
      orderId: order.id,
      orderCode: order.code
    });
  }
  state.occupancies.sort((a, b) => a.rider.localeCompare(b.rider, "zh") || a.slot.localeCompare(b.slot));
}

function snapshot(order: DeliveryOrder): OrderSnapshot {
  return {
    rider: order.rider,
    address: order.address,
    slot: order.slot,
    distance: order.distance,
    notes: order.notes
  };
}

function describeValue(order: DeliveryOrder): string {
  return `地址=${order.address}｜骑手=${order.rider}｜时段=${order.slot}`;
}

function conflict(
  kind: ConflictDraft["kind"],
  summary: string,
  address: string,
  rider: string,
  slot: string,
  original: string
): ConflictDraft {
  return { kind, summary, address, rider, slot, original };
}

function freezeConflict(order: DeliveryOrder, action: string): ConflictDraft {
  return conflict(
    "冻结拦截",
    `订单 ${order.code} 已送达并冻结，不能${action}；如需调整请走交接另存新版本`,
    order.address,
    order.rider,
    order.slot,
    `原值：${describeValue(order)}｜距离=${order.distance}km｜备注=${order.notes}`
  );
}

/* ---------- 同址订单合并 ---------- */

export interface MergeEligibility {
  candidateId: string;
  ok: boolean;
  objections: ConflictDraft[];
}

/**
 * 判定候选订单能否并入主订单：
 * 同地址且同配送时段、同骑手、且双方均为未送达（活跃）记录才能合并。
 * 任一条件不满足均保留输入、原样不动。
 */
export function evaluateMerge(state: DeskState, targetId: string, candidateId: string): MergeEligibility {
  const objections: ConflictDraft[] = [];
  const target = state.orders.find((o) => o.id === targetId);
  const candidate = state.orders.find((o) => o.id === candidateId);
  if (!target || !candidate) {
    return { candidateId, ok: false, objections };
  }

  if (isDelivered(target) || !isActive(target)) {
    objections.push(freezeConflict(target, "作为合并主记录"));
  }
  if (isDelivered(candidate)) {
    objections.push(freezeConflict(candidate, "被合并"));
  } else if (!isActive(candidate)) {
    objections.push(
      conflict(
        "合并冲突",
        `订单 ${candidate.code} 已并入其它记录，不能再次合并`,
        candidate.address,
        candidate.rider,
        candidate.slot,
        `已并入 ${candidate.mergedIntoId ?? "-"}`
      )
    );
  }

  if (!isDelivered(target) && isActive(target) && !isDelivered(candidate) && isActive(candidate)) {
    const sameAddress = target.address.trim() === candidate.address.trim();
    const sameSlot = target.slot === candidate.slot;
    const sameRider = target.rider !== "" && target.rider === candidate.rider;

    if (!sameAddress || !sameSlot || !sameRider) {
      const diffs = [
        !sameAddress ? `地址（主「${target.address}」/ 候选「${candidate.address}」）` : "",
        !sameSlot ? `时段（主「${target.slot}」/ 候选「${candidate.slot}」）` : "",
        !sameRider ? `骑手（主「${target.rider || "未分配"}」/ 候选「${candidate.rider || "未分配"}」）` : ""
      ].filter(Boolean);
      objections.push(
        conflict(
          "合并冲突",
          `订单 ${candidate.code} 不能并入 ${target.code}：${diffs.join("、")}不一致，按规则保留输入`,
          candidate.address,
          candidate.rider,
          candidate.slot,
          `候选原值：${describeValue(candidate)}；主记录原值：${describeValue(target)}`
        )
      );
    }
  }

  return { candidateId, ok: objections.length === 0, objections };
}

/**
 * 执行批量合并：只有全部候选都合规才整体合并；任一候选不合规则整单拒绝、输入保留。
 * 合并时沿用主订单的骑手、距离与备注（不变）；同骑手同时段只记一次占用。
 */
export function mergeOrders(
  state: DeskState,
  targetId: string,
  candidateIds: string[],
  createdAt: string,
  newId: () => string
): MergeResult {
  const target = state.orders.find((o) => o.id === targetId);
  if (!target) {
    return { ok: false, conflicts: [], mergedCodes: [], notice: "未找到合并主记录" };
  }
  const uniqueIds = [...new Set(candidateIds.filter((id) => id !== targetId))];
  if (uniqueIds.length === 0) {
    return { ok: false, conflicts: [], mergedCodes: [], notice: "请先勾选要并入的订单" };
  }

  const reports = uniqueIds.map((id) => evaluateMerge(state, targetId, id));
  const blocking = reports.filter((r) => !r.ok);
  if (blocking.length > 0) {
    const conflicts = blocking.flatMap((r) => r.objections);
    return { ok: false, conflicts, mergedCodes: [], notice: "存在不合规候选，已保留全部输入，未做合并" };
  }

  const next = cloneState(state);
  const targetOrder = next.orders.find((o) => o.id === targetId)!;
  const mergedCodes: string[] = [];

  for (const id of uniqueIds) {
    const candidate = next.orders.find((o) => o.id === id)!;
    mergedCodes.push(candidate.code);
    candidate.mergedIntoId = targetOrder.id;
    targetOrder.absorbedCodes.push(candidate.code);
    // 释放候选自身可能登记的占用（主记录同骑手同时段只保留一条）
    releaseOccupancy(next, candidate);
  }

  // 合并后占用只记一次：确保台账指向主记录
  const key = occupancyKey(targetOrder.rider, targetOrder.slot);
  if (targetOrder.status === ASSIGNED && targetOrder.rider !== "") {
    const entry = next.occupancies.find((e) => e.key === key);
    if (entry) {
      entry.orderId = targetOrder.id;
      entry.orderCode = targetOrder.code;
      entry.address = targetOrder.address;
    } else {
      ensureOccupancy(next, targetOrder);
    }
  }

  return {
    ok: true as const,
    conflicts: [] as ConflictDraft[],
    mergedCodes,
    notice: `已将 ${mergedCodes.join("、")} 并入 ${targetOrder.code}；骑手/距离/备注沿用主记录，占用只记一次`,
    next
  };
}

/* ---------- 分配 / 改派（改派前先释放原骑手） ---------- */

/** 未分配订单首次派给骑手 */
export function assignRider(state: DeskState, orderId: string, rider: string): ActionResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, conflicts: [] };
  if (isDelivered(order) || !isActive(order)) {
    return { ok: false, conflicts: [freezeConflict(order, "派单")] };
  }
  if (order.status === ASSIGNED) {
    return {
      ok: false,
      conflicts: [
        conflict(
          "占用冲突",
          `订单 ${order.code} 已在骑手 ${order.rider} 名下，改派请用「改派」操作`,
          order.address,
          order.rider,
          order.slot,
          describeValue(order)
        )
      ]
    };
  }

  const next = cloneState(state);
  const target = next.orders.find((o) => o.id === orderId)!;
  target.rider = rider;
  target.status = ASSIGNED;
  ensureOccupancy(next, target);
  return { ok: true, conflicts: [], notice: `已派给 ${rider}，登记 ${rider} 在 ${target.slot} 的一次占用`, next };
}

/**
 * 改派：先释放原骑手在原时段的占用，再登记新骑手占用。
 * 新骑手该时段已被别的地址占用时指出冲突并保留原值。
 */
export function reassignRider(state: DeskState, orderId: string, newRider: string): ActionResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, conflicts: [] };
  if (isDelivered(order) || !isActive(order)) {
    return { ok: false, conflicts: [freezeConflict(order, "改派")] };
  }
  if (order.status !== ASSIGNED || !order.rider) {
    return {
      ok: false,
      conflicts: [
        conflict("占用冲突", `订单 ${order.code} 尚未派出，不能改派`, order.address, order.rider, order.slot, describeValue(order))
      ]
    };
  }
  if (newRider === order.rider) {
    return { ok: false, conflicts: [], notice: "新骑手与原骑手相同，无需改派" };
  }

  const newKey = occupancyKey(newRider, order.slot);
  const occupied = state.occupancies.find((e) => e.key === newKey);
  if (occupied && occupied.address.trim() !== order.address.trim()) {
    return {
      ok: false,
      conflicts: [
        conflict(
          "占用冲突",
          `改派失败：${newRider} 在 ${order.slot} 已被「${occupied.address}」（订单 ${occupied.orderCode}）占用，原骑手占用未释放、原值保留`,
          order.address,
          newRider,
          order.slot,
          `原值：${describeValue(order)}；冲突占用：${occupied.rider}｜${occupied.slot}｜${occupied.address}｜订单${occupied.orderCode}`
        )
      ]
    };
  }

  const next = cloneState(state);
  const target = next.orders.find((o) => o.id === orderId)!;
  const oldRider = target.rider;
  // 改派前释放原骑手占用
  releaseOccupancy(next, target);
  target.rider = newRider;
  ensureOccupancy(next, target);
  return {
    ok: true,
    conflicts: [],
    notice: `已改派：先释放 ${oldRider} 在 ${target.slot} 的占用，再登记 ${newRider} 的一次占用`,
    next
  };
}

/* ---------- 送达（冻结并释放占用） ---------- */

export function markDelivered(state: DeskState, orderId: string): ActionResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, conflicts: [] };
  if (isDelivered(order)) {
    return { ok: false, conflicts: [freezeConflict(order, "重复送达")] };
  }
  if (!isActive(order) || order.status !== ASSIGNED) {
    return {
      ok: false,
      conflicts: [
        conflict("冻结拦截", `订单 ${order.code} 还未派出，不能送达`, order.address, order.rider, order.slot, describeValue(order))
      ]
    };
  }

  const next = cloneState(state);
  const target = next.orders.find((o) => o.id === orderId)!;
  target.status = DELIVERED;
  // 送达释放骑手时段占用（同槽位另有在配订单则台账指向它）
  releaseOccupancy(next, target);
  return { ok: true, conflicts: [], notice: `${target.code} 已送达并冻结（v1），已释放 ${target.rider} 在 ${target.slot} 的占用`, next };
}

/* ---------- 手动释放台 ---------- */

/** 骑手/调度主动释放某已分配订单的时段占用；订单退回未分配 */
export function releaseOrder(state: DeskState, orderId: string): ActionResult {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, conflicts: [] };
  if (isDelivered(order) || !isActive(order)) {
    return { ok: false, conflicts: [freezeConflict(order, "释放占用")] };
  }
  if (order.status !== ASSIGNED || !order.rider) {
    return { ok: false, conflicts: [], notice: `订单 ${order.code} 当前没有骑手占用` };
  }

  const next = cloneState(state);
  const target = next.orders.find((o) => o.id === orderId)!;
  const oldRider = target.rider;
  releaseOccupancy(next, target);
  target.rider = "";
  target.status = UNASSIGNED;
  return { ok: true, conflicts: [], notice: `已手动释放 ${oldRider} 在 ${target.slot} 的占用，订单退回未分配`, next };
}

/* ---------- 新增订单 ---------- */

export function createOrder(
  state: DeskState,
  input: NewOrderInput,
  id: string,
  code: string,
  createdAt: string
): ActionResult {
  const conflicts: ConflictDraft[] = [];
  const order: DeliveryOrder = {
    id,
    code,
    address: input.address.trim(),
    slot: input.slot,
    rider: input.rider ?? "",
    distance: input.distance,
    notes: input.notes.trim() || "暂无备注",
    status: input.rider ? ASSIGNED : UNASSIGNED,
    version: 1,
    mergedIntoId: null,
    absorbedCodes: [],
    createdAt
  };

  if (order.rider) {
    const key = occupancyKey(order.rider, order.slot);
    const occupied = state.occupancies.find((e) => e.key === key);
    if (occupied && occupied.address.trim() !== order.address.trim()) {
      conflicts.push(
        conflict(
          "占用冲突",
          `登记失败：${order.rider} 在 ${order.slot} 已被「${occupied.address}」（订单 ${occupied.orderCode}）占用，新订单保留在输入区`,
          order.address,
          order.rider,
          order.slot,
          `冲突占用：${occupied.rider}｜${occupied.slot}｜${occupied.address}｜订单${occupied.orderCode}`
        )
      );
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, conflicts, notice: "骑手时段冲突，未写入订单" };
  }

  const next = cloneState(state);
  next.orders.unshift(order);
  ensureOccupancy(next, order);
  return { ok: true, conflicts: [], notice: `已登记订单 ${code}${order.rider ? `，占用 ${order.rider} 的 ${order.slot}` : "（未分配）"}`, next };
}

/* ---------- 冻结记录交接：不动原记录，另存原因与新版本 ---------- */

export interface HandoffRequest {
  orderId: string;
  reason: string;
  newRider: string;
  newAddress: string;
  newSlot: string;
  newDistance: number | null;
  newNotes: string;
}

export function createHandoff(
  state: DeskState,
  req: HandoffRequest,
  id: string,
  createdAt: string
): ActionResult {
  const order = state.orders.find((o) => o.id === req.orderId);
  if (!order) return { ok: false, conflicts: [], notice: "未找到订单" };
  if (!isDelivered(order) || !isActive(order)) {
    return {
      ok: false,
      conflicts: [
        conflict(
          "冻结拦截",
          `只有已送达并冻结的记录才能开交接单，${order.code} 当前为「${order.status}」`,
          order.address,
          order.rider,
          order.slot,
          describeValue(order)
        )
      ]
    };
  }
  if (!req.reason.trim()) {
    return { ok: false, conflicts: [], notice: "交接必须填写原因" };
  }

  const changes: Partial<OrderSnapshot> = {};
  const newAddress = req.newAddress.trim();
  if (newAddress && newAddress !== order.address) changes.address = newAddress;
  if (req.newSlot && req.newSlot !== order.slot) changes.slot = req.newSlot;
  if (req.newRider && req.newRider !== order.rider) changes.rider = req.newRider;
  if (req.newDistance !== null && req.newDistance !== order.distance) changes.distance = req.newDistance;
  const newNotes = req.newNotes.trim();
  if (newNotes && newNotes !== order.notes) changes.notes = newNotes;

  if (Object.keys(changes).length === 0) {
    return { ok: false, conflicts: [], notice: "调整内容与冻结原值完全相同，无需另存版本" };
  }

  // 新骑手+新时段占用冲突检查（以调整后的骑手/时段为准）
  const rider = changes.rider ?? order.rider;
  const slot = changes.slot ?? order.slot;
  const address = changes.address ?? order.address;
  if (rider && slot && (changes.rider || changes.slot)) {
    const key = occupancyKey(rider, slot);
    const occupied = state.occupancies.find((e) => e.key === key);
    if (occupied && occupied.address.trim() !== address.trim()) {
      return {
        ok: false,
        conflicts: [
          conflict(
            "占用冲突",
            `交接新版本未保存：${rider} 在 ${slot} 已被「${occupied.address}」（订单 ${occupied.orderCode}）占用；冻结原值保留`,
            order.address,
            rider,
            slot,
            `冻结原值：${describeValue(order)}；冲突占用：${occupied.rider}｜${occupied.slot}｜${occupied.address}`
          )
        ]
      };
    }
  }

  const version = state.handoffs.filter((h) => h.orderId === order.id).length + 2;
  const record: HandoffRecord = {
    id,
    orderId: order.id,
    orderCode: order.code,
    version,
    reason: req.reason.trim(),
    snapshot: snapshot(order),
    changes,
    createdAt
  };

  const next = cloneState(state);
  next.handoffs.push(record);
  return {
    ok: true,
    conflicts: [],
    notice: `已为冻结订单 ${order.code} 另存交接 v${version}，原记录保持 v1 不变`,
    next
  };
}

/* ---------- 一致性审计：刷新后订单、占用、交接必须一致 ---------- */

export function auditConsistency(state: DeskState): ConflictDraft[] {
  const issues: ConflictDraft[] = [];
  const activeAssigned = state.orders.filter(isAssignedActive);
  const activeById = new Map(state.orders.filter(isActive).map((o) => [o.id, o]));

  // 1. 台账中存在的 骑手+时段，订单侧必须也有在配占用
  for (const entry of state.occupancies) {
    const holders = activeAssigned.filter(
      (o) => occupancyKey(o.rider, o.slot) === entry.key
    );
    if (holders.length === 0) {
      issues.push(
        conflict(
          "一致性异常",
          `占用台账有 ${entry.rider} 在 ${entry.slot} 的占用，但订单侧已无对应在配订单`,
          entry.address,
          entry.rider,
          entry.slot,
          `台账指向订单 ${entry.orderCode}（${entry.orderId}）`
        )
      );
      continue;
    }
    // 2. 台账地址、指向订单必须与订单资料一致
    const owner = activeById.get(entry.orderId);
    if (!owner || owner.status !== ASSIGNED || occupancyKey(owner.rider, owner.slot) !== entry.key) {
      const earliest = [...holders].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      issues.push(
        conflict(
          "一致性异常",
          `占用台账指向订单 ${entry.orderCode}，但该订单并非 ${entry.rider} 在 ${entry.slot} 的在配记录（应指向 ${earliest.code}）`,
          entry.address,
          entry.rider,
          entry.slot,
          `台账原值：订单${entry.orderCode}｜${entry.address}；实际最早在配：订单${earliest.code}｜${earliest.address}`
        )
      );
    } else if (owner.address !== entry.address) {
      issues.push(
        conflict(
          "一致性异常",
          `占用台账地址与订单 ${entry.orderCode} 不一致`,
          entry.address,
          entry.rider,
          entry.slot,
          `台账地址原值：${entry.address}；订单地址：${owner.address}`
        )
      );
    }
  }

  // 3. 每条在配订单的 骑手+时段 必须在台账中，且每个 骑手+时段 只记一次
  for (const order of activeAssigned) {
    const key = occupancyKey(order.rider, order.slot);
    const entries = state.occupancies.filter((e) => e.key === key);
    if (entries.length === 0) {
      issues.push(
        conflict(
          "一致性异常",
          `订单 ${order.code} 显示在配，但占用台账缺少 ${order.rider} 在 ${order.slot} 的占用`,
          order.address,
          order.rider,
          order.slot,
          `订单原值：${describeValue(order)}`
        )
      );
    } else if (entries.length > 1) {
      issues.push(
        conflict(
          "一致性异常",
          `${order.rider} 在 ${order.slot} 被重复登记占用（应只记一次）`,
          order.address,
          order.rider,
          order.slot,
          `台账重复条目数：${entries.length}，订单 ${order.code}`
        )
      );
    }
  }

  // 4. 未送达记录不应有骑手占用残留之外的状态问题：未分配不得挂占用
  for (const order of state.orders) {
    if (isActive(order) && order.status === UNASSIGNED && order.rider !== "") {
      issues.push(
        conflict(
          "一致性异常",
          `订单 ${order.code} 状态为未分配却仍挂骑手`,
          order.address,
          order.rider,
          order.slot,
          `订单原值：${describeValue(order)}`
        )
      );
    }
    if (isDelivered(order)) {
      // 同地址由他人占用是允许的；仅当台账仍指向该冻结订单时才算占用泄漏
      const pointsAtMe = state.occupancies.some((e) => e.orderId === order.id);
      if (pointsAtMe) {
        issues.push(
          conflict(
            "一致性异常",
            `已送达冻结订单 ${order.code} 仍占用 ${order.rider} 的 ${order.slot}，应已释放`,
            order.address,
            order.rider,
            order.slot,
            `台账仍指向订单 ${order.code}`
          )
        );
      }
    }
  }

  // 5. 合并指向必须真实且同址同时段同骑手
  for (const order of state.orders) {
    if (order.mergedIntoId) {
      const target = state.orders.find((o) => o.id === order.mergedIntoId);
      if (!target) {
        issues.push(
          conflict(
            "一致性异常",
            `订单 ${order.code} 的合并目标已不存在`,
            order.address,
            order.rider,
            order.slot,
            `mergedIntoId=${order.mergedIntoId}`
          )
        );
      } else {
        const valid =
          target.address === order.address &&
          target.slot === order.slot &&
          target.rider === order.rider &&
          isActive(target);
        if (!valid) {
          issues.push(
            conflict(
              "一致性异常",
              `订单 ${order.code} 的合并资料与主记录 ${target.code} 不一致`,
              order.address,
              order.rider,
              order.slot,
              `原值：${describeValue(order)}；主记录：${describeValue(target)}`
            )
          );
        }
      }
    }
  }

  // 6. 交接记录必须指向真实的已送达冻结订单，版本连续递增
  for (const handoff of state.handoffs) {
    const order = state.orders.find((o) => o.id === handoff.orderId);
    if (!order) {
      issues.push(
        conflict(
          "一致性异常",
          `交接记录 v${handoff.version} 指向的订单 ${handoff.orderCode} 已不存在`,
          handoff.snapshot.address,
          handoff.snapshot.rider,
          handoff.snapshot.slot,
          `原值快照：${handoff.snapshot.address}｜${handoff.snapshot.rider}｜${handoff.snapshot.slot}`
        )
      );
      continue;
    }
    if (!isDelivered(order)) {
      issues.push(
        conflict(
          "一致性异常",
          `交接记录 v${handoff.version} 关联的订单 ${order.code} 已不是已送达冻结状态`,
          order.address,
          order.rider,
          order.slot,
          `订单当前：${order.status}；交接原值：${describeValue(order)}`
        )
      );
    }
    if (handoff.version < 2) {
      issues.push(
        conflict(
          "一致性异常",
          `订单 ${order.code} 的交接版本号异常：${handoff.version}（应从 v2 起）`,
          order.address,
          order.rider,
          order.slot,
          `原值：${describeValue(order)}`
        )
      );
    }
  }

  return issues;
}
