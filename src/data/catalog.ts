import type { DeskState, DeliveryOrder, OrderSnapshot } from "../types";
import { deriveOccupancies, emptyState } from "../logic/core";

// 订单资料：骑手名册、配送时段、种子订单与字段标签
// 本文件只负责"资料"，不含任何判定规则。

export const RIDERS = ["骑手A", "骑手B", "骑手C"] as const;
export const SLOTS = [
  "08:00-10:00",
  "10:00-12:00",
  "12:00-14:00",
  "14:00-16:00",
  "16:00-18:00",
  "18:00-20:00"
] as const;

export const STORAGE_KEY = "hxwlfront-15-last-mile-desk";

export const FIELD_LABELS: Record<keyof OrderSnapshot, string> = {
  rider: "骑手",
  address: "地址",
  slot: "配送时段",
  distance: "距离km",
  notes: "备注"
};

interface SeedOrder {
  rider: string;
  address: string;
  slot: string;
  distance: number;
  notes: string;
  status: DeliveryOrder["status"];
}

export const SEED_ORDERS: SeedOrder[] = [
  {
    rider: "骑手A",
    address: "世纪大道100号",
    slot: "10:00-12:00",
    distance: 1.8,
    notes: "优先配送",
    status: "已分配"
  },
  {
    rider: "骑手A",
    address: "世纪大道100号",
    slot: "10:00-12:00",
    distance: 1.2,
    notes: "门口代收",
    status: "已分配"
  },
  {
    rider: "骑手B",
    address: "世纪大道100号",
    slot: "10:00-12:00",
    distance: 2.4,
    notes: "待确认",
    status: "已分配"
  },
  {
    rider: "骑手C",
    address: "陆家嘴环路88号",
    slot: "14:00-16:00",
    distance: 3.1,
    notes: "生鲜加急",
    status: "已分配"
  },
  {
    rider: "",
    address: "张杨路500号",
    slot: "14:00-16:00",
    distance: 2.0,
    notes: "本人签收",
    status: "未分配"
  },
  {
    rider: "骑手B",
    address: "世纪大道100号",
    slot: "14:00-16:00",
    distance: 2.6,
    notes: "已拍照留档",
    status: "已送达"
  }
];

export function snapshotOf(order: DeliveryOrder): OrderSnapshot {
  return {
    rider: order.rider,
    address: order.address,
    slot: order.slot,
    distance: order.distance,
    notes: order.notes
  };
}

/** 首次进入时的整桌初始状态：占用由订单资料推导，保证三方一致 */
export function buildInitialState(now: number = Date.now()): DeskState {
  const orders: DeliveryOrder[] = SEED_ORDERS.map((seed, index) => ({
    id: `seed-${index + 1}`,
    code: `DM-100${index + 1}`,
    address: seed.address,
    slot: seed.slot,
    rider: seed.rider,
    distance: seed.distance,
    notes: seed.notes,
    status: seed.status,
    version: 1,
    mergedIntoId: null,
    absorbedCodes: [],
    createdAt: new Date(now - (SEED_ORDERS.length - index) * 3600_000).toISOString()
  }));

  const base: DeskState = { ...emptyState(), orders };
  return { ...base, occupancies: deriveOccupancies(orders) };
}
