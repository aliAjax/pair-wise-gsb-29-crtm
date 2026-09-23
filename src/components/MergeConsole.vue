<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { evaluateMerge, isActive } from "../logic/core";
import type { DeskState, MergeResult } from "../types";

const props = defineProps<{
  state: DeskState;
}>();

const emit = defineEmits<{
  merge: [targetId: string, candidateIds: string[]];
}>();

const targetId = ref("");
const picked = ref<Set<string>>(new Set());
const result = ref<MergeResult | null>(null);

// 主记录只能选未送达的活跃记录（已送达不得合并）
const targetOptions = computed(() =>
  props.state.orders.filter((o) => isActive(o) && o.status !== "已送达")
);

const candidates = computed(() => {
  if (!targetId.value) return [];
  const target = props.state.orders.find((o) => o.id === targetId.value);
  if (!target) return [];
  return props.state.orders
    .filter((o) => o.id !== targetId.value && isActive(o))
    .map((candidate) => {
      const verdict = evaluateMerge(props.state, target.id, candidate.id);
      return { order: candidate, verdict };
    });
});

watch(targetId, () => {
  picked.value = new Set();
  result.value = null;
});

function toggle(id: string, ok: boolean) {
  if (!ok) return; // 不合规候选不允许勾选，但页面仍展示冲突原因
  const nextSet = new Set(picked.value);
  if (nextSet.has(id)) nextSet.delete(id);
  else nextSet.add(id);
  picked.value = nextSet;
}

function doMerge() {
  if (!targetId.value || picked.value.size === 0) return;
  emit("merge", targetId.value, [...picked.value]);
}

function show(res: MergeResult) {
  result.value = res;
  if (res.ok) picked.value = new Set();
}

defineExpose({ show });
</script>

<template>
  <section class="panel merge-console">
    <h2>同址订单合并台</h2>
    <p class="hint">规则：同地址 ＋ 同配送时段 ＋ 同骑手 ＋ 双方未送达才能并入主记录；主记录的骑手、距离、备注不变，占用只记一次。异骑手 / 已送达一律拒绝并保留输入。</p>

    <label class="target-pick">
      主记录（未送达）
      <select v-model="targetId">
        <option value="" disabled>选择并入目标订单</option>
        <option v-for="o in targetOptions" :key="o.id" :value="o.id">
          {{ o.code }}｜{{ o.rider || "未分配" }}｜{{ o.address }}｜{{ o.slot }}
        </option>
      </select>
    </label>

    <div v-if="targetId" class="candidate-list">
      <p class="candidate-title">勾选要并入的候选：</p>
      <div v-for="{ order, verdict } in candidates" :key="order.id" class="candidate-row">
        <label class="candidate-check" :class="{ blocked: !verdict.ok }">
          <input
            type="checkbox"
            :checked="picked.has(order.id)"
            :disabled="!verdict.ok"
            @change="toggle(order.id, verdict.ok)"
          />
          <span class="candidate-info">
            <b>{{ order.code }}</b>
            {{ order.rider || "未分配" }}｜{{ order.address }}｜{{ order.slot }}｜{{ order.distance }}km
            <em v-if="order.status === '已送达'" class="tag-freeze">已送达冻结</em>
            <em v-else-if="verdict.ok" class="tag-ok">可并入</em>
            <em v-else class="tag-bad">不可并入</em>
          </span>
        </label>
        <ul v-if="!verdict.ok" class="objections">
          <li v-for="(c, i) in verdict.objections" :key="i">{{ c.summary }}</li>
        </ul>
      </div>
    </div>

    <button type="button" class="primary merge-btn" :disabled="!targetId || picked.size === 0" @click="doMerge">
      合并选中订单（{{ picked.size }}）
    </button>

    <p v-if="result" :class="['merge-result', result.ok ? 'ok' : 'bad']">{{ result.notice }}</p>
  </section>
</template>
