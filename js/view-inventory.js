const INV_STATUS_LABEL = {
  reorder_urgent: { label: "긴급 재주문", cls: "tag-red" },
  reorder_soon: { label: "재주문 임박", cls: "tag-amber" },
  overstock: { label: "과잉 재고", cls: "tag-gray" },
  no_recent_sales: { label: "판매 없음", cls: "tag-gray" },
  normal: { label: "정상", cls: "tag-green" }
};

const INV_TABS = [
  { key: "status", label: "📋 현황" },
  { key: "tx", label: "📥 입출고 기록" },
  { key: "reorder", label: "🛒 발주 제안" },
  { key: "settings", label: "⚙ 품목 설정" }
];

function itemDatalist(inventory) {
  const names = [...new Set(inventory.map(i => i.item_name))].sort();
  return `<datalist id="invItemList">${names.map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist>`;
}

function renderInventory(container) {
  const inventory = Store.inventory;
  if (!inventory.length) {
    container.innerHTML = '<div class="empty-note">재고 데이터가 없습니다. 관리자에게 데이터 업로드를 요청해주세요.</div>';
    return;
  }
  const tab = AppState.invTab || "status";

  container.innerHTML = `
    <div class="page-lede">
      <div class="page-lede-eyebrow">WONMEDICO INVENTORY</div>
      <div class="page-lede-title">📦 재고 관리</div>
      <div class="page-lede-sub">현황 · 입출고 기록 · 발주 제안 · 품목별 재주문 설정</div>
    </div>
    <div class="pill-group" id="invTabbar" style="margin-bottom:16px">
      ${INV_TABS.map(t => `<button class="chip-btn" data-tab="${t.key}">${t.label}</button>`).join("")}
    </div>
    <div id="invTabBody"></div>
    ${itemDatalist(inventory)}
  `;

  container.querySelectorAll("#invTabbar .chip-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.addEventListener("click", () => { AppState.invTab = b.dataset.tab; renderInventory(container); });
  });

  const body = document.getElementById("invTabBody");
  if (tab === "status") renderInvStatusTab(body, inventory);
  else if (tab === "tx") renderInvTxTab(body, inventory);
  else if (tab === "reorder") renderInvReorderTab(body, inventory);
  else if (tab === "settings") renderInvSettingsTab(body, inventory);
}

// ==================== 현황 탭 ====================

function renderInvStatusTab(body, inventory) {
  const sales = Store.sales;
  const transactions = Store.inventoryTransactions;
  const effMap = computeEffectiveQtyMap(inventory, transactions);
  const kpi = computeInventoryKPIs(inventory, sales);
  const velocity = computeInventoryVelocity(inventory, sales, 90);
  const velocityMap = new Map(velocity.map(v => [v.item.item_name, v]));

  const snapshotDate = inventory[0]?.snapshot_date;
  const lines = [...new Set(inventory.map(r => r.line_category).filter(Boolean))].sort();
  const totalEff = [...effMap.values()].reduce((a, b) => a + b, 0);
  const recentTxCount = transactions.filter(t => t.tx_date >= isoDaysAgo(7)).length;

  body.innerHTML = `
    <div class="kpi-band">
      <div class="kpi-band-item">
        <div class="kpi-label">취급 품목수</div>
        <div class="kpi-value kpi-value-hero">${fmtNum(kpi.totalItems)}종</div>
        <div class="kpi-sub">실시간 총 재고 ${fmtNum(totalEff)}개</div>
      </div>
      <div class="kpi-band-item">
        <div class="kpi-label">추정 재고자산 가치</div>
        <div class="kpi-value">${fmtWon(kpi.valuation)}</div>
        <div class="kpi-sub">최근 90일 판매단가 기준 · ${kpi.valuedCount}/${kpi.totalItems}종 매칭</div>
      </div>
      <div class="kpi-band-item">
        <div class="kpi-label">유통기한 임박 (90일 이내)</div>
        <div class="kpi-value" style="${kpi.expiringSoon.length ? "color:var(--red)" : ""}">${kpi.expiringSoon.length}종</div>
        <div class="kpi-sub">${kpi.expired.length > 0 ? `⚠ 유통기한 경과 ${kpi.expired.length}종 포함` : "경과 품목 없음"}</div>
      </div>
      <div class="kpi-band-item">
        <div class="kpi-label">최근 7일 입출고 기록</div>
        <div class="kpi-value">${fmtNum(recentTxCount)}건</div>
        <div class="kpi-sub"><a href="#" id="invGotoTx" class="text-mute" style="text-decoration:underline">입출고 기록 보기 →</a></div>
      </div>
    </div>

    <div class="two-col" style="margin-top:14px">
      <div class="card card-pad">
        <div class="chart-card-title" style="margin-bottom:10px">창고별 재고 분포 <span class="text-faint" style="font-weight:400;font-size:11px">스냅샷 기준</span></div>
        <div class="chart-box sm"><canvas id="invWarehouseChart"></canvas></div>
      </div>
      <div class="card card-pad">
        <div class="chart-card-title" style="margin-bottom:10px">⚠ 우선 조치 필요 품목</div>
        <div id="invAlertList" style="max-height:210px;overflow-y:auto"></div>
      </div>
    </div>

    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>재고 상세 <span class="text-faint" style="font-weight:400;font-size:12px">스냅샷 기준일 ${snapshotDate || "-"} + 이후 입출고 반영한 실시간 수량</span></span>
      <button class="btn btn-primary btn-sm" id="invAddItemBtn">+ 새 품목 추가</button>
    </div>
    <div class="filter-bar">
      <div class="pill-group">
        <button class="chip-btn active" data-status="all">전체</button>
        <button class="chip-btn" data-status="reorder_urgent">긴급 재주문</button>
        <button class="chip-btn" data-status="reorder_soon">재주문 임박</button>
        <button class="chip-btn" data-status="overstock">과잉 재고</button>
        <button class="chip-btn" data-status="expiring">유통기한 임박</button>
      </div>
      <div class="filter-spacer"></div>
      <select id="invLineFilter"><option value="">전체 라인</option>${lines.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}</select>
      <input type="text" id="invSearch" class="search-input" placeholder="품목명 검색...">
      <button class="btn btn-ghost btn-sm" id="invExportBtn">⇩ CSV 내보내기</button>
    </div>
    <div class="card"><div class="table-wrap" id="invTableWrap"></div></div>
  `;

  renderStackedWarehouseBar("invWarehouseChart", [kpi.hq, kpi.saeseoul, kpi.daejeon]);
  renderAlertList(document.getElementById("invAlertList"), velocity, kpi);

  document.getElementById("invGotoTx").addEventListener("click", (e) => {
    e.preventDefault();
    AppState.invTab = "tx";
    renderInventory(document.getElementById("viewContainer"));
  });
  document.getElementById("invAddItemBtn").addEventListener("click", () => openAddItemModal(inventory));

  const state = { status: "all", line: "", search: "", sortKey: "eff_qty", sortDir: "desc" };
  const filterBar = body.querySelector(".filter-bar");
  filterBar.querySelectorAll(".chip-btn").forEach(b => {
    b.addEventListener("click", () => {
      filterBar.querySelectorAll(".chip-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.status = b.dataset.status;
      renderInvTable();
    });
  });
  document.getElementById("invLineFilter").addEventListener("change", (e) => { state.line = e.target.value; renderInvTable(); });
  document.getElementById("invSearch").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderInvTable(); });
  document.getElementById("invExportBtn").addEventListener("click", () => {
    exportCsv(`재고현황_${snapshotDate || "latest"}.csv`,
      ["라인", "품목", "실시간수량", "스냅샷수량", "본사", "새서울", "대전", "입고일", "유통기한", "생산수량", "90일판매", "소진예상일", "상태"],
      state.currentRows.map(r => {
        const v = velocityMap.get(r.item_name);
        const st = v ? INV_STATUS_LABEL[v.status] : INV_STATUS_LABEL.normal;
        return [r.line_category || "", r.item_name, effMap.get(r.item_name) ?? r.total_qty, r.total_qty, r.hq_qty, r.saeseoul_qty, r.daejeon_qty,
          r.received_date ? fmtDate(r.received_date) : "", r.expiry_date ? fmtDate(r.expiry_date) : "",
          r.production_qty, v ? v.soldQty90 : "", v && isFinite(v.daysOfStock) ? Math.round(v.daysOfStock) : "", st.label];
      }));
  });

  function renderInvTable() {
    let rows = inventory.slice();
    if (state.line) rows = rows.filter(r => r.line_category === state.line);
    if (state.search) rows = rows.filter(r => (r.item_name || "").toLowerCase().includes(state.search));
    if (state.status === "expiring") {
      rows = rows.filter(r => { const d = daysUntil(r.expiry_date); return d !== null && d <= 90; });
    } else if (state.status !== "all") {
      rows = rows.filter(r => velocityMap.get(r.item_name)?.status === state.status);
    }
    rows.sort((a, b) => {
      let av, bv;
      if (state.sortKey === "eff_qty") { av = effMap.get(a.item_name) ?? a.total_qty; bv = effMap.get(b.item_name) ?? b.total_qty; }
      else { av = a[state.sortKey]; bv = b[state.sortKey]; }
      const an = Number(av) || 0, bn = Number(bv) || 0;
      return state.sortDir === "asc" ? an - bn : bn - an;
    });
    state.currentRows = rows;
    renderInventoryTable(document.getElementById("invTableWrap"), rows, velocityMap, effMap, state, renderInvTable);
  }
  renderInvTable();
}

function renderAlertList(el, velocity, kpi) {
  const urgent = velocity.filter(v => v.status === "reorder_urgent").sort((a, b) => a.daysOfStock - b.daysOfStock);
  const expiring = kpi.expiringSoon.map(r => ({ item: r, days: daysUntil(r.expiry_date) })).sort((a, b) => a.days - b.days);
  const items = [];
  for (const v of urgent.slice(0, 4)) {
    items.push(`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f1f4;font-size:12.5px">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${escapeHtml(v.item.item_name)}</span>
      <span class="tag tag-red">잔여 ${Math.round(v.daysOfStock)}일분</span></div>`);
  }
  for (const e of expiring.slice(0, 4)) {
    items.push(`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f1f4;font-size:12.5px">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${escapeHtml(e.item.item_name)}</span>
      <span class="tag tag-amber">유통기한 D-${e.days}</span></div>`);
  }
  el.innerHTML = items.length ? items.join("") : '<div class="empty-note">현재 조치가 필요한 품목이 없습니다</div>';
}

function renderInventoryTable(wrap, rows, velocityMap, effMap, state, onSort) {
  if (!rows.length) { wrap.innerHTML = '<div class="empty-note">조건에 맞는 품목이 없습니다</div>'; return; }
  const th = (label, key) => `<th data-key="${key}">${label}${state.sortKey === key ? (state.sortDir === "asc" ? " ▲" : " ▼") : ""}</th>`;
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>라인</th><th>품목</th>
        ${th("실시간수량", "eff_qty")}${th("본사", "hq_qty")}${th("새서울", "saeseoul_qty")}${th("대전", "daejeon_qty")}
        <th>입고일</th><th>유통기한</th>${th("생산수량", "production_qty")}
        <th class="num">90일 판매</th><th class="num">소진예상</th><th>상태</th><th></th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const v = velocityMap.get(r.item_name);
        const st = v ? INV_STATUS_LABEL[v.status] : INV_STATUS_LABEL.normal;
        const expDays = daysUntil(r.expiry_date);
        let expLabel = r.expiry_date ? fmtDate(r.expiry_date) : "-";
        let expTag = "";
        if (expDays !== null) {
          if (expDays < 0) expTag = `<span class="tag tag-red" style="margin-left:6px">경과</span>`;
          else if (expDays <= 30) expTag = `<span class="tag tag-red" style="margin-left:6px">D-${expDays}</span>`;
          else if (expDays <= 90) expTag = `<span class="tag tag-amber" style="margin-left:6px">D-${expDays}</span>`;
        }
        const effQty = effMap.get(r.item_name) ?? r.total_qty;
        const drift = effQty - (Number(r.total_qty) || 0);
        return `<tr>
          <td>${escapeHtml(r.line_category || "-")}</td>
          <td style="white-space:normal;min-width:180px"><span class="clickable-row item-detail-link" data-item="${escapeHtml(r.item_name)}" style="text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px" title="클릭하면 관련 매출 내역을 볼 수 있어요">${escapeHtml(r.item_name)}</span></td>
          <td class="num">${fmtNum(effQty)}${drift !== 0 ? `<span class="text-faint" style="font-size:11px"> (${drift > 0 ? "+" : ""}${fmtNum(drift)})</span>` : ""}</td>
          <td class="num">${fmtNum(r.hq_qty)}</td>
          <td class="num">${fmtNum(r.saeseoul_qty)}</td>
          <td class="num">${fmtNum(r.daejeon_qty)}</td>
          <td>${r.received_date ? fmtDate(r.received_date) : "-"}</td>
          <td>${expLabel}${expTag}</td>
          <td class="num">${fmtNum(r.production_qty)}</td>
          <td class="num">${v ? fmtNum(v.soldQty90) : "-"}</td>
          <td class="num">${v && isFinite(v.daysOfStock) ? Math.round(v.daysOfStock) + "일" : (v && v.item.total_qty > 0 ? "∞" : "-")}</td>
          <td><span class="tag ${st.cls}">${st.label}</span></td>
          <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm quick-tx-btn" data-item="${escapeHtml(r.item_name)}">입출고+</button><button class="btn btn-ghost btn-sm edit-item-btn" data-item="${escapeHtml(r.item_name)}">수정</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  `;
  wrap.querySelectorAll("th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "desc"; }
      onSort();
    });
  });
  wrap.querySelectorAll(".quick-tx-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      AppState.invTab = "tx";
      AppState.invTxPrefillItem = btn.dataset.item;
      renderInventory(document.getElementById("viewContainer"));
    });
  });
  wrap.querySelectorAll(".edit-item-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = Store.inventory.find(i => i.item_name === btn.dataset.item);
      if (row) openAddItemModal(Store.inventory, row);
    });
  });
  wrap.querySelectorAll(".item-detail-link").forEach(el => {
    el.addEventListener("click", () => {
      const itemName = el.dataset.item;
      const matchMap = buildInventorySalesMatch(Store.sales, Store.inventory);
      const matchedNames = matchMap[itemName] || [];
      const detail = Store.sales.filter(r => matchedNames.includes(r.item_name));
      openSalesDetailModal(itemName, detail, { subtitle: detail.length ? "관련 매출 전체 기간 (품목명 자동 매칭)" : "매출 이력에서 자동 매칭되는 거래가 없습니다" });
    });
  });
}

function openAddItemModal(inventory, existing = null) {
  const isEdit = !!existing;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px">
      <div class="modal-title">${isEdit ? `품목 정보 수정 — ${escapeHtml(existing.item_name)}` : "새 품목 추가"}</div>
      ${isEdit ? '<div class="text-faint" style="font-size:12px;margin:-10px 0 12px">실사 결과에 맞게 창고별 수량 등을 직접 고칠 수 있습니다. 저장하면 스냅샷 기준값이 바로 갱신됩니다.</div>' : ""}
      <form id="addItemForm">
        <label class="modal-label">품목명 *<input type="text" id="aiName" required ${isEdit ? "readonly" : ""} value="${isEdit ? escapeHtml(existing.item_name) : ""}"></label>
        <label class="modal-label">라인/카테고리<input type="text" id="aiLine" value="${isEdit ? escapeHtml(existing.line_category || "") : ""}"></label>
        <div class="grid grid-3" style="margin-bottom:12px">
          <label class="modal-label">본사<input type="number" id="aiHq" value="${isEdit ? (existing.hq_qty ?? 0) : 0}"></label>
          <label class="modal-label">새서울<input type="number" id="aiSaeseoul" value="${isEdit ? (existing.saeseoul_qty ?? 0) : 0}"></label>
          <label class="modal-label">대전<input type="number" id="aiDaejeon" value="${isEdit ? (existing.daejeon_qty ?? 0) : 0}"></label>
        </div>
        <label class="modal-label">입고일<input type="date" id="aiReceived" value="${isEdit ? (existing.received_date || "") : ""}"></label>
        <label class="modal-label">유통기한<input type="date" id="aiExpiry" value="${isEdit ? (existing.expiry_date || "") : ""}"></label>
        <label class="modal-label">생산수량<input type="number" id="aiProduction" value="${isEdit ? (existing.production_qty ?? 0) : 0}"></label>
        <div class="modal-error" id="aiError"></div>
        <div class="modal-actions">
          ${isEdit ? '<button type="button" class="btn btn-ghost" id="aiDeleteBtn" style="margin-right:auto;color:var(--red)">품목 삭제</button>' : ""}
          <button type="button" class="btn btn-ghost" id="aiCancelBtn">취소</button>
          <button type="submit" class="btn btn-primary">${isEdit ? "저장" : "추가"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("aiCancelBtn").addEventListener("click", () => overlay.remove());
  document.getElementById("aiDeleteBtn")?.addEventListener("click", async () => {
    if (!confirm(`'${existing.item_name}' 품목을 재고 목록에서 삭제할까요? 관련 입출고 기록은 유지됩니다.`)) return;
    const { error } = await sb.from("inventory_current").delete().eq("item_name", existing.item_name);
    if (error) { toast(error.message, "error"); return; }
    overlay.remove();
    toast("품목이 삭제되었습니다.", "success");
    await loadAllData(true);
    renderInventory(document.getElementById("viewContainer"));
  });
  document.getElementById("addItemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("aiName").value.trim();
    const errEl = document.getElementById("aiError");
    if (!name) { errEl.textContent = "품목명을 입력해주세요."; return; }
    if (!isEdit && inventory.some(i => i.item_name === name)) { errEl.textContent = "이미 존재하는 품목명입니다."; return; }
    const hq = Number(document.getElementById("aiHq").value) || 0;
    const saeseoul = Number(document.getElementById("aiSaeseoul").value) || 0;
    const daejeon = Number(document.getElementById("aiDaejeon").value) || 0;
    const rec = {
      snapshot_date: isEdit ? existing.snapshot_date : (inventory[0]?.snapshot_date || fmtDate(new Date())),
      line_category: document.getElementById("aiLine").value.trim() || null,
      item_name: name,
      total_qty: hq + saeseoul + daejeon,
      hq_qty: hq, saeseoul_qty: saeseoul, daejeon_qty: daejeon, shipped_qty: isEdit ? (existing.shipped_qty ?? 0) : 0,
      received_date: document.getElementById("aiReceived").value || null,
      expiry_date: document.getElementById("aiExpiry").value || null,
      production_qty: Number(document.getElementById("aiProduction").value) || null
    };
    const { error } = await sb.from("inventory_current").upsert([rec], { onConflict: "item_name" });
    if (error) { errEl.textContent = error.message; return; }
    overlay.remove();
    toast(isEdit ? "품목 정보가 수정되었습니다." : "품목이 추가되었습니다.", "success");
    await loadAllData(true);
    renderInventory(document.getElementById("viewContainer"));
  });
}

// ==================== 입출고 기록 탭 ====================

function renderInvTxTab(body, inventory) {
  const transactions = Store.inventoryTransactions.slice().sort((a, b) => (b.tx_date + b.id).localeCompare(a.tx_date + a.id));
  const prefill = AppState.invTxPrefillItem || "";
  AppState.invTxPrefillItem = null;

  body.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px">
      <div class="chart-card-title" style="margin-bottom:12px">입출고 기록 추가</div>
      <form id="txForm" class="admin-form admin-form-tx">
        <label>품목명 *<input type="text" id="txItem" list="invItemList" required value="${escapeHtml(prefill)}"></label>
        <label>유형 *<select id="txType">${TX_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}</select></label>
        <label>수량 *<input type="number" id="txQty" min="0.01" step="any" required></label>
        <label>창고<select id="txWarehouse"><option value="">-</option><option>본사</option><option>새서울</option><option>대전</option><option>기타</option></select></label>
        <button type="submit" class="btn btn-primary">기록 추가</button>
      </form>
      <div class="grid grid-2" style="margin-top:10px">
        <label class="modal-label">날짜<input type="date" id="txDate" value="${fmtDate(new Date())}"></label>
        <label class="modal-label">메모<input type="text" id="txNote" placeholder="선택 입력"></label>
      </div>
      <div class="modal-error" id="txError"></div>
    </div>

    <div class="filter-bar">
      <select id="txFilterType"><option value="">전체 유형</option>${TX_TYPES.map(t => `<option>${t}</option>`).join("")}</select>
      <input type="text" id="txFilterItem" class="search-input" placeholder="품목명 검색...">
      <div class="filter-spacer"></div>
      <span class="text-faint" style="font-size:12px">총 ${fmtNum(transactions.length)}건</span>
    </div>
    <div class="card"><div class="table-wrap" id="txTableWrap"></div></div>
  `;

  document.getElementById("txForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("txError");
    errEl.textContent = "";
    const item_name = document.getElementById("txItem").value.trim();
    const tx_type = document.getElementById("txType").value;
    const qty = Number(document.getElementById("txQty").value);
    const warehouse = document.getElementById("txWarehouse").value || null;
    const tx_date = document.getElementById("txDate").value || fmtDate(new Date());
    const note = document.getElementById("txNote").value.trim() || null;
    if (!item_name || !qty || qty <= 0) { errEl.textContent = "품목명과 수량(0보다 큰 값)을 입력해주세요."; return; }
    const rec = {
      item_name, tx_type, qty, warehouse, tx_date, note,
      created_by: Store.session.user.id, created_by_email: Store.session.user.email
    };
    const { error } = await sb.from("inventory_transactions").insert([rec]);
    if (error) { errEl.textContent = error.message; return; }
    toast("입출고 기록이 추가되었습니다.", "success");
    await loadAllData(true);
    renderInventory(document.getElementById("viewContainer"));
  });

  const state = { type: "", search: "" };
  document.getElementById("txFilterType").addEventListener("change", (e) => { state.type = e.target.value; renderTxTable(); });
  document.getElementById("txFilterItem").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderTxTable(); });

  function renderTxTable() {
    let rows = transactions;
    if (state.type) rows = rows.filter(t => t.tx_type === state.type);
    if (state.search) rows = rows.filter(t => t.item_name.toLowerCase().includes(state.search));
    const wrap = document.getElementById("txTableWrap");
    if (!rows.length) { wrap.innerHTML = '<div class="empty-note">기록이 없습니다. 위 양식으로 첫 입출고를 기록해보세요.</div>'; return; }
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>날짜</th><th>품목</th><th>유형</th><th class="num">수량</th><th>창고</th><th>메모</th><th>작성자</th><th></th></tr></thead>
        <tbody>${rows.slice(0, 300).map(t => {
          const sign = TX_TYPE_SIGN[t.tx_type] > 0 ? "tag-green" : "tag-red";
          const canDelete = Store.profile?.is_admin || t.created_by === Store.session.user.id;
          return `<tr>
            <td>${t.tx_date}</td>
            <td style="white-space:normal;min-width:160px">${escapeHtml(t.item_name)}</td>
            <td><span class="tag ${sign}">${t.tx_type}</span></td>
            <td class="num">${fmtNum(t.qty)}</td>
            <td>${escapeHtml(t.warehouse || "-")}</td>
            <td class="text-mute">${escapeHtml(t.note || "-")}</td>
            <td class="text-faint">${escapeHtml((t.created_by_email || "").split("@")[0])}</td>
            <td>${canDelete ? `<button class="btn btn-ghost btn-sm del-tx-btn" data-id="${t.id}">삭제</button>` : ""}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    `;
    wrap.querySelectorAll(".del-tx-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 기록을 삭제할까요?")) return;
        const { error } = await sb.from("inventory_transactions").delete().eq("id", btn.dataset.id);
        if (error) { toast(error.message, "error"); return; }
        await loadAllData(true);
        renderInventory(document.getElementById("viewContainer"));
      });
    });
  }
  renderTxTable();
}

// ==================== 발주 제안 탭 ====================

function renderInvReorderTab(body, inventory) {
  const sales = Store.sales;
  const transactions = Store.inventoryTransactions;
  const effMap = computeEffectiveQtyMap(inventory, transactions);
  const settingsMap = getItemSettingsMap(Store.itemSettings);
  const velocity = computeInventoryVelocity(inventory, sales, 90);
  const suggestions = computeReorderSuggestions(inventory, effMap, settingsMap, velocity);

  body.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="chart-card-title">발주가 필요한 품목 ${suggestions.length}종</div>
          <div class="text-faint" style="font-size:12px;margin-top:4px">품목 설정에 재주문점을 지정하면 그 값을 우선 사용하고, 없으면 최근 90일 판매 속도로 자동 계산합니다.</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="reorderExportBtn">⇩ CSV 내보내기</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="reorderTableWrap"></div></div>
  `;

  const wrap = document.getElementById("reorderTableWrap");
  if (!suggestions.length) {
    wrap.innerHTML = '<div class="empty-note">현재 발주가 필요한 품목이 없습니다.</div>';
  } else {
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th></th><th>품목</th><th class="num">현재 재고</th><th class="num">재주문점</th><th class="num">목표재고</th><th class="num">제안 발주량</th><th>기준</th></tr></thead>
        <tbody>${suggestions.map(s => `
          <tr>
            <td>${s.urgent ? '<span class="tag tag-red">긴급</span>' : '<span class="tag tag-amber">주의</span>'}</td>
            <td style="white-space:normal;min-width:180px">${escapeHtml(s.item.item_name)}</td>
            <td class="num">${fmtNum(s.effectiveQty)}</td>
            <td class="num">${fmtNum(s.reorderPoint)}</td>
            <td class="num">${fmtNum(s.targetStock)}</td>
            <td class="num" style="font-weight:700">${fmtNum(s.suggestedOrderQty)}</td>
            <td class="text-faint">${s.basis}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    `;
  }
  document.getElementById("reorderExportBtn").addEventListener("click", () => {
    exportCsv("발주제안.csv", ["긴급여부", "품목", "현재재고", "재주문점", "목표재고", "제안발주량", "기준"],
      suggestions.map(s => [s.urgent ? "긴급" : "주의", s.item.item_name, s.effectiveQty, s.reorderPoint, s.targetStock, s.suggestedOrderQty, s.basis]));
  });
}

// ==================== 품목 설정 탭 ====================

function renderInvSettingsTab(body, inventory) {
  const settingsMap = getItemSettingsMap(Store.itemSettings);
  body.innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="chart-card-title">품목별 재주문 설정</div>
      <div class="text-faint" style="font-size:12px;margin-top:4px">안전재고 · 재주문점 · 목표재고 · 단가 · 공급처 · 리드타임을 직접 설정할 수 있습니다. 값을 입력하고 저장을 누르면 발주 제안 계산에 바로 반영됩니다.</div>
    </div>
    <div class="filter-bar">
      <input type="text" id="setSearch" class="search-input" placeholder="품목명 검색...">
    </div>
    <div class="card"><div class="table-wrap" id="setTableWrap"></div></div>
  `;
  const state = { search: "" };
  document.getElementById("setSearch").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderSetTable(); });

  function renderSetTable() {
    let rows = inventory.slice();
    if (state.search) rows = rows.filter(r => r.item_name.toLowerCase().includes(state.search));
    rows.sort((a, b) => a.item_name.localeCompare(b.item_name));
    const wrap = document.getElementById("setTableWrap");
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>품목</th><th class="num">안전재고</th><th class="num">재주문점</th><th class="num">목표재고</th>
          <th class="num">단가(원)</th><th>공급처</th><th class="num">리드타임(일)</th><th></th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const s = settingsMap.get(r.item_name) || {};
          const id = r.item_name.replace(/[^a-zA-Z0-9가-힣]/g, "_");
          return `<tr data-item="${escapeHtml(r.item_name)}">
            <td style="white-space:normal;min-width:180px">${escapeHtml(r.item_name)}</td>
            <td class="num"><input type="number" class="set-input" data-field="safety_stock" value="${s.safety_stock ?? ""}" style="width:80px"></td>
            <td class="num"><input type="number" class="set-input" data-field="reorder_point" value="${s.reorder_point ?? ""}" style="width:80px"></td>
            <td class="num"><input type="number" class="set-input" data-field="target_stock" value="${s.target_stock ?? ""}" style="width:80px"></td>
            <td class="num"><input type="number" class="set-input" data-field="unit_cost" value="${s.unit_cost ?? ""}" style="width:90px"></td>
            <td><input type="text" class="set-input" data-field="supplier" value="${escapeHtml(s.supplier || "")}" style="width:100px"></td>
            <td class="num"><input type="number" class="set-input" data-field="lead_time_days" value="${s.lead_time_days ?? ""}" style="width:70px"></td>
            <td><button class="btn btn-primary btn-sm save-set-btn">저장</button></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    `;
    wrap.querySelectorAll(".save-set-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const item_name = tr.dataset.item;
        const rec = { item_name, updated_at: new Date().toISOString(), updated_by: Store.session.user.id };
        tr.querySelectorAll(".set-input").forEach(inp => {
          const v = inp.value.trim();
          rec[inp.dataset.field] = v === "" ? null : (inp.type === "number" ? Number(v) : v);
        });
        btn.disabled = true; btn.textContent = "저장 중...";
        const { error } = await sb.from("item_settings").upsert([rec], { onConflict: "item_name" });
        if (error) { toast(error.message, "error"); btn.disabled = false; btn.textContent = "저장"; return; }
        await loadAllData(true);
        toast(`${item_name} 설정이 저장되었습니다.`, "success");
        btn.disabled = false; btn.textContent = "저장";
      });
    });
  }
  renderSetTable();
}
