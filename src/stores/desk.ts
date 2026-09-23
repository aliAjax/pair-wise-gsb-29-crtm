import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { STORAGE_KEY, buildInitialState } from "../data/catalog";
import {
  assignRider,
  auditConsistency,
  createHandoff,
  createOrder,
  isActive,
  markDelivered,
  mergeOrders,
  reassignRider,
  releaseOrder,
  type HandoffRequest
} from "../logic/core";
import type {
  ConflictDraft,
  ConflictItem,
  DeskState,
  HandoffRecord,
  MergeResult,
  NewOrderInput,
  OccupancyEntry,
  DeliveryOrder
} from "../types";

// 状态层：负责持久化（刷新后一致）、调用判定层、给冲突补 id/时间。
// 判定规则不写在这里。

interface PersistShape {
  orders: DeliveryOrder[];
  occupancies: OccupancyEntry[];
  handoffs: HandoffRecord[];
}

function loadState(): DeskState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return buildInitialState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return {
      orders: Array.isArray(parsed.orders) ? (parsed.orders as DeliveryOrder[]) : [],
      occupancies: Array.isArray(parsed.occupancies) ? (parsed.occupancies as OccupancyEntry[]) : [],
      handoffs: Array.isArray(parsed.handoffs) ? (parsed.handoffs as HandoffRecord[]) : []
    };
  } catch {
    return buildInitialState();
  }
}

function decorate(draft: ConflictDraft): ConflictItem {
  return { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
}

export const useDeskStore = defineStore("delivery-desk", () => {
  const initial = loadState();
  const orders = ref<DeliveryOrder[]>(initial.orders);
  const occupancies = ref<OccupancyEntry[]>(initial.occupancies);
  const handoffs = ref<HandoffRecord[]>(initial.handoffs);
  /** 操作被拒产生的冲突（含地址、骑手、时段、原值） */
  const conflictLog = ref<ConflictItem[]>([]);

  // 首次进入（含种子数据）也落盘，保证刷新后订单、占用、交接一致
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ orders: orders.value, occupancies: occupancies.value, handoffs: handoffs.value })
  );

  function snapshot(): DeskState {
    return { orders: orders.value, occupancies: occupancies.value, handoffs: handoffs.value };
  }

  function commit(state?: DeskState) {
    if (state) {
      orders.value = state.orders;
      occupancies.value = state.occupancies;
      handoffs.value = state.handoffs;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ orders: orders.value, occupancies: occupancies.value, handoffs: handoffs.value })
    );
  }

  /** 执行判定层动作：冲突记录日志并返回 false；成功提交 next 状态 */
  function run(result: { ok: boolean; conflicts: ConflictDraft[]; notice?: string; next?: DeskState }) {
    if (!result.ok || !result.next) {
      pushConflicts(result.conflicts);
      return { ok: false, notice: result.notice ?? "操作未执行" };
    }
    commit(result.next);
    return { ok: true, notice: result.notice ?? "操作成功" };
  }

  function pushConflicts(drafts: ConflictDraft[]): ConflictItem[] {
    const items = drafts.map(decorate);
    conflictLog.value = [...items, ...conflictLog.value].slice(0, 50);
    return items;
  }

  function clearConflictLog() {
    conflictLog.value = [];
  }

  /** 刷新后自动审计：订单、占用、交接三方一致 */
  const auditIssues = computed<ConflictDraft[]>(() =>
    auditConsistency({ orders: orders.value, occupancies: occupancies.value, handoffs: handoffs.value })
  );

  const activeOrders = computed(() => orders.value.filter(isActive));

  const metrics = computed(() => {
    const active = activeOrders.value;
    const assigned = active.filter((o) => o.status === "已分配").length;
    const delivered = active.filter((o) => o.status === "已送达").length;
    const undelivered = active.length - delivered;
    const avgDistance =
      active.length > 0
        ? (active.reduce((sum, o) => sum + o.distance, 0) / active.length).toFixed(1)
        : "0.0";
    return [
      { label: "活跃订单", value: active.length },
      { label: "在配占用", value: assigned },
      { label: "未送达", value: undelivered },
      { label: "已送达冻结", value: delivered },
      { label: "占用条目", value: occupancies.value.length },
      { label: "交接版本", value: handoffs.value.length },
      { label: "平均距离km", value: avgDistance }
    ];
  });

  function nextCode(): string {
    const max = orders.value.reduce((acc, o) => {
      const n = Number(o.code.replace(/\D/g, ""));
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 1000);
    return `DM-${max + 1}`;
  }

  function addOrder(input: NewOrderInput): { ok: boolean; notice: string } {
    return run(
      createOrder(snapshot(), input, crypto.randomUUID(), nextCode(), new Date().toISOString())
    );
  }

  function assign(orderId: string, rider: string) {
    return run(assignRider(snapshot(), orderId, rider)).notice;
  }

  function reassign(orderId: string, rider: string) {
    return run(reassignRider(snapshot(), orderId, rider)).notice;
  }

  function deliver(orderId: string) {
    return run(markDelivered(snapshot(), orderId)).notice;
  }

  function release(orderId: string) {
    return run(releaseOrder(snapshot(), orderId)).notice;
  }

  function merge(targetId: string, candidateIds: string[]): MergeResult {
    const result = mergeOrders(snapshot(), targetId, candidateIds, new Date().toISOString(), crypto.randomUUID);
    if (!result.ok || !result.next) {
      pushConflicts(result.conflicts);
      return { ok: false, conflicts: result.conflicts, mergedCodes: [], notice: result.notice };
    }
    commit(result.next);
    return result;
  }

  function handoff(req: HandoffRequest) {
    return run(createHandoff(snapshot(), req, crypto.randomUUID(), new Date().toISOString()));
  }

  function resetDemo() {
    const state = buildInitialState();
    commit(state);
    conflictLog.value = [];
  }

  return {
    orders,
    occupancies,
    handoffs,
    conflictLog,
    auditIssues,
    activeOrders,
    metrics,
    addOrder,
    assign,
    reassign,
    deliver,
    release,
    merge,
    handoff,
    clearConflictLog,
    resetDemo
  };
});
