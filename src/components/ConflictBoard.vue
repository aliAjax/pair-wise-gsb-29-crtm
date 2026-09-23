<script setup lang="ts">
import type { ConflictDraft, ConflictItem } from "../types";

defineProps<{
  /** 刷新后审计出的一致性问题 */
  audit: ConflictDraft[];
  /** 操作被拒时记录的冲突 */
  log: ConflictItem[];
}>();

const emit = defineEmits<{ clearLog: [] }>();

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="panel conflict-board">
    <div class="section-head">
      <h2>冲突与一致性台</h2>
      <button v-if="log.length" type="button" class="ghost" @click="emit('clearLog')">清空操作冲突</button>
    </div>

    <div v-if="audit.length === 0 && log.length === 0" class="all-clear">
      ✓ 刷新后订单、占用、交接记录三方一致，无冲突
    </div>

    <div v-if="audit.length" class="conflict-group">
      <p class="group-title danger-text">一致性异常（刷新审计，{{ audit.length }}）</p>
      <div v-for="(item, i) in audit" :key="`audit-${i}`" class="conflict-row danger">
        <p class="conflict-summary">{{ item.summary }}</p>
        <dl class="conflict-fields">
          <div><dt>地址</dt><dd>{{ item.address || "—" }}</dd></div>
          <div><dt>骑手</dt><dd>{{ item.rider || "—" }}</dd></div>
          <div><dt>时段</dt><dd>{{ item.slot || "—" }}</dd></div>
          <div class="full"><dt>原值</dt><dd>{{ item.original }}</dd></div>
        </dl>
      </div>
    </div>

    <div v-if="log.length" class="conflict-group">
      <p class="group-title warn-text">操作冲突（{{ log.length }}）</p>
      <div v-for="item in log" :key="item.id" class="conflict-row warn">
        <div class="conflict-top">
          <span class="badge-kind">{{ item.kind }}</span>
          <time>{{ time(item.createdAt) }}</time>
        </div>
        <p class="conflict-summary">{{ item.summary }}</p>
        <dl class="conflict-fields">
          <div><dt>地址</dt><dd>{{ item.address || "—" }}</dd></div>
          <div><dt>骑手</dt><dd>{{ item.rider || "—" }}</dd></div>
          <div><dt>时段</dt><dd>{{ item.slot || "—" }}</dd></div>
          <div class="full"><dt>原值</dt><dd>{{ item.original }}</dd></div>
        </dl>
      </div>
    </div>
  </section>
</template>
