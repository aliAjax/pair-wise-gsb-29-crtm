<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import { useDispatchStore } from "./stores/dispatch";
import { STATUS_DELIVERED, STATUS_EMPTY, STATUS_UNDELIVERED, type Order } from "./data/orders";
import type { Conflict } from "./rules/dispatch";
import { formatTime } from "./utils/format";

const store = useDispatchStore();
const { orders, handoffs, occupancies, conflicts, savedAt, toasts } = storeToRefs(store);

/* ---------------- 录入表单 ---------------- */
const blankForm = () => ({
  address: "",
  rider: "骑手A",
  slot: "10:00-12:00",
  distance: 1,
  notes: ""
});
const form = reactive(blankForm());

function submitOrder() {
  if (!form.address.trim()) return;
  store.addOrder({ ...form, address: form.address.trim() });
  Object.assign(form, blankForm());
}

/* ---------------- 筛选 ---------------- */
const filterRider = ref("全部骑手");
const filterStatus = ref("全部状态");
const statusOptions = ["全部状态", STATUS_EMPTY, STATUS_UNDELIVERED, STATUS_DELIVERED];

const filteredOrders = computed(() =>
  orders.value.filter((o) => {
    if (filterRider.value !== "全部骑手" && o.rider !== filterRider.value) return false;
    if (filterStatus.value !== "全部状态" && o.status !== filterStatus.value) return false;
    return true;
  })
);

/* ---------------- 指标 ---------------- */
const metrics = computed(() => {
  const undelivered = orders.value.filter((o) => o.status === STATUS_UNDELIVERED).length;
  const delivered = orders.value.filter((o) => o.status === STATUS_DELIVERED).length;
  const merged = orders.value.reduce((acc, o) => acc + o.mergedOrderNos.length, 0);
  const activeRiders = new Set(orders.value.filter((o) => o.rider && o.status !== STATUS_DELIVERED).map((o) => o.rider));
  return [
    { label: "订单记录", value: orders.value.length },
    { label: "在途未送达", value: undelivered },
    { label: "已送达冻结", value: delivered },
    { label: "已并入订单", value: merged },
    { label: "占用中骑手", value: activeRiders.size }
  ];
});

/* ---------------- 改派弹窗（未送达） ---------------- */
const reassignTarget = ref<Order | null>(null);
const reassignForm = reactive({ rider: "骑手A", slot: "10:00-12:00" });

function openReassign(order: Order) {
  reassignTarget.value = order;
  reassignForm.rider = order.rider || "骑手A";
  reassignForm.slot = order.slot;
}
function confirmReassign() {
  if (!reassignTarget.value) return;
  store.reassign(reassignTarget.value.id, reassignForm.rider, reassignForm.slot);
  reassignTarget.value = null;
}

/* ---------------- 合并选择 ---------------- */
function candidateLabel(target: Order) {
  return `${target.orderNo}｜${target.rider}｜${target.address}｜${target.slot}`;
}
const selectedMergeTarget = ref<Record<string, string>>({});
function doMerge(order: Order) {
  const targetId = selectedMergeTarget.value[order.id];
  if (!targetId) return;
  store.merge(order.id, targetId);
  delete selectedMergeTarget.value[order.id];
}

/* ---------------- 已送达调整（新版本+交接） ---------------- */
const reviseTarget = ref<Order | null>(null);
const reviseForm = reactive({ rider: "", slot: "", distance: 0, notes: "", reason: "客户改约", memo: "" });
const reviseReasons = ["客户改约", "地址更正", "骑手异常改派", "客户拒收后重派", "其他"];

function openRevise(order: Order) {
  reviseTarget.value = order;
  reviseForm.rider = order.rider;
  reviseForm.slot = order.slot;
  reviseForm.distance = order.distance;
  reviseForm.notes = order.notes;
  reviseForm.reason = "客户改约";
  reviseForm.memo = "";
}
function confirmRevise() {
  if (!reviseTarget.value) return;
  const src = reviseTarget.value;
  store.revise(
    src.id,
    {
      rider: reviseForm.rider,
      slot: reviseForm.slot,
      distance: Number(reviseForm.distance),
      notes: reviseForm.notes
    },
    reviseForm.reason,
    reviseForm.memo
  );
  reviseTarget.value = null;
}

/* ---------------- 冲突展示 ---------------- */
function conflictKey(c: Conflict) {
  return [c.type, c.address, c.rider, c.slot, c.oldValue, c.sourceOrderNo, c.targetOrderNo].join("|");
}

function statusClass(status: string) {
  if (status === STATUS_UNDELIVERED) return "st-undelivered";
  if (status === STATUS_DELIVERED) return "st-delivered";
  return "st-empty";
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 城市末端配送调度台</p>
          <h1>同址订单合并与骑手时段释放台</h1>
          <p class="subtitle">
            同地址且同配送时段只能并入未送达记录，原骑手、距离、备注不变；不同骑手或已送达不得合并。
            改派先释放原占用、再记一次新占用；已送达记录冻结，后续调整另存交接原因与新版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">Element Plus</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <!-- 骑手时段占用 -->
      <section class="panel occupancy-panel">
        <div class="panel-head">
          <h2>骑手时段占用台</h2>
          <p class="hint">每个骑手 × 时段最多一格占用；合并后同一格只保留一条记录。已送达自动释放。</p>
        </div>
        <div class="occ-grid">
          <div v-for="cell in occupancies" :key="`${cell.rider}-${cell.slot}`" class="occ-cell">
            <div class="occ-head">
              <strong>{{ cell.rider }}</strong>
              <span class="occ-slot">{{ cell.slot }}</span>
            </div>
            <p class="occ-address">{{ cell.address }}</p>
            <p class="occ-order">{{ cell.orderNos.join("、") }}</p>
          </div>
          <div v-if="occupancies.length === 0" class="empty">当前无骑手时段占用</div>
        </div>
      </section>

      <section class="workspace">
        <!-- 录入 -->
        <form class="panel" @submit.prevent="submitOrder">
          <h2>录入新订单</h2>
          <div class="form-grid">
            <label>地址
              <input v-model="form.address" placeholder="如：世纪大道100号" required />
            </label>
            <label>配送时段
              <select v-model="form.slot">
                <option v-for="s in store.slots" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label>骑手
              <select v-model="form.rider">
                <option value="">暂不派单（未分配）</option>
                <option v-for="r in store.riders" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label>距离km
              <input v-model.number="form.distance" type="number" min="0" step="0.1" required />
            </label>
            <label>备注
              <textarea v-model="form.notes" placeholder="合并时备注以主记录为准" />
            </label>
            <button type="submit">录入并自动判合并</button>
            <p class="hint">同址、同时段、同骑手且主记录未送达时，新单自动并入，骑手/距离/备注不变。</p>
          </div>
        </form>

        <!-- 订单列表 -->
        <section class="list-panel">
          <div class="toolbar">
            <h2>订单清单</h2>
            <div class="toolbar-controls">
              <select v-model="filterRider">
                <option>全部骑手</option>
                <option v-for="r in store.riders" :key="r" :value="r">{{ r }}</option>
                <option value="">未分配</option>
              </select>
              <select v-model="filterStatus">
                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
              </select>
              <button type="button" class="secondary" @click="store.refresh()">刷新校验</button>
              <button type="button" class="secondary" @click="store.resetDemo()">重置演示</button>
            </div>
          </div>

          <!-- 冲突条 -->
          <div v-if="conflicts.length" class="conflict-banner">
            <strong>刷新校验发现 {{ conflicts.length }} 处冲突：</strong>
            <ul>
              <li v-for="c in conflicts" :key="conflictKey(c)">
                {{ c.message }}
                <span v-if="c.address || c.rider || c.slot || c.oldValue !== undefined" class="conflict-meta">
                  （地址：{{ c.address || "—" }}，骑手：{{ c.rider || "—" }}，时段：{{ c.slot || "—" }}，原值：{{ c.oldValue ?? "—" }}）
                </span>
              </li>
            </ul>
          </div>

          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配订单</div>
            <article
              v-for="order in filteredOrders"
              :key="order.id"
              class="record"
              :class="{ frozen: order.status === STATUS_DELIVERED, merged: order.mergedOrderNos.length }"
            >
              <div class="record-head">
                <p class="record-title">
                  {{ order.orderNo }}
                  <span v-if="order.version > 1" class="version-tag">v{{ order.version }}</span>
                </p>
                <span class="status" :class="statusClass(order.status)">{{ order.status }}</span>
              </div>
              <div class="details">
                <span>地址：{{ order.address }}</span>
                <span>时段：{{ order.slot }}</span>
                <span>骑手：{{ order.rider || "未分配" }}</span>
                <span>距离：{{ order.distance }}km</span>
              </div>
              <p class="note">备注：{{ order.notes }}</p>
              <p v-if="order.mergedOrderNos.length" class="merged-line">
                已并入：<b>{{ order.mergedOrderNos.join("、") }}</b>（骑手/距离/备注沿用本单）
              </p>
              <p v-if="order.derivedFromId" class="derived-line">
                由已送达冻结记录调整生成的新版本 · 建单 {{ formatTime(order.createdAt) }}
              </p>

              <div class="actions">
                <template v-if="order.status === STATUS_UNDELIVERED">
                  <button type="button" @click="openReassign(order)">改派 / 换时段</button>
                  <button type="button" class="secondary" @click="store.deliver(order.id)">标记送达</button>
                  <button type="button" class="secondary" @click="store.recall(order.id)">撤回派单</button>
                </template>
                <template v-else-if="order.status === STATUS_EMPTY">
                  <button type="button" @click="openReassign(order)">派单</button>
                </template>
                <template v-else>
                  <button type="button" class="secondary" @click="openRevise(order)">冻结调整（另存新版本）</button>
                  <span class="frozen-text">送达于 {{ formatTime(order.deliveredAt) }}</span>
                </template>
                <button type="button" class="danger ghost" @click="store.removeOrder(order.id)">删除</button>
              </div>

              <!-- 手动合并：仅未送达单出现候选 -->
              <div v-if="order.status !== STATUS_DELIVERED" class="merge-box">
                <select v-model="selectedMergeTarget[order.id]">
                  <option value="">选择同址同时段主记录并入…</option>
                  <option
                    v-for="t in store.mergeCandidates(order)"
                    :key="t.id"
                    :value="t.id"
                  >{{ candidateLabel(t) }}</option>
                </select>
                <button
                  type="button"
                  class="secondary"
                  :disabled="!selectedMergeTarget[order.id]"
                  @click="doMerge(order)"
                >合并</button>
              </div>
            </article>
          </div>
        </section>
      </section>

      <!-- 交接记录 -->
      <section class="panel handoff-panel">
        <div class="panel-head">
          <h2>交接记录（已送达冻结后的调整留痕）</h2>
          <p class="hint">原单不修改；每条记录对应一张同订单号的新版本与调整原因。</p>
        </div>
        <table v-if="handoffs.length" class="handoff-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>原订单</th>
              <th>原因</th>
              <th>字段变更（原值 → 新值）</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in handoffs" :key="h.id">
              <td>{{ formatTime(h.createdAt) }}</td>
              <td>{{ h.sourceOrderNo }}</td>
              <td><span class="handoff-reason">{{ h.reason }}</span></td>
              <td>
                <span v-for="ch in h.changes" :key="ch.field" class="change-chip">
                  {{ ch.label }}：{{ ch.oldValue || "—" }} → <b>{{ ch.newValue }}</b>
                </span>
              </td>
              <td>{{ h.memo }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无交接记录</div>
      </section>

      <footer class="foot">
        <span>上次刷新/保存：{{ formatTime(savedAt) }}</span>
        <span>数据保存于浏览器 localStorage · 资料 / 规则 / 页面三层分离</span>
      </footer>
    </div>

    <!-- 改派弹窗 -->
    <div v-if="reassignTarget" class="modal-mask" @click.self="reassignTarget = null">
      <div class="modal">
        <h3>改派骑手 / 时段</h3>
        <p class="hint">
          订单 {{ reassignTarget.orderNo }}（{{ reassignTarget.address }}）。
          保存时先释放原骑手 {{ reassignTarget.rider || "未分配" }} / {{ reassignTarget.slot }} 的占用，再占用新时段；冲突则全部保留原值。
        </p>
        <label>新骑手
          <select v-model="reassignForm.rider">
            <option v-for="r in store.riders" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>新时段
          <select v-model="reassignForm.slot">
            <option v-for="s in store.slots" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="reassignTarget = null">取消</button>
          <button type="button" @click="confirmReassign">先释放再占用</button>
        </div>
      </div>
    </div>

    <!-- 冻结调整弹窗 -->
    <div v-if="reviseTarget" class="modal-mask" @click.self="reviseTarget = null">
      <div class="modal wide">
        <h3>已送达冻结调整 · 另存新版本</h3>
        <p class="hint">
          原订单 {{ reviseTarget.orderNo }} 保持已送达不变，将生成 v{{ reviseTarget.version + 1 }} 新版本并写入交接记录。
        </p>
        <label>新骑手
          <select v-model="reviseForm.rider">
            <option v-for="r in store.riders" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>新时段
          <select v-model="reviseForm.slot">
            <option v-for="s in store.slots" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label>距离km
          <input v-model.number="reviseForm.distance" type="number" min="0" step="0.1" />
        </label>
        <label>备注
          <textarea v-model="reviseForm.notes" />
        </label>
        <label>交接原因
          <select v-model="reviseForm.reason">
            <option v-for="r in reviseReasons" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>交接说明
          <input v-model="reviseForm.memo" placeholder="必填场景说明（可留空使用原因）" />
        </label>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="reviseTarget = null">取消</button>
          <button type="button" @click="confirmRevise">生成新版本并登记交接</button>
        </div>
      </div>
    </div>

    <!-- 全局提示 -->
    <div class="toast-stack">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone">
        <p>{{ t.text }}</p>
        <ul v-if="t.conflicts?.length">
          <li v-for="(c, i) in t.conflicts" :key="i">
            {{ c.message }}
            <span v-if="c.address || c.rider || c.slot || c.oldValue !== undefined" class="conflict-meta">
              （地址：{{ c.address || "—" }}，骑手：{{ c.rider || "—" }}，时段：{{ c.slot || "—" }}，原值：{{ c.oldValue ?? "—" }}）
            </span>
          </li>
        </ul>
      </div>
    </div>
  </main>
</template>
