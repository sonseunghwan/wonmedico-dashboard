const _chartRegistry = {};

function destroyChart(id) {
  if (_chartRegistry[id]) {
    _chartRegistry[id].destroy();
    delete _chartRegistry[id];
  }
}

const CHART_COLORS = {
  brand: "#2f6fed",
  brandSoft: "rgba(47,111,237,.16)",
  green: "#16a34a",
  red: "#e0362d",
  amber: "#d97706",
  grid: "#eef0f4",
  text: "#6b7280"
};

const PALETTE = ["#2f6fed", "#16a34a", "#d97706", "#a855f7", "#0891b2", "#e0362d", "#64748b", "#ca8a04", "#059669", "#dc2626"];

Chart.defaults.font.family = "'Noto Sans KR', sans-serif";
Chart.defaults.font.size = 11.5;
Chart.defaults.color = CHART_COLORS.text;

function renderMonthlyBarLine(canvasId, monthlySeries, yearLabel) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const labels = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
  _chartRegistry[canvasId] = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: yearLabel + "년",
          data: monthlySeries.cur,
          backgroundColor: CHART_COLORS.brand,
          borderRadius: 4,
          maxBarThickness: 32,
          order: 2
        },
        {
          type: "line",
          label: (yearLabel - 1) + "년",
          data: monthlySeries.prev,
          borderColor: "#c3c9d4",
          borderDash: [4, 3],
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "#c3c9d4",
          tension: 0.25,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (item) => item.dataset.label + ": " + fmtWon(item.parsed.y)
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: CHART_COLORS.grid },
          ticks: { callback: (v) => fmtWon(v) }
        }
      }
    }
  });
}

function renderTrendLine(canvasId, buckets, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: buckets.map(b => b.key),
      datasets: [{
        label: opts.label || "매출",
        data: buckets.map(b => b.revenue),
        borderColor: CHART_COLORS.brand,
        backgroundColor: CHART_COLORS.brandSoft,
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => fmtWon(item.parsed.y) } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: CHART_COLORS.grid }, ticks: { callback: (v) => fmtWon(v) } }
      }
    }
  });
}

function renderDonut(canvasId, groups, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const top = groups.slice(0, opts.limit || 6);
  const rest = groups.slice(opts.limit || 6);
  const restSum = rest.reduce((a, g) => a + g.revenue, 0);
  const labels = top.map(g => g.key);
  const data = top.map(g => g.revenue);
  if (restSum > 0) { labels.push("기타"); data.push(restSum); }
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (item) => item.label + ": " + fmtWon(item.parsed) } }
      }
    }
  });
}

function renderStackedWarehouseBar(canvasId, rows) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["본사", "새서울", "대전"],
      datasets: [{
        label: "재고 수량",
        data: rows,
        backgroundColor: [PALETTE[0], PALETTE[1], PALETTE[2]],
        borderRadius: 4,
        maxBarThickness: 60
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => fmtNum(item.parsed.x) + "개" } } },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { callback: (v) => fmtNum(v) } },
        y: { grid: { display: false } }
      }
    }
  });
}
