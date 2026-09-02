function renderSales(container) {
  const sales = Store.sales;
  if (!sales.length) {
    container.innerHTML = '<div class="empty-note">매출 데이터가 없습니다.</div>';
    return;
  }
  const range = AppState.salesRange || defaultYearRange();
  AppState.salesRange = range;
  const tab = AppState.salesTab || "product";

  container.innerHTML = `
    <div class="page-lede">
      <div>
        <div class="page-lede-eyebrow">WONMEDICO SALES</div>
        <div class="page-lede-title">🔍 매출 분석 심층</div>
        <div class="page-lede-sub">제품별 랭킹 · 거래처별 · 담당자별 · 급성장/급감 품목</div>
      </div>
      <div class="page-lede-meta">기준일 ${latestDataDate().toISOString().slice(0, 10)}</div>
    </div>

    <div class="filter-bar" id="saFilterBar">
      <span class="text-mute" style="font-size:12.5px;font-weight:600">📅 조회 기간</span>
      ${buildYearMonthPicker("saStart", range.start)}
      <span class="text-faint">~</span>
      ${buildYearMonthPicker("saEnd", range.end)}
      <div class="pill-group">
        <button class="chip-btn" data-preset="thisYear">올해</button>
        <button class="chip-btn" data-preset="lastYear">작년</button>
        <button class="chip-btn" data-preset="last12m">최근 12개월</button>
        <button class="chip-btn" data-preset="all">전체 기간</button>
      </div>
    </div>

    <div class="section-title">최근 12개월 매출 추이</div>
    <div class="card chart-card">
      <div class="chart-box sm"><canvas id="saTrendChart"></canvas></div>
    </div>

    <div class="section-title">분기별 실적 <span class="text-faint" style="font-weight:400;font-size:12px">선택 기간의 종료연도 기준</span></div>
    <div class="card"><div class="table-wrap" id="saQuarterWrap"></div></div>

    <div class="section-title">기간 내 급성장 / 급감 품목 <span class="text-faint" style="font-weight:400;font-size:12px">전년 동기 대비, 매출 500만원 이상 품목</span></div>
    <div class="two-col" id="saMovers"></div>

    <div class="section-title" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div class="pill-group" id="saTabbar">
        <button class="chip-btn" data-tab="product">📦 제품별</button>
        <button class="chip-btn" data-tab="customer">🏢 거래처별</button>
        <button class="chip-btn" data-tab="manager">🧑 담당자별</button>
      </div>
      <input type="text" id="saSearch" class="search-input" placeholder="검색...">
      <div class="filter-spacer"></div>
      <span class="text-faint" style="font-size:11.5px">행을 클릭하면 상세 거래내역을 볼 수 있어요</span>
      <button class="btn btn-ghost btn-sm" id="saExportBtn">⇩ CSV 내보내기</button>
    </div>
    <div class="card"><div class="table-wrap" id="saTableWrap"></div></div>
  `;

  wireRangeControls(container, range, (r) => { AppState.salesRange = r; renderSales(container); }, "sa");

  container.querySelectorAll("#saTabbar .chip-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.addEventListener("click", () => { AppState.salesTab = b.dataset.tab; renderSales(container); });
  });

  renderTrendLine("saTrendChart", computeLast12MonthsTrend(sales, range.end), { label: "월 매출" });
  renderQuarterlyTable(document.getElementById("saQuarterWrap"), sales, parseInt(range.end.slice(0, 4), 10));

  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const ranking = computeProductRanking(sales, range, prevRange);
  renderMovers(document.getElementById("saMovers"), ranking, sales, range);

  const searchEl = document.getElementById("saSearch");
  let searchTerm = AppState.salesSearch || "";
  searchEl.value = searchTerm;
  searchEl.addEventListener("input", (e) => {
    AppState.salesSearch = e.target.value;
    renderSalesTable(tab, sales, range, prevRange, e.target.value);
  });

  renderSalesTable(tab, sales, range, prevRange, searchTerm);

  document.getElementById("saExportBtn").addEventListener("click", () => {
    exportSalesTableCsv(AppState.salesTab || "product", sales, range, prevRange, AppState.salesSearch || "");
  });
}

function renderQuarterlyTable(el, sales, year) {
  const quarters = computeQuarterlyBreakdown(sales, year);
  const totalCur = quarters.reduce((a, q) => a + q.revenue, 0);
  const totalPrev = quarters.reduce((a, q) => a + q.prevRevenue, 0);
  const totalCurQty = quarters.reduce((a, q) => a + q.qty, 0);
  const totalPrevQty = quarters.reduce((a, q) => a + q.prevQty, 0);
  const expanded = AppState.saQuarterExpanded || (AppState.saQuarterExpanded = new Set());

  const monthRow = (m) => `
    <tr class="quarter-month-row">
      <td class="text-faint" style="padding-left:30px">${m.month}월</td>
      <td class="num text-faint">${fmtWon(m.prevRevenue)}</td>
      <td class="num text-faint">${fmtNum(m.prevQty)}개</td>
      <td class="num text-faint">${fmtWon(m.revenue)}</td>
      <td class="num text-faint">${fmtNum(m.qty)}개</td>
      <td class="num">${deltaTag(m.growth)}</td>
    </tr>`;

  el.innerHTML = `
    <table class="data-table quarterly-table">
      <thead>
        <tr>
          <th rowspan="2">분기</th>
          <th colspan="2" style="text-align:center;border-left:1px solid var(--border)">작년</th>
          <th colspan="2" style="text-align:center;border-left:1px solid var(--border)">올해</th>
          <th rowspan="2" class="num" style="border-left:1px solid var(--border)">증감</th>
        </tr>
        <tr>
          <th class="num" style="border-left:1px solid var(--border)">금액</th><th class="num">수량</th>
          <th class="num" style="border-left:1px solid var(--border)">금액</th><th class="num">수량</th>
        </tr>
      </thead>
      <tbody>
        ${quarters.map(q => {
          const isOpen = expanded.has(q.q);
          const months = [1, 2, 3].map(offset => computeMonthSnapshot(sales, year, (q.q - 1) * 3 + offset));
          return `
            <tr class="quarter-row clickable-row" data-q="${q.q}">
              <td><span class="text-faint" style="display:inline-block;width:12px">${isOpen ? "▾" : "▸"}</span>${q.label}</td>
              <td class="num text-faint" style="border-left:1px solid var(--border)">${fmtWon(q.prevRevenue)}</td>
              <td class="num text-faint">${fmtNum(q.prevQty)}개</td>
              <td class="num" style="font-weight:700;border-left:1px solid var(--border)">${fmtWon(q.revenue)}</td>
              <td class="num" style="font-weight:700">${fmtNum(q.qty)}개</td>
              <td class="num" style="border-left:1px solid var(--border)">${deltaTag(q.growth)}</td>
            </tr>
            ${isOpen ? months.map(monthRow).join("") : ""}
          `;
        }).join("")}
        <tr style="background:#fafbfd">
          <td style="font-weight:700">합계</td>
          <td class="num text-faint" style="border-left:1px solid var(--border)">${fmtWon(totalPrev)}</td>
          <td class="num text-faint">${fmtNum(totalPrevQty)}개</td>
          <td class="num" style="font-weight:800;border-left:1px solid var(--border)">${fmtWon(totalCur)}</td>
          <td class="num" style="font-weight:800">${fmtNum(totalCurQty)}개</td>
          <td class="num" style="border-left:1px solid var(--border)">${deltaTag(totalPrev > 0 ? ((totalCur - totalPrev) / totalPrev) * 100 : null)}</td>
        </tr>
      </tbody>
    </table>
  `;
  el.querySelectorAll(".quarter-row").forEach(tr => {
    tr.addEventListener("click", () => {
      const q = parseInt(tr.dataset.q, 10);
      if (expanded.has(q)) expanded.delete(q); else expanded.add(q);
      renderQuarterlyTable(el, sales, year);
    });
  });
}

function exportSalesTableCsv(tab, sales, range, prevRange, term) {
  term = (term || "").trim().toLowerCase();
  if (tab === "product") {
    let rows = computeProductRanking(sales, range, prevRange);
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    exportCsv(`매출_제품별_${range.start}_${range.end}.csv`,
      ["순위", "품목", "올해매출", "작년매출", "매출증감(%)", "비중(%)", "올해수량", "작년수량", "수량증감(%)", "평균단가"],
      rows.map(r => [r.rank, r.key, Math.round(r.revenue), Math.round(r.prevRevenue), r.growth === null ? "" : r.growth.toFixed(1), r.share.toFixed(1), r.qty, r.prevQty, r.qtyGrowth === null ? "" : r.qtyGrowth.toFixed(1), Math.round(r.avgPrice)]));
  } else if (tab === "customer") {
    let rows = computeCustomerAnalysis(sales, range, prevRange).ranking;
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    exportCsv(`매출_거래처별_${range.start}_${range.end}.csv`,
      ["순위", "거래처", "올해매출", "작년매출", "매출증감(%)", "비중(%)", "거래건수", "건당평균"],
      rows.map(r => [r.rank, r.key, Math.round(r.revenue), Math.round(r.prevRevenue), r.growth === null ? "" : r.growth.toFixed(1), r.share.toFixed(1), r.count, Math.round(r.count > 0 ? r.revenue / r.count : 0)]));
  } else {
    let rows = computeManagerPerformance(sales, range, prevRange);
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    exportCsv(`매출_담당자별_${range.start}_${range.end}.csv`,
      ["순위", "담당자", "올해매출", "작년매출", "매출증감(%)", "비중(%)", "거래건수", "건당평균"],
      rows.map(r => [r.rank, r.key, Math.round(r.revenue), Math.round(r.prevRevenue), r.growth === null ? "" : r.growth.toFixed(1), r.share.toFixed(1), r.count, Math.round(r.avgDeal)]));
  }
}

function renderMovers(el, ranking, sales, range) {
  const eligible = ranking.filter(r => r.revenue >= 5000000 && r.growth !== null);
  const gainers = [...eligible].filter(r => r.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 5);
  const losers = [...eligible].filter(r => r.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, 5);
  const row = (r) => `
    <div class="clickable-row mover-row" data-item="${escapeHtml(r.key)}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid #f0f1f4;border-radius:6px">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px">${escapeHtml(r.key)}</div>
        <div class="text-faint" style="font-size:11.5px">${fmtWon(r.revenue)}</div>
      </div>
      ${deltaTag(r.growth)}
    </div>`;
  el.innerHTML = `
    <div class="card card-pad">
      <div class="chart-card-title" style="margin-bottom:8px">🚀 급성장 TOP5</div>
      ${gainers.length ? gainers.map(row).join("") : '<div class="empty-note">데이터 부족</div>'}
    </div>
    <div class="card card-pad">
      <div class="chart-card-title" style="margin-bottom:8px">⚠ 급감 TOP5 (주의 필요)</div>
      ${losers.length ? losers.map(row).join("") : '<div class="empty-note">데이터 부족</div>'}
    </div>
  `;
  el.querySelectorAll(".mover-row").forEach(row => {
    row.addEventListener("click", () => {
      const item = row.dataset.item;
      const rows = filterByRange(sales, range.start, range.end).filter(r => r.item_name === item);
      openSalesDetailModal(item, rows, { subtitle: `${range.start} ~ ${range.end}` });
    });
  });
}

function renderSalesTable(tab, sales, range, prevRange, search) {
  const wrap = document.getElementById("saTableWrap");
  if (!wrap) return;
  const term = (search || "").trim().toLowerCase();

  if (tab === "product") {
    let rows = computeProductRanking(sales, range, prevRange);
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>순위</th><th>품목</th><th title="누적매출 80%=A, 95%=B, 나머지=C">등급</th>
          <th class="num">올해 매출</th><th class="num">작년 매출</th><th class="num">매출 증감</th><th class="num">비중</th><th class="num">누적비중</th>
          <th class="num">올해 수량</th><th class="num">작년 수량</th><th class="num">수량 증감</th><th class="num">평균단가</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr class="clickable-row" data-item="${escapeHtml(r.key)}">
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td><span class="tag ${ABC_CLASS_TAG[computeABCClass(r.cumShare)]}">${computeABCClass(r.cumShare)}</span></td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num text-faint">${fmtWon(r.prevRevenue)}</td>
            <td class="num">${deltaTag(r.growth)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}<div class="row-bar-track"><div class="row-bar-fill" style="width:${Math.min(r.share, 100)}%"></div></div></td>
            <td class="num text-faint">${fmtPct(r.cumShare, { digits: 0 })}</td>
            <td class="num">${fmtNum(r.qty)}개</td>
            <td class="num text-faint">${fmtNum(r.prevQty)}개</td>
            <td class="num">${deltaTag(r.qtyGrowth)}</td>
            <td class="num">${fmtWon(r.avgPrice)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div id="saLostProducts"></div>`;
    wrap.querySelectorAll("tr.clickable-row").forEach(tr => {
      tr.addEventListener("click", () => {
        const item = tr.dataset.item;
        const detail = filterByRange(sales, range.start, range.end).filter(r => r.item_name === item);
        openSalesDetailModal(item, detail, { subtitle: `${range.start} ~ ${range.end}` });
      });
    });
    if (!term) {
      const lost = computeLostProducts(sales, range, prevRange);
      if (lost.length) {
        document.getElementById("saLostProducts").innerHTML = `
          <div class="lost-products-note">
            ⚠ <b>전년 동기엔 있었으나 이번 기간엔 실적이 없는 품목 (${lost.length}개)</b> —
            ${lost.slice(0, 10).map(l => `${escapeHtml(l.key)} 전년 ${fmtWon(l.revenue)}`).join(" · ")}${lost.length > 10 ? ` 외 ${lost.length - 10}개` : ""}
          </div>`;
      }
    }
  } else if (tab === "customer") {
    let cust = computeCustomerAnalysis(sales, range, prevRange);
    let rows = cust.ranking;
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    const lastPurchaseMap = computeCustomerLastPurchase(sales);
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>순위</th><th>거래처</th><th class="num">올해 매출</th><th class="num">작년 매출</th><th class="num">증감</th><th class="num">비중</th><th class="num">거래건수</th><th class="num">건당 평균</th><th>최근 구매일</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr class="clickable-row" data-item="${escapeHtml(r.key)}">
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num text-faint">${fmtWon(r.prevRevenue)}</td>
            <td class="num">${deltaTag(r.growth)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}<div class="row-bar-track"><div class="row-bar-fill" style="width:${Math.min(r.share, 100)}%"></div></div></td>
            <td class="num">${fmtNum(r.count)}</td>
            <td class="num">${fmtWon(r.count > 0 ? r.revenue / r.count : 0)}</td>
            <td class="text-faint">${lastPurchaseMap.get(r.key) || "-"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    wrap.querySelectorAll("tr.clickable-row").forEach(tr => {
      tr.addEventListener("click", () => {
        const cust2 = tr.dataset.item;
        const detail = filterByRange(sales, range.start, range.end).filter(r => (r.customer || "(미지정)") === cust2);
        openSalesDetailModal(cust2, detail, { subtitle: `${range.start} ~ ${range.end}` });
      });
    });
  } else {
    let rows = computeManagerPerformance(sales, range, prevRange);
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>순위</th><th>담당자</th><th class="num">올해 매출</th><th class="num">작년 매출</th><th class="num">증감</th><th class="num">비중</th><th class="num">거래건수</th><th class="num">건당 평균</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr class="clickable-row" data-item="${escapeHtml(r.key)}">
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num text-faint">${fmtWon(r.prevRevenue)}</td>
            <td class="num">${deltaTag(r.growth)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}<div class="row-bar-track"><div class="row-bar-fill" style="width:${Math.min(r.share, 100)}%"></div></div></td>
            <td class="num">${fmtNum(r.count)}</td>
            <td class="num">${fmtWon(r.avgDeal)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    wrap.querySelectorAll("tr.clickable-row").forEach(tr => {
      tr.addEventListener("click", () => {
        const mgr = tr.dataset.item;
        const detail = filterByRange(sales, range.start, range.end).filter(r => (r.manager || "(미지정)") === mgr);
        openSalesDetailModal(mgr, detail, { subtitle: `${range.start} ~ ${range.end}` });
      });
    });
  }
}
