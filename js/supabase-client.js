const SUPABASE_URL = "https://nuszectdpuzywyhtlhin.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mKJEUod_lrhbYlFHTcuSWA_6lzLhQdX";
const ADMIN_FN_URL = SUPABASE_URL + "/functions/v1/admin-users";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

const Store = {
  session: null,
  profile: null,
  sales: [],
  inventory: [],
  inventoryHistory: [],
  inventoryTransactions: [],
  itemSettings: [],
  dataLoadedAt: null
};

function fmtWon(n, opts = {}) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const eok = 100000000;
  const man = 10000;
  if (opts.unit === "eok") {
    return (n / eok).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억원";
  }
  if (Math.abs(n) >= eok) {
    return (n / eok).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억원";
  }
  if (Math.abs(n) >= man) {
    return (n / man).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "만원";
  }
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtPct(n, opts = {}) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(opts.digits ?? 1) + "%";
}

function fmtDate(d) {
  if (!d) return "-";
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const MS = 24 * 3600 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS);
}

function exportCsv(filename, headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openSalesDetailModal(title, rows, opts = {}) {
  const totalRevenue = rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
  const totalQty = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const sorted = rows.slice().sort((a, b) => (b.sale_date + b.seq).localeCompare(a.sale_date + a.seq));
  const isAdmin = !!Store.profile?.is_admin;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card detail-modal-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <div class="modal-title" style="margin-bottom:4px">🔍 ${escapeHtml(title)}</div>
          <div class="text-faint" style="font-size:12px">${opts.subtitle ? escapeHtml(opts.subtitle) + " · " : ""}거래 ${fmtNum(rows.length)}건 · 매출 ${fmtWon(totalRevenue)} · 수량 ${fmtNum(totalQty)}개</div>
        </div>
        <div style="display:flex;gap:8px;flex:0 0 auto">
          ${isAdmin ? '<button class="btn btn-ghost btn-sm" id="detailModalAdd">+ 수기 등록</button>' : ""}
          <button class="btn btn-ghost btn-sm" id="detailModalExport">⇩ CSV</button>
          <button class="btn btn-ghost btn-sm" id="detailModalCloseX">✕</button>
        </div>
      </div>
      <div class="table-wrap detail-modal-table-wrap">
        <table class="data-table">
          <thead><tr><th>날짜</th><th>품명</th><th>거래처</th><th>담당자</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th><th>적요</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
          <tbody>${sorted.length ? sorted.map(r => `
            <tr>
              <td>${r.sale_date}</td>
              <td style="white-space:normal;min-width:160px">${escapeHtml(r.item_name)}</td>
              <td>${escapeHtml(r.customer || "-")}</td>
              <td>${escapeHtml(r.manager || "-")}</td>
              <td class="num">${fmtNum(r.qty)}</td>
              <td class="num">${fmtWon(r.unit_price)}</td>
              <td class="num">${fmtWon(r.total_amount)}</td>
              <td class="text-faint">${escapeHtml(r.note || "-")}</td>
              ${isAdmin ? `<td style="white-space:nowrap"><button class="btn btn-ghost btn-sm sale-edit-btn" data-key="${escapeHtml(r.row_key)}">수정</button><button class="btn btn-ghost btn-sm sale-del-btn" data-key="${escapeHtml(r.row_key)}">삭제</button></td>` : ""}
            </tr>`).join("") : `<tr><td colspan="${isAdmin ? 9 : 8}"><div class="empty-note">해당 조건의 거래 내역이 없습니다</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="detailModalCloseBtn">닫기</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("detailModalCloseBtn").addEventListener("click", () => overlay.remove());
  document.getElementById("detailModalCloseX").addEventListener("click", () => overlay.remove());
  document.getElementById("detailModalExport").addEventListener("click", () => {
    exportCsv(`${title}_상세내역.csv`, ["날짜", "품명", "거래처", "담당자", "수량", "단가", "금액", "적요"],
      sorted.map(r => [r.sale_date, r.item_name, r.customer, r.manager, r.qty, r.unit_price, r.total_amount, r.note]));
  });
  if (isAdmin) {
    document.getElementById("detailModalAdd")?.addEventListener("click", () => openManualSaleModal());
    overlay.querySelectorAll(".sale-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const row = rows.find(r => r.row_key === btn.dataset.key);
        if (row) openManualSaleModal(row);
      });
    });
    overlay.querySelectorAll(".sale-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 매출 기록을 삭제할까요? 되돌릴 수 없습니다.")) return;
        const { error } = await sb.from("sales").delete().eq("row_key", btn.dataset.key);
        if (error) { toast(error.message, "error"); return; }
        toast("매출 기록이 삭제되었습니다.", "success");
        overlay.remove();
        await loadAllData(true);
        renderView(AppState.view);
      });
    });
  }
}

function openManualSaleModal(existing = null) {
  const isEdit = !!existing;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:460px">
      <div class="modal-title">${isEdit ? "매출 기록 수정" : "매출 수기 등록"}</div>
      <div class="text-faint" style="font-size:12px;margin:-6px 0 12px">파일 재업로드 없이 낱건을 직접 추가/보정할 때 사용하세요. 금액은 수량 × 단가로 자동 계산되며 직접 고칠 수도 있습니다.</div>
      <form id="msForm" class="admin-form" style="grid-template-columns:1fr 1fr">
        <label>날짜 *<input type="date" id="msDate" required value="${existing?.sale_date || fmtDate(new Date())}"></label>
        <label>담당자<input type="text" id="msManager" value="${escapeHtml(existing?.manager || "")}"></label>
        <label style="grid-column:1/-1">품명 *<input type="text" id="msItem" required value="${escapeHtml(existing?.item_name || "")}"></label>
        <label>거래처<input type="text" id="msCustomer" value="${escapeHtml(existing?.customer || "")}"></label>
        <label>수량 *<input type="number" id="msQty" required step="any" value="${existing?.qty ?? ""}"></label>
        <label>단가<input type="number" id="msPrice" step="any" value="${existing?.unit_price ?? ""}"></label>
        <label>금액 *<input type="number" id="msAmount" required step="any" value="${existing?.total_amount ?? ""}"></label>
        <label style="grid-column:1/-1">적요<input type="text" id="msNote" value="${escapeHtml(existing?.note || "")}"></label>
      </form>
      <div class="modal-error" id="msError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="msCancelBtn">취소</button>
        <button type="submit" form="msForm" class="btn btn-primary">${isEdit ? "저장" : "등록"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("msCancelBtn").addEventListener("click", () => overlay.remove());
  const qtyEl = document.getElementById("msQty"), priceEl = document.getElementById("msPrice"), amtEl = document.getElementById("msAmount");
  const recalc = () => {
    const q = Number(qtyEl.value), p = Number(priceEl.value);
    if (q && p) amtEl.value = q * p;
  };
  qtyEl.addEventListener("input", recalc);
  priceEl.addEventListener("input", recalc);
  document.getElementById("msForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("msError");
    const sale_date = document.getElementById("msDate").value;
    const item_name = document.getElementById("msItem").value.trim();
    const qty = Number(qtyEl.value);
    const total_amount = Number(amtEl.value);
    if (!sale_date || !item_name || !qty || isNaN(total_amount)) { errEl.textContent = "날짜, 품명, 수량, 금액을 확인해주세요."; return; }
    const rec = {
      sale_date, item_name, qty,
      manager: document.getElementById("msManager").value.trim() || null,
      customer: document.getElementById("msCustomer").value.trim() || null,
      unit_price: priceEl.value ? Number(priceEl.value) : (qty ? total_amount / qty : null),
      total_amount,
      note: (document.getElementById("msNote").value.trim() || "수기입력")
    };
    if (isEdit) {
      const { error } = await sb.from("sales").update(rec).eq("row_key", existing.row_key);
      if (error) { errEl.textContent = error.message; return; }
    } else {
      rec.seq = 0;
      rec.row_key = `MANUAL#${sale_date}#${item_name}#${Date.now()}#${Math.floor(Math.random() * 100000)}`;
      const { error } = await sb.from("sales").insert([rec]);
      if (error) { errEl.textContent = error.message; return; }
    }
    overlay.remove();
    toast(isEdit ? "매출 기록이 수정되었습니다." : "매출이 수기 등록되었습니다.", "success");
    await loadAllData(true);
    renderView(AppState.view);
  });
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function fetchAllRows(table, columns = "*", pageSize = 1000) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function loadAllData(force = false) {
  const cacheKey = "wm_data_cache_v2";
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
        Store.sales = cached.sales;
        Store.inventory = cached.inventory;
        Store.inventoryHistory = cached.inventoryHistory;
        Store.inventoryTransactions = cached.inventoryTransactions || [];
        Store.itemSettings = cached.itemSettings || [];
        Store.dataLoadedAt = new Date(cached.ts);
        return;
      }
    } catch (e) {}
  }
  const [sales, inventory, inventoryHistory, inventoryTransactions, itemSettings] = await Promise.all([
    fetchAllRows("sales"),
    fetchAllRows("inventory_current"),
    fetchAllRows("inventory_history"),
    fetchAllRows("inventory_transactions"),
    fetchAllRows("item_settings")
  ]);
  Store.sales = sales;
  Store.inventory = inventory;
  Store.inventoryHistory = inventoryHistory;
  Store.inventoryTransactions = inventoryTransactions;
  Store.itemSettings = itemSettings;
  Store.dataLoadedAt = new Date();
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      ts: Store.dataLoadedAt.getTime(), sales, inventory, inventoryHistory, inventoryTransactions, itemSettings
    }));
  } catch (e) {}
}

async function loadProfile(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (error) { Store.profile = null; return null; }
  Store.profile = data;
  return data;
}

async function callAdminFn(payload) {
  const token = Store.session?.access_token;
  const res = await fetch(ADMIN_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ("요청 실패 (" + res.status + ")"));
  return json;
}
