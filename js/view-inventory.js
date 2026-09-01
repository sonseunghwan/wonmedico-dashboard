const INV_STATUS_LABEL = {
  reorder_urgent: { label: "긴급 재주문", cls: "tag-red" },
  reorder_soon: { label: "재주문 임박", cls: "tag-amber" },
  overstock: { label: "과잉 재고", cls: "tag-gray" },
  no_recent_sales: { label: "판매 없음", cls: "tag-gray" },
  normal: { label: "정상", cls: "tag-green" }
};

function renderInventory(container) {
  const inventory = Store.inventory;
  if (!inventory.length) {
    container.innerHTML = '<div class="empty-note">재고 데이터가 없습니다. 관리자에게 데이터 업로드를 요청해주세요.</div>';
    return;
  }
  const sales = Store.sales;
  const kpi = computeInventoryKPIs(inventory, sales);
  const velocity = computeInventoryVelocity(inventory, sales, 90);
  const velocityMap = new Map(velocity.map(v => [v.item.item_name, v]));

  const snapshotDate = inventory[0]?.snapshot_date;
  const lines = [...new Set(inventory.map(r => r.line_category).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="page-lede">
      <div class="page-lede-eyebrow">WONMEDICO INVENTORY</div>
      <div class="page-lede-title">재고현황</div>
      <div class="page-lede-sub">창고별 재고 · 유통기한 · 판매 속도 기반 재주문 알림</div>
    </div>

    <div class="grid grid-4">
      <div class="card kpi-card">
        <div class="kpi-label">취급 품목수</div>
        <div class="kpi-value">${fmtNum(kpi.totalItems)}종</div>
        <div class="kpi-sub">총 재고 ${fmtNum(kpi.totalQty)}개</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-label">추정 재고자산 가치</div>
        <div class="kpi-value">${fmtWon(kpi.valuation)}</div>
        <div class="kpi-sub">최근 90일 판매단가 기준 · ${kpi.valuedCount}/${kpi.totalItems}종 매칭</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-label">유통기한 임박 (90일 이내)</div>
        <div class="kpi-value" style="${kpi.expiringSoon.length ? "color:var(--red)" : ""}">${kpi.expiringSoon.length}종</div>
        <div class="kpi-sub">${kpi.expired.length > 0 ? `⚠ 유통기한 경과 ${kpi.expired.length}종 포함` : "경과 품목 없음"}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-label">재주문 필요</div>
        <div class="kpi-value" style="${velocity.filter(v => v.status === "reorder_urgent").length ? "color:var(--red)" : ""}">${velocity.filter(v => v.status === "reorder_urgent" || v.status === "reorder_soon").length}종</div>
        <div class="kpi-sub">최근 90일 판매 속도 기준 소진 임박</div>
      </div>
    </div>

    <div class="two-col" style="margin-top:14px">
      <div class="card card-pad">
        <div class="chart-card-title" style="margin-bottom:10px">창고별 재고 분포</div>
        <div class="chart-box sm"><canvas id="invWarehouseChart"></canvas></div>
      </div>
      <div class="card card-pad">
        <div class="chart-card-title" style="margin-bottom:10px">⚠ 우선 조치 필요 품목</div>
        <div id="invAlertList" style="max-height:210px;overflow-y:auto"></div>
      </div>
    </div>

    <div class="section-title">재고 상세 <span class="text-faint" style="font-weight:400;font-size:12px">기준일 ${snapshotDate || "-"}</span></div>
    <div class="filter-bar">
      <button class="chip-btn active" data-status="all">전체</button>
      <button class="chip-btn" data-status="reorder_urgent">긴급 재주문</button>
      <button class="chip-btn" data-status="reorder_soon">재주문 임박</button>
      <button class="chip-btn" data-status="overstock">과잉 재고</button>
      <button class="chip-btn" data-status="expiring">유통기한 임박</button>
      <div class="filter-spacer"></div>
      <select id="invLineFilter"><option value="">전체 라인</option>${lines.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}</select>
      <input type="text" id="invSearch" class="search-input" placeholder="품목명 검색...">
      <button class="btn btn-ghost btn-sm" id="invExportBtn">⇩ CSV 내보내기</button>
    </div>
    <div class="card"><div class="table-wrap" id="invTableWrap"></div></div>
  `;

  renderStackedWarehouseBar("invWarehouseChart", [kpi.hq, kpi.saeseoul, kpi.daejeon]);
  renderAlertList(document.getElementById("invAlertList"), velocity, kpi);

  const state = { status: "all", line: "", search: "", sortKey: "total_qty", sortDir: "desc" };

  const filterBar = container.querySelector(".filter-bar");
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
      ["라인", "품목", "총수량", "본사", "새서울", "대전", "입고일", "유통기한", "생산수량", "90일판매", "소진예상일", "상태"],
      state.currentRows.map(r => {
        const v = velocityMap.get(r.item_name);
        const st = v ? INV_STATUS_LABEL[v.status] : INV_STATUS_LABEL.normal;
        return [r.line_category || "", r.item_name, r.total_qty, r.hq_qty, r.saeseoul_qty, r.daejeon_qty,
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
      const av = a[state.sortKey], bv = b[state.sortKey];
      const an = Number(av) || 0, bn = Number(bv) || 0;
      return state.sortDir === "asc" ? an - bn : bn - an;
    });
    state.currentRows = rows;
    renderInventoryTable(document.getElementById("invTableWrap"), rows, velocityMap, state, renderInvTable);
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

function renderInventoryTable(wrap, rows, velocityMap, state, onSort) {
  if (!rows.length) { wrap.innerHTML = '<div class="empty-note">조건에 맞는 품목이 없습니다</div>'; return; }
  const th = (label, key) => `<th data-key="${key}">${label}${state.sortKey === key ? (state.sortDir === "asc" ? " ▲" : " ▼") : ""}</th>`;
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>라인</th><th>품목</th>
        ${th("총수량", "total_qty")}${th("본사", "hq_qty")}${th("새서울", "saeseoul_qty")}${th("대전", "daejeon_qty")}
        <th>입고일</th><th>유통기한</th>${th("생산수량", "production_qty")}
        <th class="num">90일 판매</th><th class="num">소진예상</th><th>상태</th>
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
        return `<tr>
          <td>${escapeHtml(r.line_category || "-")}</td>
          <td style="white-space:normal;min-width:180px">${escapeHtml(r.item_name)}</td>
          <td class="num">${fmtNum(r.total_qty)}</td>
          <td class="num">${fmtNum(r.hq_qty)}</td>
          <td class="num">${fmtNum(r.saeseoul_qty)}</td>
          <td class="num">${fmtNum(r.daejeon_qty)}</td>
          <td>${r.received_date ? fmtDate(r.received_date) : "-"}</td>
          <td>${expLabel}${expTag}</td>
          <td class="num">${fmtNum(r.production_qty)}</td>
          <td class="num">${v ? fmtNum(v.soldQty90) : "-"}</td>
          <td class="num">${v && isFinite(v.daysOfStock) ? Math.round(v.daysOfStock) + "일" : (v && v.item.total_qty > 0 ? "∞" : "-")}</td>
          <td><span class="tag ${st.cls}">${st.label}</span></td>
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
}
