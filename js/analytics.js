// ---------- inventory line category classification ----------
// Wonmedico's source spreadsheet groups rows by loose section headers (e.g. a
// single "Liften S" header spans device units, bundled cosmetics, and plain
// packaging materials). This reclassifies each item into a clean, consistent
// business line based on the item name itself, falling back to the raw sheet
// label only when the name gives no signal.
function classifyLineCategory(itemName, rawLine) {
  const n = itemName || "";
  const raw = (rawLine || "").replace(/\s+/g, " ").trim();

  if (/단상자|미니어처/.test(n)) return "기타";
  if (/헤어빔/.test(n) && /샴푸|컨디셔너|앰플|파우치/.test(n)) return "헤어 라인";
  if (/헤어케어|클라빔|헤어부스터|두피앰플/.test(n)) return "헤어 라인";
  if (/박스|쇼핑백|케이스|패드|아웃박스|슬리브|접이박스|카톤/.test(n)) return "부자재";
  if (/Liften\s*S|카트리지|헤어빔|헤어붐|헤어뱅|Oligihome/i.test(n)) return "디바이스 라인";
  if (/올리지오|클라비안|라비쥬|라비뷰|아큐덤|약산성|크라이오덤|베케이션|울트라|쁘띠글로우|선스크린|폼\s?클렌저|라비엑소좀/.test(n)) return "메디컬 라인";

  if (/welo/i.test(raw)) return "디바이스 라인";
  if (/헤어/.test(raw)) return "헤어 라인";
  if (/메디컬/.test(raw)) return "메디컬 라인";
  if (/부자재/.test(raw)) return "부자재";
  return "기타";
}

// ---------- text normalization & fuzzy item matching ----------

function normalizeName(s) {
  if (!s) return "";
  return String(s)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()（）]/g, " ")
    .replace(/new|NEW|New/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(s) {
  return normalizeName(s).split(/[\s\-\/,]+/).filter(t => t.length >= 2);
}

function tokenMatchScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const setB = new Set(bTokens);
  let hit = 0;
  for (const t of aTokens) if (setB.has(t)) hit++;
  return hit / Math.max(aTokens.length, bTokens.length);
}

const KNOWN_BRANDS = ["클라비안", "라비쥬", "라비뷰", "웰로", "welo", "liften", "리프텐", "헤어빔", "올리지오",
  "쁘띠글로우", "베케이션", "아큐덤", "크라이오덤", "오리지홈", "oligihome"];

function guessBrand(itemName) {
  const norm = normalizeName(itemName);
  for (const b of KNOWN_BRANDS) {
    if (norm.includes(b.toLowerCase())) return b;
  }
  const first = tokenize(itemName)[0];
  return first ? first : "기타";
}

let _matchCache = null;
function buildInventorySalesMatch(sales, inventory) {
  if (_matchCache) return _matchCache;
  const uniqueSalesNames = [...new Set(sales.map(s => s.item_name).filter(Boolean))];
  const salesTokenized = uniqueSalesNames.map(n => ({ name: n, tokens: tokenize(n) }));
  const map = {};
  for (const inv of inventory) {
    const invTokens = tokenize(inv.item_name);
    let matches = [];
    for (const s of salesTokenized) {
      const score = tokenMatchScore(invTokens, s.tokens);
      if (score >= 0.45) matches.push({ name: s.name, score });
    }
    matches.sort((a, b) => b.score - a.score);
    map[inv.item_name] = matches.map(m => m.name);
  }
  _matchCache = map;
  return map;
}

// ---------- date helpers ----------

function ymd(dateStr) {
  return dateStr ? dateStr.slice(0, 10) : null;
}
function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;
}
function yearOf(dateStr) {
  return dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
}

function filterByRange(sales, start, end) {
  return sales.filter(s => s.sale_date >= start && s.sale_date <= end);
}

function shiftRangeOneYearBack(start, end) {
  const s = new Date(start), e = new Date(end);
  s.setFullYear(s.getFullYear() - 1);
  e.setFullYear(e.getFullYear() - 1);
  return { start: fmtDate(s), end: fmtDate(e) };
}

// ---------- core sales aggregation ----------

function sumAmount(rows) {
  return rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
}
function sumQty(rows) {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
}

function computeOverviewKPIs(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const prev = filterByRange(sales, prevRange.start, prevRange.end);

  const curRevenue = sumAmount(cur);
  const prevRevenue = sumAmount(prev);
  const yoy = prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : null;

  const months = new Set(cur.map(r => monthKey(r.sale_date)));
  const monthlyAvg = months.size > 0 ? curRevenue / months.size : 0;

  const byProduct = groupSum(cur, "item_name");
  const topProduct = byProduct[0];

  const totalQty = sumQty(cur);
  const prevQty = sumQty(prev);
  const qtyYoy = prevQty > 0 ? ((totalQty - prevQty) / prevQty) * 100 : null;

  const productCount = new Set(cur.map(r => r.item_name)).size;
  const dealCount = cur.length;
  const avgDeal = dealCount > 0 ? curRevenue / dealCount : 0;

  const customerCount = new Set(cur.map(r => r.customer).filter(Boolean)).size;

  return {
    curRevenue, prevRevenue, yoy, monthlyAvg, topProduct, totalQty, qtyYoy,
    productCount, dealCount, avgDeal, customerCount, curRows: cur
  };
}

function groupSum(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || "(미지정)";
    if (!m.has(k)) m.set(k, { key: k, revenue: 0, qty: 0, count: 0 });
    const g = m.get(k);
    g.revenue += Number(r.total_amount) || 0;
    g.qty += Number(r.qty) || 0;
    g.count += 1;
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

function computeMonthlySeries(sales, year) {
  const cur = new Array(12).fill(0);
  const prev = new Array(12).fill(0);
  for (const r of sales) {
    if (!r.sale_date) continue;
    const y = yearOf(r.sale_date);
    const m = parseInt(r.sale_date.slice(5, 7), 10) - 1;
    if (y === year) cur[m] += Number(r.total_amount) || 0;
    else if (y === year - 1) prev[m] += Number(r.total_amount) || 0;
  }
  return { cur, prev };
}

function computeProductRanking(sales, range, prevRange) {
  const cur = filterByRange(sales, range.start, range.end);
  const prev = filterByRange(sales, prevRange.start, prevRange.end);
  const curG = groupSum(cur, "item_name");
  const prevMap = new Map(groupSum(prev, "item_name").map(g => [g.key, g]));
  const totalRevenue = sumAmount(cur);
  let cum = 0;
  return curG.map((g, i) => {
    const p = prevMap.get(g.key);
    const growth = p && p.revenue > 0 ? ((g.revenue - p.revenue) / p.revenue) * 100 : null;
    const qtyGrowth = p && p.qty > 0 ? ((g.qty - p.qty) / p.qty) * 100 : null;
    const share = totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0;
    cum += share;
    return {
      rank: i + 1, ...g, growth, qtyGrowth, share, cumShare: cum, avgPrice: g.qty > 0 ? g.revenue / g.qty : 0,
      prevRevenue: p ? p.revenue : 0, prevQty: p ? p.qty : 0
    };
  });
}

function computeLostProducts(sales, range, prevRange) {
  const cur = filterByRange(sales, range.start, range.end);
  const prev = filterByRange(sales, prevRange.start, prevRange.end);
  const curKeys = new Set(groupSum(cur, "item_name").map(g => g.key));
  const prevG = groupSum(prev, "item_name");
  return prevG.filter(g => !curKeys.has(g.key)).sort((a, b) => b.revenue - a.revenue);
}

function computeMonthSnapshot(sales, year, month) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOfMonthNum(year, month)).padStart(2, "0")}`;
  const cur = filterByRange(sales, start, end);
  const prevStart = `${year - 1}-${String(month).padStart(2, "0")}-01`;
  const prevEnd = `${year - 1}-${String(month).padStart(2, "0")}-${String(lastDayOfMonthNum(year - 1, month)).padStart(2, "0")}`;
  const prev = filterByRange(sales, prevStart, prevEnd);
  const curRevenue = sumAmount(cur);
  const prevRevenue = sumAmount(prev);
  const curQty = sumQty(cur);
  const prevQty = sumQty(prev);
  return {
    label: `${year}년 ${month}월`, month, start, end,
    revenue: curRevenue, prevRevenue,
    growth: prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : null,
    qty: curQty, prevQty,
    qtyGrowth: prevQty > 0 ? ((curQty - prevQty) / prevQty) * 100 : null,
    dealCount: cur.length
  };
}

function lastDayOfMonthNum(y, m) {
  return new Date(y, m, 0).getDate();
}

function computeQuarterlyBreakdown(sales, year) {
  const quarters = [];
  for (let q = 0; q < 4; q++) {
    const startMonth = q * 3 + 1;
    const endMonth = q * 3 + 3;
    const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDayOfMonthNum(year, endMonth)).padStart(2, "0")}`;
    const prevStart = `${year - 1}-${String(startMonth).padStart(2, "0")}-01`;
    const prevEnd = `${year - 1}-${String(endMonth).padStart(2, "0")}-${String(lastDayOfMonthNum(year - 1, endMonth)).padStart(2, "0")}`;
    const cur = filterByRange(sales, start, end);
    const prev = filterByRange(sales, prevStart, prevEnd);
    const curRevenue = sumAmount(cur);
    const prevRevenue = sumAmount(prev);
    const curQty = sumQty(cur);
    const prevQty = sumQty(prev);
    quarters.push({
      label: `${q + 1}분기`, q: q + 1, start, end,
      revenue: curRevenue, prevRevenue,
      growth: prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : null,
      qty: curQty, prevQty,
      qtyGrowth: prevQty > 0 ? ((curQty - prevQty) / prevQty) * 100 : null
    });
  }
  return quarters;
}

function computeCustomerAnalysis(sales, range, prevRange) {
  const cur = filterByRange(sales, range.start, range.end);
  const g = groupSum(cur, "customer");
  const totalRevenue = sumAmount(cur);
  const prevMap = prevRange ? new Map(groupSum(filterByRange(sales, prevRange.start, prevRange.end), "customer").map(x => [x.key, x])) : new Map();

  const firstSeen = new Map();
  for (const r of sales) {
    const c = r.customer || "(미지정)";
    if (!firstSeen.has(c) || r.sale_date < firstSeen.get(c)) firstSeen.set(c, r.sale_date);
  }
  let newRevenue = 0, repeatRevenue = 0;
  for (const r of cur) {
    const c = r.customer || "(미지정)";
    if (firstSeen.get(c) >= range.start) newRevenue += Number(r.total_amount) || 0;
    else repeatRevenue += Number(r.total_amount) || 0;
  }

  const top5Share = totalRevenue > 0 ? (sumAmount2(g.slice(0, 5)) / totalRevenue) * 100 : 0;
  const top10Share = totalRevenue > 0 ? (sumAmount2(g.slice(0, 10)) / totalRevenue) * 100 : 0;

  return {
    ranking: g.map((row, i) => {
      const p = prevMap.get(row.key);
      const growth = p && p.revenue > 0 ? ((row.revenue - p.revenue) / p.revenue) * 100 : null;
      return { rank: i + 1, ...row, share: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0, prevRevenue: p ? p.revenue : 0, growth };
    }),
    totalRevenue, top5Share, top10Share, newRevenue, repeatRevenue,
    customerCount: g.length
  };
}
function sumAmount2(groups) { return groups.reduce((a, g) => a + g.revenue, 0); }

function computeManagerPerformance(sales, range, prevRange) {
  const cur = filterByRange(sales, range.start, range.end);
  const totalRevenue = sumAmount(cur);
  const prevMap = prevRange ? new Map(groupSum(filterByRange(sales, prevRange.start, prevRange.end), "manager").map(x => [x.key, x])) : new Map();
  return groupSum(cur, "manager").map((g, i) => {
    const p = prevMap.get(g.key);
    const growth = p && p.revenue > 0 ? ((g.revenue - p.revenue) / p.revenue) * 100 : null;
    return {
      rank: i + 1, ...g,
      share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
      avgDeal: g.count > 0 ? g.revenue / g.count : 0,
      prevRevenue: p ? p.revenue : 0, growth
    };
  });
}

function computeBrandBreakdown(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const totalRevenue = sumAmount(cur);
  const m = new Map();
  for (const r of cur) {
    const b = guessBrand(r.item_name);
    if (!m.has(b)) m.set(b, { key: b, revenue: 0, qty: 0 });
    const g = m.get(b);
    g.revenue += Number(r.total_amount) || 0;
    g.qty += Number(r.qty) || 0;
  }
  return [...m.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map(g => ({ ...g, share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0 }));
}

function computeLast12MonthsTrend(sales, endDate) {
  const end = new Date(endDate);
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    buckets.push({ key: d.toISOString().slice(0, 7), revenue: 0, qty: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of sales) {
    const k = monthKey(r.sale_date);
    if (idx.has(k)) {
      buckets[idx.get(k)].revenue += Number(r.total_amount) || 0;
      buckets[idx.get(k)].qty += Number(r.qty) || 0;
    }
  }
  return buckets;
}

function computeRecentMonthDetail(sales) {
  const latest = latestDataDateFromSales(sales);
  const mKey = latest.toISOString().slice(0, 7);
  const y = latest.getFullYear(), m = latest.getMonth();
  const prevMKey = new Date(y, m - 1, 1).toISOString().slice(0, 7);
  const prevYearMKey = new Date(y - 1, m, 1).toISOString().slice(0, 7);

  const cur = sales.filter(r => monthKey(r.sale_date) === mKey);
  const prevMonth = sales.filter(r => monthKey(r.sale_date) === prevMKey);
  const prevYear = sales.filter(r => monthKey(r.sale_date) === prevYearMKey);

  const curRevenue = sumAmount(cur);
  const momRevenue = sumAmount(prevMonth);
  const yoyRevenue = sumAmount(prevYear);

  const products = groupSum(cur, "item_name").slice(0, 5);
  const totalRevenue = curRevenue;
  return {
    monthLabel: `${y}년 ${m + 1}월`, mKey,
    curRevenue, momRevenue, yoyRevenue,
    momGrowth: momRevenue > 0 ? ((curRevenue - momRevenue) / momRevenue) * 100 : null,
    yoyGrowth: yoyRevenue > 0 ? ((curRevenue - yoyRevenue) / yoyRevenue) * 100 : null,
    dealCount: cur.length,
    products: products.map(p => ({ ...p, share: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0 }))
  };
}

function latestDataDateFromSales(sales) {
  if (!sales.length) return new Date();
  let max = sales[0].sale_date;
  for (const r of sales) if (r.sale_date > max) max = r.sale_date;
  return new Date(max);
}

// ---------- inventory analytics ----------

function computeInventoryValuation(inventory, sales) {
  const matchMap = buildInventorySalesMatch(sales, inventory);
  const priceCache = {};
  for (const inv of inventory) {
    const names = matchMap[inv.item_name] || [];
    const rows = sales.filter(s => names.includes(s.item_name));
    const rows90 = rows.filter(r => r.sale_date >= isoDaysAgo(90));
    const source = rows90.length ? rows90 : rows;
    if (source.length) {
      const totalQty = sumQty(source);
      const totalRev = sumAmount(source);
      priceCache[inv.item_name] = totalQty > 0 ? totalRev / totalQty : null;
    } else {
      priceCache[inv.item_name] = null;
    }
  }
  return priceCache;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return fmtDate(d);
}

function computeInventoryVelocity(inventory, sales, windowDays = 90) {
  const matchMap = buildInventorySalesMatch(sales, inventory);
  const since = isoDaysAgo(windowDays);
  return inventory.map(inv => {
    const names = matchMap[inv.item_name] || [];
    const recentRows = sales.filter(s => names.includes(s.item_name) && s.sale_date >= since);
    const soldQty = sumQty(recentRows);
    const dailyRate = soldQty / windowDays;
    const totalQty = Number(inv.total_qty) || 0;
    const daysOfStock = dailyRate > 0 ? totalQty / dailyRate : (totalQty > 0 ? Infinity : 0);
    let status = "normal";
    if (dailyRate === 0 && totalQty > 0) status = "no_recent_sales";
    else if (daysOfStock < 14) status = "reorder_urgent";
    else if (daysOfStock < 30) status = "reorder_soon";
    else if (daysOfStock > 365 && totalQty > 0) status = "overstock";
    return { item: inv, soldQty90: soldQty, dailyRate, daysOfStock, status, matched: names.length > 0 };
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return daysBetween(new Date(new Date().toDateString()), d);
}

// ---------- inventory management (transactions, settings, reorder) ----------

const TX_TYPE_SIGN = {
  "입고": 1, "반품입고": 1, "조정(증가)": 1,
  "출고": -1, "폐기": -1, "조정(감소)": -1
};
const TX_TYPES = Object.keys(TX_TYPE_SIGN);

function computeEffectiveQtyMap(inventory, transactions) {
  const map = new Map();
  for (const inv of inventory) map.set(inv.item_name, Number(inv.total_qty) || 0);
  for (const tx of transactions) {
    const snap = inventory.find(i => i.item_name === tx.item_name);
    if (snap && tx.tx_date < snap.snapshot_date) continue;
    const sign = TX_TYPE_SIGN[tx.tx_type] ?? 0;
    const cur = map.has(tx.item_name) ? map.get(tx.item_name) : 0;
    map.set(tx.item_name, cur + sign * (Number(tx.qty) || 0));
  }
  return map;
}

function getItemSettingsMap(itemSettings) {
  return new Map(itemSettings.map(s => [s.item_name, s]));
}

function computeReorderSuggestions(inventory, effectiveQtyMap, settingsMap, velocity) {
  const velocityMap = new Map(velocity.map(v => [v.item.item_name, v]));
  const out = [];
  for (const inv of inventory) {
    const eff = effectiveQtyMap.get(inv.item_name) ?? (Number(inv.total_qty) || 0);
    const setting = settingsMap.get(inv.item_name);
    const v = velocityMap.get(inv.item_name);
    let reorderPoint, targetStock, basis;
    if (setting && setting.reorder_point !== null && setting.reorder_point !== undefined) {
      reorderPoint = Number(setting.reorder_point);
      targetStock = setting.target_stock !== null && setting.target_stock !== undefined ? Number(setting.target_stock) : reorderPoint * 2;
      basis = "설정값";
    } else if (v && v.dailyRate > 0) {
      const leadTime = setting?.lead_time_days || 14;
      const safety = setting?.safety_stock !== null && setting?.safety_stock !== undefined ? Number(setting.safety_stock) : v.dailyRate * 7;
      reorderPoint = v.dailyRate * leadTime + safety;
      targetStock = v.dailyRate * (leadTime + 30) + safety;
      basis = "판매속도 자동계산";
    } else if (eff <= 0) {
      reorderPoint = 0;
      targetStock = Number(inv.production_qty) > 0 ? Number(inv.production_qty) : 10;
      basis = "재고 소진 (판매 데이터 부족)";
    } else {
      continue;
    }
    if (eff <= reorderPoint) {
      out.push({
        item: inv, effectiveQty: eff, reorderPoint, targetStock, basis,
        suggestedOrderQty: Math.max(0, Math.round(targetStock - eff)),
        urgent: eff <= reorderPoint * 0.5
      });
    }
  }
  return out.sort((a, b) => (a.effectiveQty / (a.reorderPoint || 1)) - (b.effectiveQty / (b.reorderPoint || 1)));
}

function computeABCClass(cumShare) {
  if (cumShare <= 80) return "A";
  if (cumShare <= 95) return "B";
  return "C";
}

function computeCustomerLastPurchase(sales) {
  const map = new Map();
  for (const r of sales) {
    const c = r.customer || "(미지정)";
    if (!map.has(c) || r.sale_date > map.get(c)) map.set(c, r.sale_date);
  }
  return map;
}

function computeInventoryKPIs(inventory, sales) {
  const totalItems = inventory.length;
  const totalQty = inventory.reduce((a, r) => a + (Number(r.total_qty) || 0), 0);
  const hq = inventory.reduce((a, r) => a + (Number(r.hq_qty) || 0), 0);
  const saeseoul = inventory.reduce((a, r) => a + (Number(r.saeseoul_qty) || 0), 0);
  const daejeon = inventory.reduce((a, r) => a + (Number(r.daejeon_qty) || 0), 0);

  const expiringSoon = inventory.filter(r => {
    const d = daysUntil(r.expiry_date);
    return d !== null && d <= 90 && d >= 0;
  });
  const expired = inventory.filter(r => {
    const d = daysUntil(r.expiry_date);
    return d !== null && d < 0;
  });

  const priceMap = computeInventoryValuation(inventory, sales);
  let valuation = 0;
  let valuedCount = 0;
  for (const inv of inventory) {
    const p = priceMap[inv.item_name];
    if (p) { valuation += p * (Number(inv.total_qty) || 0); valuedCount++; }
  }

  return { totalItems, totalQty, hq, saeseoul, daejeon, expiringSoon, expired, valuation, valuedCount, priceMap };
}

// ---------- executive insight summary (overview page) ----------

function computeExecInsights(sales, inventory, range) {
  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const kpi = computeOverviewKPIs(sales, range);
  const ranking = computeProductRanking(sales, range, prevRange);
  const lost = computeLostProducts(sales, range, prevRange);
  const cust = computeCustomerAnalysis(sales, range, prevRange);
  const velocity = inventory.length ? computeInventoryVelocity(inventory, sales, 90) : [];
  const urgentCount = velocity.filter(v => v.status === "reorder_urgent").length;
  const noSaleCount = velocity.filter(v => v.status === "no_recent_sales" && (Number(v.item.total_qty) || 0) > 0).length;

  const insights = [];

  if (kpi.yoy !== null) {
    insights.push({
      tone: kpi.yoy >= 0 ? "good" : "bad",
      text: `선택 기간 매출 ${fmtWon(kpi.curRevenue)} · 전년 동기 대비 ${kpi.yoy >= 0 ? "▲" : "▼"}${Math.abs(kpi.yoy).toFixed(1)}%`
    });
  } else {
    insights.push({ tone: "neutral", text: `선택 기간 매출 ${fmtWon(kpi.curRevenue)} (비교할 전년 동기 데이터 없음)` });
  }

  const meaningful = ranking.filter(r => r.revenue >= 500000 && r.growth !== null);
  const grown = meaningful.slice().sort((a, b) => b.growth - a.growth)[0];
  const declined = meaningful.slice().sort((a, b) => a.growth - b.growth)[0];
  if (grown && grown.growth > 20) insights.push({ tone: "good", text: `${grown.key} 매출 급성장 — 전년 대비 ▲${grown.growth.toFixed(1)}% (${fmtWon(grown.revenue)})` });
  if (declined && declined.growth < -20 && declined.key !== grown?.key) insights.push({ tone: "bad", text: `${declined.key} 매출 급감 — 전년 대비 ▼${Math.abs(declined.growth).toFixed(1)}% (${fmtWon(declined.revenue)})` });

  if (lost.length) {
    const lostTotal = lost.reduce((a, g) => a + g.revenue, 0);
    insights.push({ tone: "bad", text: `전년엔 팔렸으나 이번 기간엔 실적 없는 품목 ${lost.length}개 (전년 매출 합계 ${fmtWon(lostTotal)}) — 단종·재고소진 여부 확인 필요` });
  }

  if (cust.top5Share >= 50) {
    insights.push({ tone: "warn", text: `상위 5개 거래처가 매출의 ${cust.top5Share.toFixed(1)}% 차지 — 거래처 편중 리스크` });
  }

  if (urgentCount > 0) insights.push({ tone: "bad", text: `재고 소진 임박(2주 이내) 품목 ${urgentCount}종 — 긴급 발주 검토 필요` });
  if (noSaleCount > 0) insights.push({ tone: "warn", text: `최근 90일간 판매 없이 재고만 보유 중인 품목 ${noSaleCount}종 — 재고자산 회전 점검 필요` });

  if (kpi.avgDeal > 0 && kpi.dealCount > 0) {
    insights.push({ tone: "neutral", text: `거래 ${fmtNum(kpi.dealCount)}건 · 평균 거래단가 ${fmtWon(kpi.avgDeal)} · 활동 거래처 ${fmtNum(kpi.customerCount)}곳` });
  }

  return insights.slice(0, 6);
}
