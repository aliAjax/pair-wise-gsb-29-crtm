/**
 * 数据层：订单资料
 * 只负责数据结构、初始资料与 localStorage 读写，不包含任何业务判定。
 */

export const RIDERS = ["骑手A", "骑手B", "骑手C"] as const;
export const SLOTS = ["10:00-12:00", "14:00-16:00", "18:00-20:00"] as const;

export const STATUS_UNDELIVERED = "未送达";
export const STATUS_DELIVERED = "已送达";
export const STATUS_EMPTY = "未分配";
export const STATUSES = [STATUS_EMPTY, STATUS_UNDELIVERED, STATUS_DELIVERED] as const;

/** 交接类型：仅“已送达记录的后续调整”才产生交接记录与新版本 */
export const HANDOFF_FROZEN_ADJUST = "已送达冻结后调整";
export const HANDOFF_DELIVERED_REVISE = "已送达改派新版本";

export type OrderStatus = (typeof STATUSES)[number];

export type HandoffReason = typeof HANDOFF_FROZEN_ADJUST | typeof HANDOFF_DELIVERED_REVISE;

export interface Order {
  id: string;
  /** 订单号，同一张订单的新版本沿用同一 orderNo */
  orderNo: string;
  /** 版本号，原始记录为 1，冻结后调整产生 2、3… */
  version: number;
  address: string;
  slot: string;
  rider: string;
  distance: number;
  notes: string;
  status: OrderStatus;
  /** 并入本单的原始订单号 */
  mergedOrderNos: string[];
  /** 由哪张已送达记录调整而来 */
  derivedFromId?: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface HandoffChange {
  field: string;
  label: string;
  oldValue: string | number;
  newValue: string | number;
}

export interface Handoff {
  id: string;
  reason: HandoffReason;
  memo: string;
  sourceOrderId: string;
  sourceOrderNo: string;
  newOrderId: string;
  changes: HandoffChange[];
  createdAt: string;
}

export interface PersistState {
  orders: Order[];
  handoffs: Handoff[];
  savedAt: string;
}

export const STORAGE_KEY = "hxwlfront-15-last-mile-console";

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60000).toISOString();

/** 初始演示资料：覆盖可合并、跨骑手不可合并、已送达冻结、未分配等场景 */
export function buildSeedOrders(): Order[] {
  return [
    {
      id: "seed-1",
      orderNo: "DD0923-01",
      version: 1,
      address: "世纪大道100号",
      slot: "10:00-12:00",
      rider: "骑手A",
      distance: 1.8,
      notes: "优先配送",
      status: STATUS_UNDELIVERED,
      mergedOrderNos: ["DD0923-02"],
      createdAt: iso(90)
    },
    {
      id: "seed-3",
      orderNo: "DD0923-03",
      version: 1,
      address: "世纪大道100号",
      slot: "10:00-12:00",
      rider: "骑手B",
      distance: 2.1,
      notes: "跨骑手，不得并入A的记录",
      status: STATUS_UNDELIVERED,
      mergedOrderNos: [],
      createdAt: iso(70)
    },
    {
      id: "seed-4",
      orderNo: "DD0923-04",
      version: 1,
      address: "世纪大道100号",
      slot: "14:00-16:00",
      rider: "骑手A",
      distance: 1.8,
      notes: "时段不同，不得合并",
      status: STATUS_UNDELIVERED,
      mergedOrderNos: [],
      createdAt: iso(60)
    },
    {
      id: "seed-5",
      orderNo: "DD0923-05",
      version: 1,
      address: "陆家嘴环路55号",
      slot: "14:00-16:00",
      rider: "骑手B",
      distance: 2.4,
      notes: "已送达，冻结",
      status: STATUS_DELIVERED,
      mergedOrderNos: [],
      createdAt: iso(300),
      deliveredAt: iso(200)
    },
    {
      id: "seed-6",
      orderNo: "DD0923-06",
      version: 1,
      address: "陆家嘴环路55号",
      slot: "14:00-16:00",
      rider: "骑手B",
      distance: 2.4,
      notes: "目标已送达，禁止并入",
      status: STATUS_UNDELIVERED,
      mergedOrderNos: [],
      createdAt: iso(50)
    },
    {
      id: "seed-7",
      orderNo: "DD0923-07",
      version: 1,
      address: "南京东路步行街",
      slot: "18:00-20:00",
      rider: "",
      distance: 3.2,
      notes: "等待调度",
      status: STATUS_EMPTY,
      mergedOrderNos: [],
      createdAt: iso(40)
    }
  ];
}

export function buildSeedState(): PersistState {
  return {
    orders: buildSeedOrders(),
    handoffs: [],
    savedAt: new Date().toISOString()
  };
}

/** 读取本地资料；解析失败时回退为空台席（而非演示数据，避免静默覆盖） */
export function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return buildSeedState();
  try {
    const parsed = JSON.parse(raw) as PersistState;
    if (!Array.isArray(parsed.orders) || !Array.isArray(parsed.handoffs)) {
      throw new Error("bad shape");
    }
    return parsed;
  } catch {
    return { orders: [], handoffs: [], savedAt: new Date().toISOString() };
  }
}

export function saveState(state: PersistState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, savedAt: new Date().toISOString() } satisfies PersistState)
  );
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
