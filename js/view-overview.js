function renderOverview(container) {
  const sales = Store.sales;
  if (!sales.length) {
    container.innerHTML = '<div class="empty-note">매출 데이터가 없습니다. 관리자에게 데이터 업로드를 요청해주세요.</div>';
    return;
  }
  const today = fmtDate(new Date());
  const range = AppState.overviewRange || defaultYearRange();
  AppState.overviewRange = range;

  container.innerHTML = `
    <div class="filter-bar" id="ovFilterBar">
      <button class="chip-btn" data-preset="thisYear">올해</button>
      <button class="chip-btn" data-preset="lastYear">작년</button>
      <button class="chip-btn" data-preset="last12m">최근 12개월</button>
      <button class="chip-btn" data-preset="all">전체 기간</button>
      <div class="filter-spacer"></div>
      <input type="date" id="ovStart" value="${range.start}">
      <span class="text-faint">~</span>
      <input type="date" id="ovEnd" value="${range.end}">
    </div>

    <div class="grid grid-4" id="ovKpiGrid"></div>

    <div class="section-title">월별 매출 추이 <span class="text-faint" style="font-weight:400;font-size:12px">막대=선택연도 · 점선=전년 동기</span></div>
    <div class="card chart-card">
      <div class="chart-box"><canvas id="ovMonthlyChart"></canvas></div>
    </div>

    <div class="two-col" style="margin-top:14px">
      <div class="card chart-card">
        <div class="chart-card-head">
          <div class="chart-card-title">브랜드/라인별 매출 비중</div>
        </div>
        <div class="chart-box"><canvas id="ovBrandDonut"></canvas></div>
      </div>
      <div class="card card-pad">
        <div class="chart-card-title" style="margin-bottom:12px">고객 집중도 &amp; 신규/재구매</div>
        <div id="ovCustomerConc"></div>
      </div>
    </div>

    <div class="section-title">기간 내 제품 랭킹 &amp; 급성장 / 급감 품목</div>
    <div class="card">
      <div class="table-wrap" id="ovRankTableWrap"></div>
    </div>
  `;

  wireRangeControls(container, range, (r) => { AppState.overviewRange = r; renderOverview(container); });

  const kpi = computeOverviewKPIs(sales, range);
  renderKpiGrid(document.getElementById("ovKpiGrid"), kpi, range);

  const spanYear = parseInt(range.end.slice(0, 4), 10);
  renderMonthlyBarLine("ovMonthlyChart", computeMonthlySeries(sales, spanYear), spanYear);

  const brand = computeBrandBreakdown(sales, range);
  renderDonut("ovBrandDonut", brand, { limit: 6 });

  const cust = computeCustomerAnalysis(sales, range);
  renderCustomerConcentration(document.getElementById("ovCustomerConc"), cust);

  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const ranking = computeProductRanking(sales, range, prevRange);
  renderRankingTable(document.getElementById("ovRankTableWrap"), ranking);
}

function defaultYearRange() {
  const now = new Date();
  const y = now.getFullYear();
  return { start: `${y}-01-01`, end: fmtDate(now) };
}

function wireRangeControls(container, range, onChange) {
  const bar = container.querySelector(".filter-bar");
  bar.querySelectorAll(".chip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const now = new Date();
      const y = now.getFullYear();
      let r;
      if (btn.dataset.preset === "thisYear") r = { start: `${y}-01-01`, end: fmtDate(now) };
      else if (btn.dataset.preset === "lastYear") r = { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
      else if (btn.dataset.preset === "last12m") { const d = new Date(now); d.setMonth(d.getMonth() - 11); d.setDate(1); r = { start: fmtDate(d), end: fmtDate(now) }; }
      else r = { start: "2000-01-01", end: fmtDate(now) };
      onChange(r);
    });
  });
  container.querySelector("#ovStart")?.addEventListener("change", (e) => onChange({ start: e.target.value, end: container.querySelector("#ovEnd").value }));
  container.querySelector("#ovEnd")?.addEventListener("change", (e) => onChange({ start: container.querySelector("#ovStart").value, end: e.target.value }));
}

function deltaTag(pct) {
  if (pct === null || pct === undefined) return '<span class="tag tag-gray">비교불가</span>';
  if (pct > 0.05) return `<span class="tag tag-green">▲ ${fmtPct(pct)}</span>`;
  if (pct < -0.05) return `<span class="tag tag-red">▼ ${fmtPct(pct)}</span>`;
  return `<span class="tag tag-gray">- ${fmtPct(pct)}</span>`;
}

function renderKpiGrid(el, kpi, range) {
  el.innerHTML = `
    <div class="card kpi-card">
      <div class="kpi-label">누계 매출 (전년 동기 대비)</div>
      <div class="kpi-value">${fmtWon(kpi.curRevenue)}</div>
      <div class="kpi-sub">${deltaTag(kpi.yoy)} · 전년 ${fmtWon(kpi.prevRevenue)}</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">월 평균 매출</div>
      <div class="kpi-value">${fmtWon(kpi.monthlyAvg)}</div>
      <div class="kpi-sub">거래 ${fmtNum(kpi.dealCount)}건 · 건당 평균 ${fmtWon(kpi.avgDeal)}</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">총 판매 수량 (전년 동기 대비)</div>
      <div class="kpi-value">${fmtNum(kpi.totalQty)}개</div>
      <div class="kpi-sub">${deltaTag(kpi.qtyYoy)}</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">1위 제품</div>
      <div class="kpi-value" style="font-size:16px">${kpi.topProduct ? escapeHtml(kpi.topProduct.key) : "-"}</div>
      <div class="kpi-sub">${kpi.topProduct ? fmtWon(kpi.topProduct.revenue) + " · 취급 " + kpi.productCount + "종" : ""}</div>
    </div>
  `;
}

function renderCustomerConcentration(el, cust) {
  const newShare = cust.totalRevenue > 0 ? (cust.newRevenue / cust.totalRevenue) * 100 : 0;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
          <span class="text-mute">상위 5개 거래처 매출 비중</span><span style="font-weight:700">${fmtPct(cust.top5Share, { digits: 0 })}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(cust.top5Share, 100)}%;${cust.top5Share > 60 ? "background:var(--red)" : ""}"></div></div>
        ${cust.top5Share > 60 ? '<div class="text-faint" style="font-size:11.5px;margin-top:4px">⚠ 소수 거래처 매출 의존도가 높습니다</div>' : ""}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
          <span class="text-mute">신규 거래처 매출 비중 (기간 내 첫 거래)</span><span style="font-weight:700">${fmtPct(newShare, { digits: 0 })}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(newShare, 100)}%"></div></div>
      </div>
      <div style="display:flex;gap:18px;font-size:12.5px;padding-top:4px;border-top:1px solid var(--border)">
        <div><div class="text-faint">거래처 수</div><div style="font-weight:700;font-size:15px">${fmtNum(cust.customerCount)}</div></div>
        <div><div class="text-faint">상위 10개 비중</div><div style="font-weight:700;font-size:15px">${fmtPct(cust.top10Share, { digits: 0 })}</div></div>
      </div>
    </div>
  `;
}

function renderRankingTable(el, ranking) {
  if (!ranking.length) { el.innerHTML = '<div class="empty-note">데이터가 없습니다</div>'; return; }
  const rows = ranking.slice(0, 15).map(r => `
    <tr>
      <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
      <td>${escapeHtml(r.key)}</td>
      <td class="num">${fmtWon(r.revenue)}</td>
      <td class="num">${fmtPct(r.share, { digits: 1 })}</td>
      <td class="num">${fmtNum(r.qty)}</td>
      <td class="num">${fmtWon(r.avgPrice)}</td>
      <td class="num">${deltaTag(r.growth)}</td>
    </tr>
  `).join("");
  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>순위</th><th>품목</th><th class="num">매출</th><th class="num">비중</th>
        <th class="num">판매수량</th><th class="num">평균단가</th><th class="num">전년동기 대비</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
