<script setup lang="ts">
import { reactive, ref } from "vue";
import { RIDERS, SLOTS } from "../data/catalog";
import type { NewOrderInput } from "../types";

const emit = defineEmits<{ submit: [input: NewOrderInput] }>();

const form = reactive({
  address: "",
  slot: SLOTS[0],
  rider: "",
  distance: 1,
  notes: ""
});
const notice = ref<{ ok: boolean; text: string } | null>(null);

function onSubmit() {
  // 保留输入：由父层判定冲突，失败时不清空
  emit("submit", {
    address: form.address,
    slot: form.slot,
    rider: form.rider,
    distance: Number(form.distance) || 0,
    notes: form.notes
  });
}

function show(result: { ok: boolean; notice: string }) {
  notice.value = { ok: result.ok, text: result.notice };
  if (result.ok) {
    form.address = "";
    form.rider = "";
    form.distance = 1;
    form.notes = "";
  }
}

defineExpose({ show });
</script>

<template>
  <form class="panel" @submit.prevent="onSubmit">
    <h2>新增订单</h2>
    <div class="form-grid">
      <label>
        地址
        <input v-model="form.address" required placeholder="如：世纪大道100号" />
      </label>
      <label>
        配送时段
        <select v-model="form.slot" required>
          <option v-for="slot in SLOTS" :key="slot" :value="slot">{{ slot }}</option>
        </select>
      </label>
      <label>
        骑手（可不派，留空即未分配）
        <select v-model="form.rider">
          <option value="">暂不派单</option>
          <option v-for="rider in RIDERS" :key="rider" :value="rider">{{ rider }}</option>
        </select>
      </label>
      <label>
        距离km
        <input v-model.number="form.distance" type="number" min="0" step="0.1" required />
      </label>
      <label>
        备注
        <textarea v-model="form.notes" placeholder="处理说明或现场备注" />
      </label>
      <button type="submit">登记订单</button>
      <p v-if="notice" :class="['form-notice', notice.ok ? 'ok' : 'bad']">{{ notice.text }}</p>
    </div>
  </form>
</template>
