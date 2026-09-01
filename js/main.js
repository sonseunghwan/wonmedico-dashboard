const AppState = { view: "overview" };

const VIEW_TITLES = {
  overview: "종합 현황",
  sales: "매출 분석",
  inventory: "재고현황",
  upload: "데이터 업로드",
  admin: "계정 관리"
};
const VIEW_RENDERERS = {
  overview: renderOverview,
  sales: renderSales,
  inventory: renderInventory,
  upload: renderUpload,
  admin: renderAdmin
};

function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
}
function showLogin() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
}

function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  document.getElementById("viewTitle").textContent = VIEW_TITLES[view] || "";
}

function renderView(view) {
  AppState.view = view;
  setActiveNav(view);
  const container = document.getElementById("viewContainer");
  container.innerHTML = '<div class="loading-block">불러오는 중...</div>';
  try {
    VIEW_RENDERERS[view](container);
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-note">화면을 불러오는 중 오류가 발생했습니다: ${e.message}</div>`;
  }
}

function updateDataUpdatedLabel() {
  const el = document.getElementById("dataUpdatedLabel");
  if (Store.dataLoadedAt) {
    el.textContent = "데이터 기준: " + Store.dataLoadedAt.toLocaleString("ko-KR", { hour12: false });
  }
}

async function initAppShell() {
  document.getElementById("userEmailLabel").textContent = Store.session.user.email;
  document.getElementById("userAvatar").textContent = (Store.session.user.email || "?")[0].toUpperCase();
  document.getElementById("userRoleLabel").textContent = Store.profile?.is_admin ? "관리자" : "뷰어";

  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !Store.profile?.is_admin));

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => renderView(btn.dataset.view));
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    localStorage.removeItem("wm_data_cache_v1");
    location.reload();
  });
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    const btn = document.getElementById("refreshBtn");
    btn.disabled = true; btn.textContent = "새로고침 중...";
    await loadAllData(true);
    updateDataUpdatedLabel();
    renderView(AppState.view);
    btn.disabled = false; btn.textContent = "↻ 새로고침";
  });

  showApp();
  await loadAllData();
  updateDataUpdatedLabel();
  renderView("overview");
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginSubmitBtn");
  errEl.textContent = "";
  btn.disabled = true; btn.textContent = "로그인 중...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    Store.session = data.session;
    await loadProfile(data.session.user.id);
    await initAppShell();
  } catch (err) {
    errEl.textContent = "로그인에 실패했습니다: 이메일 또는 비밀번호를 확인해주세요.";
  } finally {
    btn.disabled = false; btn.textContent = "로그인";
  }
}

async function boot() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);

  const { data } = await sb.auth.getSession();
  if (data.session) {
    Store.session = data.session;
    await loadProfile(data.session.user.id);
    await initAppShell();
  } else {
    showLogin();
  }

  sb.auth.onAuthStateChange((event, session) => {
    Store.session = session;
    if (event === "SIGNED_OUT") showLogin();
  });
}

boot();
