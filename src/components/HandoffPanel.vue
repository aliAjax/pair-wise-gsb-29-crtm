<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { RIDERS, SLOTS, FIELD_LABELS } from "../data/catalog";
import { DELIVERED, KEEP, type HandoffRequest } from "../logic/core";
import type { DeliveryOrder, HandoffRecord, OrderSnapshot } from "../types";

const props = defineProps<{
  orders: DeliveryOrder[];
  handoffs: HandoffRecord[];
}>();

const emit = defineEmits<{
  handoff: [req: HandoffRequest];
}>();

const orderId = ref("");
const form = reactive({
  reason: "",
  rider: KEEP,
  address: "",
  slot: KEEP,
  distance: "" as string | number,
  notes: ""
});
const notice = ref<{ ok: boolean; text: string } | null>(null);

const frozenOrders = computed(() => props.orders.filter((o) => o.status === DELIVERED && o.mergedIntoId === null));

const selected = computed(() => props.orders.find((o) => o.id === orderId.value) ?? null);

const recordsOfSelected = computed(() =>
  props.handoffs
    .filter((h) => h.orderId === orderId.value)
    .sort((a, b) => a.version - b.version)
);

watch(orderId, () => {
  form.reason = "";
  form.rider = KEEP;
  form.address = "";
  form.slot = KEEP;
  form.distance = "";
  form.notes = "";
  notice.value = null;
});

const changePreview = computed<{ field: keyof OrderSnapshot; from: string | number; to: string | number }[]>(() => {
  if (!selected.value) return [];
  const o = selected.value;
  const preview: { field: keyof OrderSnapshot; from: string | number; to: string | number }[] = [];
  if (form.rider !== KEEP && form.rider !== o.rider) preview.push({ field: "rider", from: o.rider, to: form.rider });
  if (form.address.trim() && form.address.trim() !== o.address)
    preview.push({ field: "address", from: o.address, to: form.address.trim() });
  if (form.slot !== KEEP && form.slot !== o.slot) preview.push({ field: "slot", from: o.slot, to: form.slot });
  if (form.distance !== "" && Number(form.distance) !== o.distance)
    preview.push({ field: "distance", from: o.distance, to: Number(form.distance) });
  if (form.notes.trim() && form.notes.trim() !== o.notes)
    preview.push({ field: "notes", from: o.notes, to: form.notes.trim() });
  return preview;
});

function submit() {
  if (!orderId.value) return;
  emit("handoff", {
    orderId: orderId.value,
    reason: form.reason,
    newRider: form.rider === KEEP ? "" : form.rider,
    newAddress: form.address,
    newSlot: form.slot === KEEP ? "" : form.slot,
    newDistance: form.distance === "" ? null : Number(form.distance),
    newNotes: form.notes
  });
}

function show(result: { ok: boolean; notice: string }) {
  notice.value = { ok: result.ok, text: result.notice };
  if (result.ok) {
    form.reason = "";
    form.rider = KEEP;
    form.address = "";
    form.slot = KEEP;
    form.distance = "";
    form.notes = "";
  }
}

function time(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

defineExpose({ show });
</script>

<template>
  <section class="panel handoff-panel">
    <h2>冻结记录交接台</h2>
    <p class="hint">已送达记录冻结为 v1 不可改；后续调整必须填写交接原因，另存为 v2、v3… 新版本，并保留原值快照。</p>

    <label>
      已送达冻结订单
      <select v-model="orderId">
        <option value="" disabled>选择需要调整的冻结订单</option>
        <option v-for="o in frozenOrders" :key="o.id" :value="o.id">
          {{ o.code }}｜{{ o.address }}｜{{ o.rider }}｜{{ o.slot }}
        </option>
      </select>
    </label>

    <div v-if="selected" class="freeze-original">
      <p class="orig-title">冻结原值（只读，v1）</p>
      <div class="orig-grid">
        <span>地址：{{ selected.address }}</span>
        <span>骑手：{{ selected.rider }}</span>
        <span>时段：{{ selected.slot }}</span>
        <span>距离：{{ selected.distance }}km</span>
        <span class="full">备注：{{ selected.notes }}</span>
      </div>
    </div>

    <div v-if="selected" class="handoff-form">
      <label>
        新骑手（不改请留"不调整"）
        <select v-model="form.rider">
          <option :value="KEEP">不调整</option>
          <option v-for="rider in RIDERS" :key="rider" :value="rider">{{ rider }}</option>
        </select>
      </label>
      <label>
        新地址（留空即不调整）
        <input v-model="form.address" :placeholder="selected.address" />
      </label>
      <label>
        新时段
        <select v-model="form.slot">
          <option :value="KEEP">不调整</option>
          <option v-for="slot in SLOTS" :key="slot" :value="slot">{{ slot }}</option>
        </select>
      </label>
      <label>
        新距离km（留空即不调整）
        <input v-model="form.distance" type="number" min="0" step="0.1" :placeholder="String(selected.distance)" />
      </label>
      <label>
        新备注（留空即不调整）
        <textarea v-model="form.notes" :placeholder="selected.notes" />
      </label>
      <label class="reason">
        交接原因（必填）
        <textarea v-model="form.reason" placeholder="如：客户改约明日，需顺延时段" required />
      </label>

      <div v-if="changePreview.length" class="preview">
        <p>本次将另存的变更：</p>
        <ul>
          <li v-for="item in changePreview" :key="item.field">
            {{ FIELD_LABELS[item.field] }}：<del>{{ item.from }}</del> → <b>{{ item.to }}</b>
          </li>
        </ul>
      </div>
      <p v-else class="hint">未填写任何调整字段。</p>

      <button type="button" class="primary" :disabled="!form.reason.trim()" @click="submit">
        另存交接新版本
      </button>
      <p v-if="notice" :class="['form-notice', notice.ok ? 'ok' : 'bad']">{{ notice.text }}</p>
    </div>

    <div v-if="recordsOfSelected.length" class="handoff-log">
      <p class="orig-title">历史交接版本</p>
      <article v-for="h in recordsOfSelected" :id="`handoff-${h.id}`" :key="h.id" class="handoff-record">
        <header>
          <b>v{{ h.version }}</b>
          <time>{{ time(h.createdAt) }}</time>
        </header>
        <p class="handoff-reason">原因：{{ h.reason }}</p>
        <ul class="handoff-changes">
          <li v-for="(value, key) in h.changes" :key="key">
            {{ FIELD_LABELS[key as keyof OrderSnapshot] }}：
            <del>{{ h.snapshot[key as keyof OrderSnapshot] }}</del> → <b>{{ value }}</b>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>
