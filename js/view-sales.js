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
    <div class="filter-bar" id="saFilterBar">
      <button class="chip-btn" data-preset="thisYear">올해</button>
      <button class="chip-btn" data-preset="lastYear">작년</button>
      <button class="chip-btn" data-preset="last12m">최근 12개월</button>
      <button class="chip-btn" data-preset="all">전체 기간</button>
      <div class="filter-spacer"></div>
      <input type="date" id="saStart" value="${range.start}">
      <span class="text-faint">~</span>
      <input type="date" id="saEnd" value="${range.end}">
    </div>

    <div class="section-title">최근 12개월 매출 추이</div>
    <div class="card chart-card">
      <div class="chart-box sm"><canvas id="saTrendChart"></canvas></div>
    </div>

    <div class="section-title">기간 내 급성장 / 급감 품목 <span class="text-faint" style="font-weight:400;font-size:12px">전년 동기 대비, 매출 500만원 이상 품목</span></div>
    <div class="two-col" id="saMovers"></div>

    <div class="section-title" style="display:flex;align-items:center;gap:14px">
      <div class="tabbar" id="saTabbar" style="display:flex;gap:6px">
        <button class="chip-btn" data-tab="product">제품별</button>
        <button class="chip-btn" data-tab="customer">거래처별</button>
        <button class="chip-btn" data-tab="manager">담당자별</button>
      </div>
      <input type="text" id="saSearch" class="search-input" placeholder="검색...">
    </div>
    <div class="card"><div class="table-wrap" id="saTableWrap"></div></div>
  `;

  wireRangeControls(container, range, (r) => { AppState.salesRange = r; renderSales(container); });

  container.querySelectorAll("#saTabbar .chip-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.addEventListener("click", () => { AppState.salesTab = b.dataset.tab; renderSales(container); });
  });

  renderTrendLine("saTrendChart", computeLast12MonthsTrend(sales, range.end), { label: "월 매출" });

  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const ranking = computeProductRanking(sales, range, prevRange);
  renderMovers(document.getElementById("saMovers"), ranking);

  const searchEl = document.getElementById("saSearch");
  let searchTerm = AppState.salesSearch || "";
  searchEl.value = searchTerm;
  searchEl.addEventListener("input", (e) => {
    AppState.salesSearch = e.target.value;
    renderSalesTable(tab, sales, range, prevRange, e.target.value);
  });

  renderSalesTable(tab, sales, range, prevRange, searchTerm);
}

function renderMovers(el, ranking) {
  const eligible = ranking.filter(r => r.revenue >= 5000000 && r.growth !== null);
  const gainers = [...eligible].filter(r => r.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 5);
  const losers = [...eligible].filter(r => r.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, 5);
  const row = (r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f1f4">
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
          <th>순위</th><th>품목</th><th class="num">매출</th><th class="num">비중</th><th class="num">누적비중</th>
          <th class="num">판매수량</th><th class="num">평균단가</th><th class="num">전년동기</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}</td>
            <td class="num text-faint">${fmtPct(r.cumShare, { digits: 0 })}</td>
            <td class="num">${fmtNum(r.qty)}</td>
            <td class="num">${fmtWon(r.avgPrice)}</td>
            <td class="num">${deltaTag(r.growth)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } else if (tab === "customer") {
    let cust = computeCustomerAnalysis(sales, range);
    let rows = cust.ranking;
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>순위</th><th>거래처</th><th class="num">매출</th><th class="num">비중</th><th class="num">거래건수</th><th class="num">건당 평균</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}</td>
            <td class="num">${fmtNum(r.count)}</td>
            <td class="num">${fmtWon(r.count > 0 ? r.revenue / r.count : 0)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } else {
    let rows = computeManagerPerformance(sales, range);
    if (term) rows = rows.filter(r => r.key.toLowerCase().includes(term));
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>순위</th><th>담당자</th><th class="num">매출</th><th class="num">비중</th><th class="num">거래건수</th><th class="num">건당 평균</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
            <td>${escapeHtml(r.key)}</td>
            <td class="num">${fmtWon(r.revenue)}</td>
            <td class="num">${fmtPct(r.share, { digits: 1 })}</td>
            <td class="num">${fmtNum(r.count)}</td>
            <td class="num">${fmtWon(r.avgDeal)}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  }
}
