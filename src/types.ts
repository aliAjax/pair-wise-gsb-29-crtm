// 领域模型：订单、骑手时段占用、交接（冻结后调整）记录、冲突

export type OrderStatus = "未分配" | "已分配" | "已送达";

/** 配送订单（已送达即冻结，版本从 v1 起） */
export interface DeliveryOrder {
  id: string;
  /** 订单号，如 DM-1001 */
  code: string;
  address: string;
  /** 配送时段，如 10:00-12:00 */
  slot: string;
  /** 骑手姓名；空串表示未分配 */
  rider: string;
  /** 距离 km */
  distance: number;
  notes: string;
  status: OrderStatus;
  /** 当前版本：冻结记录恒为 v1，调整以交接记录另存 v2、v3…… */
  version: number;
  /** 被合并到哪条主记录；null 表示仍是活跃记录 */
  mergedIntoId: string | null;
  /** 已并入本记录的订单号（保留追溯） */
  absorbedCodes: string[];
  createdAt: string;
}

/** 骑手时段占用台账条目，按 骑手+时段 去重，只记一次 */
export interface OccupancyEntry {
  key: string;
  rider: string;
  slot: string;
  address: string;
  /** 当前主订单（合并后指向合并目标） */
  orderId: string;
  orderCode: string;
}

/** 订单关键资料快照 */
export interface OrderSnapshot {
  rider: string;
  address: string;
  slot: string;
  distance: number;
  notes: string;
}

/** 冻结记录的交接调整：不动原记录，另存原因与新版本 */
export interface HandoffRecord {
  id: string;
  orderId: string;
  orderCode: string;
  /** 新版本号，首条交接为 v2 */
  version: number;
  reason: string;
  /** 冻结时的原值快照 */
  snapshot: OrderSnapshot;
  /** 拟调整字段 */
  changes: Partial<OrderSnapshot>;
  createdAt: string;
}

export type ConflictKind = "合并冲突" | "占用冲突" | "冻结拦截" | "一致性异常";

/** 冲突必须指出地址、骑手、时段和原值 */
export interface ConflictItem {
  id: string;
  kind: ConflictKind;
  summary: string;
  address: string;
  rider: string;
  slot: string;
  /** 原值描述 */
  original: string;
  createdAt: string;
}

/** 判定层产出的冲突草稿，id/时间由存储层补 */
export type ConflictDraft = Omit<ConflictItem, "id" | "createdAt">;

/** 持久化的整桌状态：订单、占用、交接记录 */
export interface DeskState {
  orders: DeliveryOrder[];
  occupancies: OccupancyEntry[];
  handoffs: HandoffRecord[];
}

export interface NewOrderInput {
  address: string;
  slot: string;
  rider: string;
  distance: number;
  notes: string;
}

export interface ActionResult {
  ok: boolean;
  conflicts: ConflictDraft[];
  notice?: string;
  /** 成功时携带的新状态；纯函数不修改入参 */
  next?: DeskState;
}

export interface MergeResult extends ActionResult {
  mergedCodes: string[];
  /** 成功时携带合并后的新状态（纯函数不隐式改入参） */
  next?: DeskState;
}
