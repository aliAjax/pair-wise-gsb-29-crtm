<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { RIDERS } from "../data/catalog";
import { DELIVERED } from "../logic/core";
import type { DeliveryOrder, HandoffRecord } from "../types";

const props = defineProps<{
  orders: DeliveryOrder[];
  handoffs: HandoffRecord[];
}>();

const emit = defineEmits<{
  assign: [orderId: string, rider: string];
  reassign: [orderId: string, rider: string];
  deliver: [orderId: string];
  release: [orderId: string];
}>();

const filter = ref("全部骑手");
const riderFilters = ["全部骑手", "未分配", ...RIDERS];

const filtered = computed(() => {
  if (filter.value === "全部骑手") return props.orders;
  if (filter.value === "未分配") return props.orders.filter((o) => o.status === "未分配" || !o.rider);
  return props.orders.filter((o) => o.rider === filter.value);
});

// 每行一个骑手选择值，默认空 -> 操作时提示选择
const picks = reactive<Record<string, string>>({});

function handoffsOf(orderId: string) {
  return props.handoffs
    .filter((h) => h.orderId === orderId)
    .sort((a, b) => b.version - a.version);
}

function doAssign(order: DeliveryOrder) {
  const rider = picks[order.id];
  if (!rider) return;
  emit("assign", order.id, rider);
  picks[order.id] = "";
}

function doReassign(order: DeliveryOrder) {
  const rider = picks[order.id];
  if (!rider || rider === order.rider) return;
  emit("reassign", order.id, rider);
  picks[order.id] = "";
}

function statusClass(status: string) {
  if (status === "已送达") return "st-delivered";
  if (status === "已分配") return "st-assigned";
  return "st-unassigned";
}
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <h2>订单台账</h2>
      <select v-model="filter" class="filter-select">
        <option v-for="item in riderFilters" :key="item" :value="item">{{ item }}</option>
      </select>
    </div>

    <div v-if="filtered.length === 0" class="empty">暂无匹配订单</div>

    <div class="order-list">
      <article v-for="order in filtered" :key="order.id" class="order-card">
        <div class="order-head">
          <div>
            <p class="order-title">
              {{ order.code }}
              <span class="addr">{{ order.address }}</span>
            </p>
            <p class="order-slot">时段 {{ order.slot }} ｜ 距离 {{ order.distance }}km ｜ v{{ order.version }}</p>
          </div>
          <span :class="['status-pill', statusClass(order.status)]">
            {{ order.status }}{{ order.status === DELIVERED ? " · 冻结" : "" }}
          </span>
        </div>

        <div class="order-meta">
          <span>骑手：{{ order.rider || "未分配" }}</span>
          <span>备注：{{ order.notes }}</span>
        </div>

        <div v-if="order.absorbedCodes.length" class="absorbed">
          已并入：<b v-for="code in order.absorbedCodes" :key="code">{{ code }}</b>
        </div>

        <!-- 未送达：未分配可派单 -->
        <div v-if="order.status === '未分配'" class="row-actions">
          <select v-model="picks[order.id]">
            <option value="" disabled>选择骑手派单</option>
            <option v-for="rider in RIDERS" :key="rider" :value="rider">{{ rider }}</option>
          </select>
          <button type="button" :disabled="!picks[order.id]" @click="doAssign(order)">派单并占用时段</button>
        </div>

        <!-- 已分配（未送达）：改派前先释放原骑手 -->
        <div v-else-if="order.status === '已分配'" class="row-actions">
          <select v-model="picks[order.id]">
            <option value="" disabled>改派给…</option>
            <option v-for="rider in RIDERS.filter((r) => r !== order.rider)" :key="rider" :value="rider">{{ rider }}</option>
          </select>
          <button type="button" class="ghost" :disabled="!picks[order.id]" @click="doReassign(order)">
            改派（先释放{{ order.rider }}）
          </button>
          <button type="button" class="primary" @click="emit('deliver', order.id)">送达并冻结</button>
          <button type="button" class="warn" @click="emit('release', order.id)">手动释放</button>
        </div>

        <!-- 已送达：冻结，调整看下方交接新版本 -->
        <div v-else class="frozen-box">
          <span>🔒 记录已冻结，任何调整只在交接台另存新版本，不改本单</span>
          <div v-if="handoffsOf(order.id).length" class="handoff-links">
            <a v-for="h in handoffsOf(order.id)" :key="h.id" :href="`#handoff-${h.id}`">交接 v{{ h.version }}</a>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
