/**
 * 状态编排：把数据层资料与判定层规则接到页面动作上，
 * 每次变更后立即落盘，保证刷新后订单、占用、交接记录一致。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  RIDERS,
  SLOTS,
  STATUS_DELIVERED,
  STATUS_EMPTY,
  STATUS_UNDELIVERED,
  clearState,
  loadState,
  saveState,
  type Order,
  type PersistState
} from "../data/orders";
import {
  auditConsistency,
  buildOccupancies,
  findMergeTargets,
  markDelivered,
  mergeOrders,
  reassignRider,
  reviseDelivered,
  withdrawAssignment,
  type Conflict
} from "../rules/dispatch";

export interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
  conflicts?: Conflict[];
}

export interface NewOrderInput {
  address: string;
  slot: string;
  rider: string;
  distance: number;
  notes: string;
}

let orderSeq = 100;
const nextOrderNo = () => {
  orderSeq += 1;
  return `DD0923-${String(orderSeq).padStart(2, "0")}`;
};

export const useDispatchStore = defineStore("dispatch", () => {
  const initial = loadState();
  const orders = ref<Order[]>(initial.orders);
  const handoffs = ref(initial.handoffs);
  const savedAt = ref(initial.savedAt);
  const toasts = ref<Toast[]>([]);
  let toastSeq = 0;

  const occupancies = computed(() => buildOccupancies(orders.value));
  const conflicts = computed(() => auditConsistency(orders.value, handoffs.value));

  function persist() {
    const state: PersistState = {
      orders: orders.value,
      handoffs: handoffs.value,
      savedAt: new Date().toISOString()
    };
    saveState(state);
    savedAt.value = state.savedAt;
  }

  function pushToast(tone: Toast["tone"], text: string, list?: Conflict[]) {
    const id = ++toastSeq;
    toasts.value.push({ id, tone, text, conflicts: list });
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 6000);
  }

  function addOrder(input: NewOrderInput): void {
    const incoming: Order = {
      id: crypto.randomUUID(),
      orderNo: nextOrderNo(),
      version: 1,
      address: input.address.trim(),
      slot: input.slot,
      rider: input.rider,
      distance: input.distance,
      notes: input.notes.trim() || "暂无备注",
      status: input.rider ? STATUS_UNDELIVERED : STATUS_EMPTY,
      mergedOrderNos: [],
      createdAt: new Date().toISOString()
    };

    // 新单自动并入：同址同时段、同骑手、主记录未送达
    if (incoming.rider) {
      const target = orders.value.find(
        (o) =>
          o.status === STATUS_UNDELIVERED &&
          o.rider === incoming.rider &&
          o.slot === incoming.slot &&
          o.address.trim() === incoming.address
      );
      if (target) {
        const result = mergeOrders([incoming, ...orders.value], incoming.id, target.id);
        if (result.ok) {
          orders.value = result.orders;
          persist();
          pushToast("success", `新订单 ${incoming.orderNo} 已同址并入 ${target.orderNo}，骑手/距离/备注沿用主记录，仅记一次占用`);
          return;
        }
      }
    }

    orders.value = [incoming, ...orders.value];
    persist();
    pushToast("success", `订单 ${incoming.orderNo} 已录入`);
  }

  function merge(sourceId: string, targetId: string): void {
    const source = orders.value.find((o) => o.id === sourceId);
    const result = mergeOrders(orders.value, sourceId, targetId);
    if (!result.ok) {
      pushToast("error", "合并被拒绝，输入原样保留", result.conflicts);
      return;
    }
    const target = orders.value.find((o) => o.id === targetId);
    orders.value = result.orders;
    persist();
    pushToast("success", `订单 ${source?.orderNo} 已并入主记录 ${target?.orderNo}，骑手、距离、备注不变，占用只记一次`);
  }

  function reassign(orderId: string, rider: string, slot: string): void {
    const result = reassignRider(orders.value, orderId, rider, slot);
    if (!result.ok) {
      pushToast("error", "改派被拒绝，原骑手占用已保留", result.conflicts);
      return;
    }
    orders.value = result.orders;
    persist();
    pushToast("success", "已先释放原骑手时段占用，再占用新骑手时段");
  }

  function recall(orderId: string): void {
    orders.value = withdrawAssignment(orders.value, orderId);
    persist();
    pushToast("success", "已撤回派单，骑手时段占用释放");
  }

  function deliver(orderId: string): void {
    orders.value = markDelivered(orders.value, orderId, new Date().toISOString());
    persist();
    pushToast("success", "已送达，记录冻结并自动释放骑手时段");
  }

  function revise(
    orderId: string,
    patch: { rider?: string; slot?: string; address?: string; distance?: number; notes?: string },
    reason: string,
    memo: string
  ): void {
    const result = reviseDelivered(
      { orders: orders.value, handoffs: handoffs.value, savedAt: savedAt.value },
      orderId,
      patch,
      reason,
      memo
    );
    if (!result.ok) {
      pushToast("error", "交接新版本未生成", result.conflicts);
      return;
    }
    orders.value = result.orders;
    handoffs.value = result.handoffs;
    persist();
    pushToast("success", "原已送达记录保持冻结，已另存交接新版本并登记原因");
  }

  function removeOrder(orderId: string): void {
    orders.value = orders.value.filter((o) => o.id !== orderId);
    persist();
  }

  function refresh(): void {
    const state = loadState();
    orders.value = state.orders;
    handoffs.value = state.handoffs;
    savedAt.value = state.savedAt;
    const found = auditConsistency(orders.value, handoffs.value);
    if (found.length === 0) {
      pushToast("success", "刷新完成：订单、骑手时段占用、交接记录三者一致");
    } else {
      pushToast("error", `刷新发现 ${found.length} 处冲突`, found);
    }
  }

  function resetDemo(): void {
    clearState();
    const state = loadState();
    orders.value = state.orders;
    handoffs.value = state.handoffs;
    savedAt.value = state.savedAt;
    pushToast("success", "已恢复演示资料");
  }

  function mergeCandidates(order: Order) {
    return findMergeTargets(orders.value, order);
  }

  return {
    // data
    orders,
    handoffs,
    savedAt,
    toasts,
    riders: RIDERS,
    slots: SLOTS,
    // derived
    occupancies,
    conflicts,
    // actions
    addOrder,
    merge,
    reassign,
    recall,
    deliver,
    revise,
    removeOrder,
    refresh,
    resetDemo,
    mergeCandidates
  };
});

export { STATUS_DELIVERED, STATUS_EMPTY, STATUS_UNDELIVERED };
