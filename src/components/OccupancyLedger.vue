<script setup lang="ts">
import { computed } from "vue";
import type { DeliveryOrder, OccupancyEntry } from "../types";

const props = defineProps<{
  occupancies: OccupancyEntry[];
  orders: DeliveryOrder[];
}>();

// 按骑手分组展示
const rows = computed(() => {
  const map = new Map<string, OccupancyEntry[]>();
  for (const entry of props.occupancies) {
    const list = map.get(entry.rider) ?? [];
    list.push(entry);
    map.set(entry.rider, list);
  }
  return [...map.entries()].map(([rider, entries]) => ({
    rider,
    entries: entries.sort((a, b) => a.slot.localeCompare(b.slot))
  }));
});

const ridersWithNoLoad = computed(() => {
  const busy = new Set(props.occupancies.map((e) => e.rider));
  return ["骑手A", "骑手B", "骑手C"].filter((r) => !busy.has(r));
});
</script>

<template>
  <section class="panel ledger">
    <h2>骑手时段占用 / 释放台</h2>
    <p class="hint">同一骑手同一时段只登记一次占用；改派、送达、手动释放都会实时更新本台账。</p>

    <div v-if="occupancies.length === 0" class="empty">当前没有任何骑手时段占用</div>

    <div v-for="group in rows" :key="group.rider" class="ledger-group">
      <p class="ledger-rider">{{ group.rider }}<span>{{ group.entries.length }} 个时段</span></p>
      <div v-for="entry in group.entries" :key="entry.key" class="ledger-entry">
        <span class="slot-chip">{{ entry.slot }}</span>
        <span class="ledger-addr">{{ entry.address }}</span>
        <span class="ledger-order">主订单 {{ entry.orderCode }}</span>
      </div>
    </div>

    <p v-if="ridersWithNoLoad.length" class="idle-riders">
      当前空闲骑手：<b v-for="(r, i) in ridersWithNoLoad" :key="r">{{ r }}{{ i < ridersWithNoLoad.length - 1 ? "、" : "" }}</b>
    </p>
  </section>
</template>
