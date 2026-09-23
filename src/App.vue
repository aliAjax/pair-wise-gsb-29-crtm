<script setup lang="ts">
import { computed, ref } from "vue";
import ConflictBoard from "./components/ConflictBoard.vue";
import HandoffPanel from "./components/HandoffPanel.vue";
import MergeConsole from "./components/MergeConsole.vue";
import MetricsBar from "./components/MetricsBar.vue";
import OccupancyLedger from "./components/OccupancyLedger.vue";
import OrderDesk from "./components/OrderDesk.vue";
import OrderForm from "./components/OrderForm.vue";
import { useDeskStore } from "./stores/desk";
import type { HandoffRequest, MergeResult, NewOrderInput } from "./types";

const store = useDeskStore();

const orderFormRef = ref<InstanceType<typeof OrderForm> | null>(null);
const mergeRef = ref<InstanceType<typeof MergeConsole> | null>(null);
const handoffRef = ref<InstanceType<typeof HandoffPanel> | null>(null);

// 判定层只读视图（合并台需要对订单逐个做合并判定）
const deskState = computed(() => ({
  orders: store.orders,
  occupancies: store.occupancies,
  handoffs: store.handoffs
}));

function addOrder(input: NewOrderInput) {
  orderFormRef.value?.show(store.addOrder(input));
}

function doMerge(targetId: string, candidateIds: string[]) {
  const result: MergeResult = store.merge(targetId, candidateIds);
  mergeRef.value?.show(result);
}

function doHandoff(req: HandoffRequest) {
  handoffRef.value?.show(store.handoff(req));
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 城市末端配送</p>
          <h1>同址订单合并与骑手时段释放台</h1>
          <p class="subtitle">
            同地址且同时段、同骑手的未送达订单可并入主记录（骑手、距离、备注不变，占用只记一次）；
            改派先释放原骑手占用，送达冻结后调整只走交接另存新版本。刷新后订单、占用、交接三方一致。
          </p>
        </div>
        <button type="button" class="ghost reset-btn" @click="store.resetDemo()">恢复演示数据</button>
      </header>

      <MetricsBar :metrics="store.metrics" />

      <ConflictBoard
        :audit="store.auditIssues"
        :log="store.conflictLog"
        @clear-log="store.clearConflictLog()"
      />

      <div class="layout">
        <div class="col-left">
          <OrderForm ref="orderFormRef" @submit="addOrder" />
          <HandoffPanel
            ref="handoffRef"
            :orders="store.orders"
            :handoffs="store.handoffs"
            @handoff="doHandoff"
          />
        </div>

        <div class="col-right">
          <OrderDesk
            :orders="store.activeOrders"
            :handoffs="store.handoffs"
            @assign="(id, rider) => store.assign(id, rider)"
            @reassign="(id, rider) => store.reassign(id, rider)"
            @deliver="store.deliver"
            @release="store.release"
          />
        </div>
      </div>

      <div class="layout-bottom">
        <MergeConsole ref="mergeRef" :state="deskState" @merge="doMerge" />
        <OccupancyLedger :occupancies="store.occupancies" :orders="store.orders" />
      </div>
    </div>
  </main>
</template>
