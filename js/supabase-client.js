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
