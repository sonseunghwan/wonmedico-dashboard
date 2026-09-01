function renderOverview(container) {
  const sales = Store.sales;
  if (!sales.length) {
    container.innerHTML = '<div class="empty-note">매출 데이터가 없습니다. 관리자에게 데이터 업로드를 요청해주세요.</div>';
    return;
  }
  const today = fmtDate(new Date());
  const range = AppState.overviewRange || defaultYearRange();
  AppState.overviewRange = range;

  const recent = computeRecentMonthDetail(sales);

  container.innerHTML = `
    <div class="page-lede">
      <div>
        <div class="page-lede-eyebrow">WONMEDICO SALES</div>
        <div class="page-lede-title">📊 매출 종합 현황</div>
        <div class="page-lede-sub">기간별 매출 추이 · 브랜드/거래처 구성 · 제품 랭킹</div>
      </div>
      <div class="page-lede-meta">기준일 ${latestDataDate().toISOString().slice(0, 10)}<br>업로드 시 자동 갱신됩니다</div>
    </div>

    <div class="filter-bar" id="ovFilterBar">
      <span class="text-mute" style="font-size:12.5px;font-weight:600">📅 조회 기간</span>
      ${buildYearMonthPicker("ovStart", range.start)}
      <span class="text-faint">~</span>
      ${buildYearMonthPicker("ovEnd", range.end)}
      <div class="pill-group">
        <button class="chip-btn" data-preset="thisYear">올해</button>
        <button class="chip-btn" data-preset="lastYear">작년</button>
        <button class="chip-btn" data-preset="last12m">최근 12개월</button>
        <button class="chip-btn" data-preset="all">전체 기간</button>
      </div>
    </div>

    <div class="kpi-band" id="ovKpiGrid"></div>

    <div class="section-title">월별 매출 추이 <span class="text-faint" style="font-weight:400;font-size:12px">막대=선택연도 · 점선=전년 동기 (범례 클릭으로 표시/숨김)</span></div>
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

    <div class="section-title">최근월 &amp; 누계 실적</div>
    <div class="two-col two-col-narrow-first">
      <div class="card card-pad">
        <div class="chart-card-title">최근월 <span class="text-faint" style="font-weight:400">${recent.monthLabel}</span></div>
        <div id="ovRecentMonth" style="margin-top:10px"></div>
      </div>
      <div class="card">
        <div class="card-pad" style="padding-bottom:0">
          <div class="chart-card-title">기간 내 제품 랭킹 &amp; 급성장 / 급감 품목</div>
        </div>
        <div class="table-wrap" id="ovRankTableWrap"></div>
      </div>
    </div>
  `;

  wireRangeControls(container, range, (r) => { AppState.overviewRange = r; renderOverview(container); });
  renderRecentMonthCard(document.getElementById("ovRecentMonth"), recent, sales);

  const kpi = computeOverviewKPIs(sales, range);
  renderKpiGrid(document.getElementById("ovKpiGrid"), kpi, range, sales);

  const spanYear = parseInt(range.end.slice(0, 4), 10);
  renderMonthlyBarLine("ovMonthlyChart", computeMonthlySeries(sales, spanYear), spanYear);

  const brand = computeBrandBreakdown(sales, range);
  renderDonut("ovBrandDonut", brand, { limit: 6 });

  const cust = computeCustomerAnalysis(sales, range);
  renderCustomerConcentration(document.getElementById("ovCustomerConc"), cust);

  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const ranking = computeProductRanking(sales, range, prevRange);
  renderRankingTable(document.getElementById("ovRankTableWrap"), ranking, sales, range);
}

function latestDataDate() {
  if (!Store.sales.length) return new Date();
  let max = Store.sales[0].sale_date;
  for (const r of Store.sales) if (r.sale_date > max) max = r.sale_date;
  return new Date(max);
}

function defaultYearRange() {
  const latest = latestDataDate();
  const y = latest.getFullYear();
  return { start: `${y}-01-01`, end: fmtDate(latest) };
}

function getAvailableYears() {
  const set = new Set(Store.sales.map(r => r.sale_date.slice(0, 4)));
  set.add(String(latestDataDate().getFullYear()));
  return [...set].map(Number).sort((a, b) => a - b);
}

function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function buildYearMonthPicker(idPrefix, dateStr) {
  const [y, m] = dateStr.split("-");
  const years = getAvailableYears();
  const yearOpts = years.map(yr => `<option value="${yr}" ${String(yr) === y ? "selected" : ""}>${yr}년</option>`).join("");
  const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(mo => { const mm = String(mo).padStart(2, "0"); return `<option value="${mm}" ${mm === m ? "selected" : ""}>${mo}월</option>`; })
    .join("");
  return `<select id="${idPrefix}Year">${yearOpts}</select><select id="${idPrefix}Month">${monthOpts}</select>`;
}

function wireRangeControls(container, range, onChange, prefix) {
  prefix = prefix || "ov";
  const bar = container.querySelector(".filter-bar");
  bar.querySelectorAll(".chip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const now = latestDataDate();
      const y = now.getFullYear();
      let r;
      if (btn.dataset.preset === "thisYear") r = { start: `${y}-01-01`, end: fmtDate(now) };
      else if (btn.dataset.preset === "lastYear") r = { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
      else if (btn.dataset.preset === "last12m") { const d = new Date(now); d.setMonth(d.getMonth() - 11); d.setDate(1); r = { start: fmtDate(d), end: fmtDate(now) }; }
      else r = { start: "2000-01-01", end: fmtDate(now) };
      onChange(r);
    });
  });
  const applyManual = () => {
    const sy = container.querySelector(`#${prefix}StartYear`)?.value;
    const sm = container.querySelector(`#${prefix}StartMonth`)?.value;
    const ey = container.querySelector(`#${prefix}EndYear`)?.value;
    const em = container.querySelector(`#${prefix}EndMonth`)?.value;
    if (!sy || !sm || !ey || !em) return;
    const start = `${sy}-${sm}-01`;
    const end = `${ey}-${em}-${String(lastDayOfMonth(Number(ey), Number(em))).padStart(2, "0")}`;
    onChange({ start, end });
  };
  [`#${prefix}StartYear`, `#${prefix}StartMonth`, `#${prefix}EndYear`, `#${prefix}EndMonth`].forEach(sel => {
    container.querySelector(sel)?.addEventListener("change", applyManual);
  });
}

function deltaTag(pct) {
  if (pct === null || pct === undefined) return '<span class="tag tag-gray">비교불가</span>';
  if (pct > 0.05) return `<span class="tag tag-green">▲ ${fmtPct(pct)}</span>`;
  if (pct < -0.05) return `<span class="tag tag-red">▼ ${fmtPct(pct)}</span>`;
  return `<span class="tag tag-gray">- ${fmtPct(pct)}</span>`;
}

function renderKpiGrid(el, kpi, range, sales) {
  el.innerHTML = `
    <div class="kpi-band-item">
      <div class="kpi-label">누계 매출 (전년 동기 대비)</div>
      <div class="kpi-value kpi-value-hero">${fmtWon(kpi.curRevenue)}</div>
      <div class="kpi-sub">${deltaTag(kpi.yoy)} · 전년 ${fmtWon(kpi.prevRevenue)}</div>
    </div>
    <div class="kpi-band-item">
      <div class="kpi-label">월 평균 매출</div>
      <div class="kpi-value">${fmtWon(kpi.monthlyAvg)}</div>
      <div class="kpi-sub">거래 ${fmtNum(kpi.dealCount)}건 · 건당 평균 ${fmtWon(kpi.avgDeal)}</div>
    </div>
    <div class="kpi-band-item">
      <div class="kpi-label">총 판매 수량 (전년 동기 대비)</div>
      <div class="kpi-value">${fmtNum(kpi.totalQty)}개</div>
      <div class="kpi-sub">${deltaTag(kpi.qtyYoy)}</div>
    </div>
    <div class="kpi-band-item ${kpi.topProduct ? "clickable-row" : ""}" id="ovTopProductCard" title="${kpi.topProduct ? "클릭하면 상세 거래내역을 볼 수 있어요" : ""}">
      <div class="kpi-label">1위 제품 ${kpi.topProduct ? '<span class="text-faint" style="font-weight:400">🔍 상세</span>' : ""}</div>
      <div class="kpi-value" style="font-size:16px">${kpi.topProduct ? escapeHtml(kpi.topProduct.key) : "-"}</div>
      <div class="kpi-sub">${kpi.topProduct ? fmtWon(kpi.topProduct.revenue) + " · 취급 " + kpi.productCount + "종" : ""}</div>
    </div>
  `;
  if (kpi.topProduct) {
    document.getElementById("ovTopProductCard").addEventListener("click", () => {
      const rows = filterByRange(sales, range.start, range.end).filter(r => r.item_name === kpi.topProduct.key);
      openSalesDetailModal(kpi.topProduct.key, rows, { subtitle: `${range.start} ~ ${range.end}` });
    });
  }
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

function renderRecentMonthCard(el, recent, sales) {
  if (!recent.dealCount) { el.innerHTML = '<div class="empty-note">해당 월 데이터가 없습니다</div>'; return; }
  el.innerHTML = `
    <div class="kpi-value" style="font-size:22px">${fmtWon(recent.curRevenue)}</div>
    <div class="kpi-sub" style="margin-bottom:14px">${deltaTag(recent.momGrowth)} 전월 대비 · ${deltaTag(recent.yoyGrowth)} 전년동월 대비</div>
    <div style="font-size:12px;color:var(--text-mute);font-weight:600;margin-bottom:6px">품목별 매출 (상위 5) <span class="text-faint" style="font-weight:400">클릭 시 상세</span></div>
    ${recent.products.map(p => `
      <div class="clickable-row recent-product-row" data-item="${escapeHtml(p.key)}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px solid #f0f1f4;font-size:12.5px;border-radius:6px">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${escapeHtml(p.key)}</span>
        <span style="display:flex;gap:8px;align-items:center">
          <span class="text-faint">${fmtPct(p.share, { digits: 0 })}</span>
          <span style="font-weight:700">${fmtWon(p.revenue)}</span>
        </span>
      </div>
    `).join("")}
    <div class="text-faint" style="font-size:11.5px;margin-top:10px">거래 ${fmtNum(recent.dealCount)}건</div>
  `;
  el.querySelectorAll(".recent-product-row").forEach(row => {
    row.addEventListener("click", () => {
      const item = row.dataset.item;
      const rows = sales.filter(r => monthKey(r.sale_date) === recent.mKey && r.item_name === item);
      openSalesDetailModal(item, rows, { subtitle: recent.monthLabel });
    });
  });
}

const ABC_CLASS_TAG = { A: "tag-green", B: "tag-amber", C: "tag-gray" };

function renderRankingTable(el, ranking, sales, range) {
  if (!ranking.length) { el.innerHTML = '<div class="empty-note">데이터가 없습니다</div>'; return; }
  const rows = ranking.slice(0, 15).map(r => {
    const cls = computeABCClass(r.cumShare);
    return `
    <tr class="clickable-row" data-item="${escapeHtml(r.key)}" title="클릭하면 상세 거래내역을 볼 수 있어요">
      <td><span class="rank-badge ${r.rank <= 3 ? "top3" : ""}">${r.rank}</span></td>
      <td>${escapeHtml(r.key)}</td>
      <td><span class="tag ${ABC_CLASS_TAG[cls]}">${cls}</span></td>
      <td class="num">${fmtWon(r.revenue)}<div class="text-faint" style="font-size:11px">전년 ${fmtWon(r.prevRevenue)}</div></td>
      <td class="num">${deltaTag(r.growth)}</td>
      <td class="num">${fmtPct(r.share, { digits: 1 })}</td>
      <td class="num">${fmtNum(r.qty)}개<div class="text-faint" style="font-size:11px">전년 ${fmtNum(r.prevQty)}개</div></td>
      <td class="num">${deltaTag(r.qtyGrowth)}</td>
    </tr>
  `;
  }).join("");
  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>순위</th><th>품목</th><th title="누적매출 80%=A, 95%=B, 나머지=C">등급</th>
        <th class="num">매출 (전년)</th><th class="num">매출 증감</th><th class="num">비중</th>
        <th class="num">수량 (전년)</th><th class="num">수량 증감</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  if (sales && range) {
    el.querySelectorAll("tr.clickable-row").forEach(tr => {
      tr.addEventListener("click", () => {
        const item = tr.dataset.item;
        const rows = filterByRange(sales, range.start, range.end).filter(r => r.item_name === item);
        openSalesDetailModal(item, rows, { subtitle: `${range.start} ~ ${range.end}` });
      });
    });
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
