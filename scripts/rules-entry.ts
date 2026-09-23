import {
  buildSeedOrders,
  STATUS_DELIVERED,
  STATUS_EMPTY,
  STATUS_UNDELIVERED,
  type Order,
  type PersistState
} from "../src/data/orders";
import {
  auditConsistency,
  buildOccupancies,
  canMerge,
  isOccupied,
  markDelivered,
  mergeOrders,
  reassignRider,
  reviseDelivered,
  withdrawAssignment
} from "../src/rules/dispatch";

function byNo(orders: Order[], no: string) {
  return orders.find((o) => o.orderNo === no)!;
}

let uid = 0;
const rid = () => `t-${++uid}`;

function makeOrder(partial: Partial<Order> & { orderNo: string }): Order {
  return {
    id: rid(),
    version: 1,
    address: "测试路1号",
    slot: "10:00-12:00",
    rider: "骑手A",
    distance: 1.2,
    notes: "原备注",
    status: STATUS_UNDELIVERED,
    mergedOrderNos: [],
    createdAt: new Date().toISOString(),
    ...partial
  };
}

export async function runChecks({ assert }: { assert: (n: string, c: boolean, d?: string) => void }) {
  // 1. 种子数据本身一致
  const seed = buildSeedOrders();
  assert("种子数据刷新校验无冲突", auditConsistency(seed, []).length === 0);

  // 2. 同址同时段同骑手未送达 → 可合并
  {
    const a = makeOrder({ orderNo: "T1", address: "同址", slot: "S1", rider: "骑手A" });
    const b = makeOrder({ orderNo: "T2", address: "同址", slot: "S1", rider: "骑手A", notes: "另一备注", distance: 9.9 });
    assert("canMerge 同址同时段同骑手通过", canMerge(a, b).ok);
    const r = mergeOrders([a, b], b.id, a.id);
    assert("合并成功", r.ok && r.orders.length === 1);
    const kept = r.orders[0];
    assert("主记录保留（骑手/距离/备注不变）", kept.notes === "原备注" && kept.distance === 1.2 && kept.rider === "骑手A");
    assert("并入订单号被记录", kept.mergedOrderNos.includes("T2"));
    const occ = buildOccupancies(r.orders);
    assert("合并后仅一次占用", occ.length === 1 && occ[0].orderNos.length === 1);
  }

  // 3. 不同骑手 → 拒绝，原值保留
  {
    const a = makeOrder({ orderNo: "T3", address: "同址", slot: "S1", rider: "骑手A" });
    const b = makeOrder({ orderNo: "T4", address: "同址", slot: "S1", rider: "骑手B" });
    const check = canMerge(a, b);
    assert("跨骑手不能合并", !check.ok && check.conflicts.some((c) => c.type === "DIFFERENT_RIDER"));
    const r = mergeOrders([a, b], b.id, a.id);
    assert("被拒后输入原样保留（两条都在，骑手值未变）", r.orders.length === 2 && byNo(r.orders, "T4").rider === "骑手B");
  }

  // 4. 不同时段 / 不同地址 → 拒绝
  {
    const a = makeOrder({ orderNo: "T5", address: "地址X", slot: "S1", rider: "骑手A" });
    const b = makeOrder({ orderNo: "T6", address: "地址X", slot: "S2", rider: "骑手A" });
    assert("时段不同不能合并", canMerge(a, b).conflicts.some((c) => c.type === "DIFFERENT_SLOT"));
    const c = makeOrder({ orderNo: "T7", address: "地址Y", slot: "S1", rider: "骑手A" });
    assert("地址不同不能合并", canMerge(a, c).conflicts.some((c2) => c2.type === "DIFFERENT_ADDRESS"));
  }

  // 5. 已送达 → 双向禁止合并
  {
    const a = makeOrder({ orderNo: "T8", rider: "骑手A", status: STATUS_DELIVERED });
    const b = makeOrder({ orderNo: "T9", rider: "骑手A" });
    assert("已送达主记录拒绝并入", canMerge(b, a).conflicts.some((c) => c.type === "TARGET_DELIVERED"));
    assert("已送达来源拒绝被并", canMerge(a, b).conflicts.some((c) => c.type === "SOURCE_DELIVERED"));
  }

  // 6. 未分配不能合并
  {
    const a = makeOrder({ orderNo: "T10", rider: "" });
    const b = makeOrder({ orderNo: "T11", rider: "" });
    assert("两条未分配不能合并", !canMerge(a, b).ok);
    const c = makeOrder({ orderNo: "T12", rider: "骑手A" });
    assert("未分配不能并入在派记录", canMerge(a, c).conflicts.some((x) => x.type === "DIFFERENT_RIDER"));
  }

  // 7. 改派：先释放原占用，新时段空闲 → 成功且只占新格
  {
    let orders = [
      makeOrder({ orderNo: "T13", rider: "骑手A", slot: "S1" }),
      makeOrder({ orderNo: "T14", rider: "骑手B", slot: "S2" })
    ];
    const target = byNo(orders, "T13");
    const r = reassignRider(orders, target.id, "骑手C", "S3");
    assert("改派成功", r.ok);
    orders = r.orders;
    assert("原占用已释放", !isOccupied(orders, "骑手A", "S1"));
    assert("新占用生效", isOccupied(orders, "骑手C", "S3"));
    const occ = buildOccupancies(orders);
    assert("占用格数不重复（3 格）", occ.length === 2);
  }

  // 8. 改派：目标时段被别人占用 → 拒绝，原值保留
  {
    const orders = [
      makeOrder({ orderNo: "T15", rider: "骑手A", slot: "S1", address: "旧址" }),
      makeOrder({ orderNo: "T16", rider: "骑手B", slot: "S2", address: "占址" })
    ];
    const r = reassignRider(orders, byNo(orders, "T15").id, "骑手B", "S2");
    assert("占用冲突时改派拒绝", !r.ok && r.conflicts[0].type === "OCCUPANCY_TAKEN");
    assert("冲突回报地址/骑手/时段/原值", r.conflicts[0].rider === "骑手B" && r.conflicts[0].slot === "S2" && r.conflicts[0].address === "旧址" && r.conflicts[0].oldValue === "T16/占址");
    assert("原骑手原时段保留", byNo(r.orders, "T15").rider === "骑手A" && byNo(r.orders, "T15").slot === "S1");
  }

  // 9. 已送达不能改派
  {
    const orders = [makeOrder({ orderNo: "T17", rider: "骑手A", status: STATUS_DELIVERED, deliveredAt: new Date().toISOString() })];
    const r = reassignRider(orders, orders[0].id, "骑手B", "S9");
    assert("已送达拒绝直接改派", !r.ok && r.conflicts[0].type === "FROZEN_ORDER");
  }

  // 10. 送达释放占用；撤回派单释放占用
  {
    const o = makeOrder({ orderNo: "T18", rider: "骑手A", slot: "S1" });
    const done = markDelivered([o], o.id, new Date().toISOString());
    assert("送达后释放占用", buildOccupancies(done).length === 0);
    const o2 = makeOrder({ orderNo: "T19", rider: "骑手A", slot: "S1" });
    const recalled = withdrawAssignment([o2], o2.id);
    assert("撤回后变为未分配且释放", recalled[0].status === STATUS_EMPTY && !recalled[0].rider && buildOccupancies(recalled).length === 0);
  }

  // 11. 冻结调整：原件不改，生成同号新版本 + 交接原因 + 字段差异
  {
    const frozen = makeOrder({
      orderNo: "T20",
      rider: "骑手A",
      slot: "S1",
      distance: 1.1,
      notes: "旧",
      status: STATUS_DELIVERED,
      deliveredAt: new Date().toISOString()
    });
    const state: PersistState = { orders: [frozen], handoffs: [], savedAt: "" };
    const r = reviseDelivered(state, frozen.id, { rider: "骑手B", slot: "S2" }, "骑手异常改派", "车辆故障");
    assert("交接新版本生成成功", r.ok && r.orders.length === 2);
    const origin = byNo(r.orders, "T20");
    assert("原记录冻结值不变", origin.rider === "骑手A" && origin.slot === "S1" && origin.status === STATUS_DELIVERED);
    const latest = r.orders.find((o) => o.version === 2)!;
    assert("新版本同订单号 v2 且为未送达", latest.orderNo === "T20" && latest.status === STATUS_UNDELIVERED);
    assert("新版本骑手时段已更新", latest.rider === "骑手B" && latest.slot === "S2");
    assert("交接记录含原因/原值/新值", r.handoffs.length === 1 && r.handoffs[0].memo === "车辆故障" &&
      r.handoffs[0].changes.some((c) => c.field === "rider" && c.oldValue === "骑手A" && c.newValue === "骑手B") &&
      r.handoffs[0].changes.some((c) => c.field === "slot" && c.oldValue === "S1" && c.newValue === "S2"));
    assert("新版本不继承历史合并号", Array.isArray(latest.mergedOrderNos) && latest.mergedOrderNos.length === 0);
    assert("交接后审计一致", auditConsistency(r.orders, r.handoffs).length === 0);
  }

  // 12. 冻结调整时新占用被占 → 拒绝，不生成任何东西
  {
    const frozen = makeOrder({ orderNo: "T21", rider: "骑手A", status: STATUS_DELIVERED, deliveredAt: new Date().toISOString() });
    const keeper = makeOrder({ orderNo: "T22", rider: "骑手B", slot: "S2" });
    const state: PersistState = { orders: [frozen, keeper], handoffs: [], savedAt: "" };
    const r = reviseDelivered(state, frozen.id, { rider: "骑手B", slot: "S2" }, "客户改约", "");
    assert("新版本占用冲突时整体拒绝", !r.ok && r.orders.length === 2 && r.handoffs.length === 0);
  }

  // 13. 无变化不生成新版本；未送达单不能走交接
  {
    const frozen = makeOrder({ orderNo: "T23", rider: "骑手A", status: STATUS_DELIVERED, deliveredAt: new Date().toISOString() });
    const r1 = reviseDelivered({ orders: [frozen], handoffs: [], savedAt: "" }, frozen.id, { rider: "骑手A" }, "其他", "");
    assert("无字段变化拒绝另存", !r1.ok);
    const live = makeOrder({ orderNo: "T24", rider: "骑手A", status: STATUS_UNDELIVERED });
    const r2 = reviseDelivered({ orders: [live], handoffs: [], savedAt: "" }, live.id, { rider: "骑手B" }, "其他", "");
    assert("未送达不能走交接流程", !r2.ok);
  }

  // 14. 审计能发现重复占用与断链交接
  {
    const a = makeOrder({ orderNo: "T25", rider: "骑手A", slot: "S1" });
    const b = makeOrder({ orderNo: "T26", rider: "骑手A", slot: "S1", address: "另一址" });
    const found = auditConsistency([a, b], []);
    assert("审计发现重复占用", found.some((c) => c.type === "OCCUPANCY_TAKEN"));
    const broken = auditConsistency([a, b], [
      { id: "h1", reason: "已送达改派新版本", memo: "", sourceOrderId: "nope", sourceOrderNo: "T99", newOrderId: "nope2", changes: [], createdAt: "" }
    ]);
    assert("审计发现交接断链", broken.some((c) => c.type === "FROZEN_ORDER"));
  }
}
