function renderAdmin(container) {
  if (!Store.profile?.is_admin) {
    container.innerHTML = '<div class="empty-note">관리자만 접근할 수 있는 페이지입니다.</div>';
    return;
  }
  container.innerHTML = `
    <div class="card card-pad">
      <div class="chart-card-title" style="margin-bottom:14px">새 계정 생성</div>
      <form class="admin-form" id="adminCreateForm">
        <label>이메일<input type="email" id="newUserEmail" required placeholder="name@company.com"></label>
        <label>임시 비밀번호<input type="text" id="newUserPassword" required placeholder="8자 이상" minlength="8"></label>
        <label>부서<input type="text" id="newUserDept" placeholder="예: 국내영업팀"></label>
        <label>직급<input type="text" id="newUserPosition" placeholder="예: 대리"></label>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="newUserIsAdmin" style="width:auto"> 관리자 권한</label>
        <button type="submit" class="btn btn-primary">계정 생성</button>
      </form>
      <div class="text-faint" style="font-size:11.5px;margin-top:10px">생성된 계정 정보(이메일/비밀번호)를 담당자에게 직접 전달해주세요. 최초 로그인 후 비밀번호 변경을 권장합니다.</div>
    </div>

    <div class="section-title">전체 사용자</div>
    <div class="card"><div class="table-wrap" id="adminUserTableWrap"></div></div>
  `;

  document.getElementById("adminCreateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("newUserEmail").value.trim();
    const password = document.getElementById("newUserPassword").value;
    const department = document.getElementById("newUserDept").value.trim() || null;
    const position = document.getElementById("newUserPosition").value.trim() || null;
    const isAdmin = document.getElementById("newUserIsAdmin").checked;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "생성 중...";
    try {
      const created = await callAdminFn({ action: "create", email, password, is_admin: isAdmin });
      if (department || position) {
        await sb.from("profiles").update({ department, position }).eq("id", created.id);
      }
      toast(`계정 생성 완료: ${email}`, "success");
      e.target.reset();
      await loadUserTable();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = "계정 생성";
    }
  });

  loadUserTable();
}

async function loadUserTable() {
  const wrap = document.getElementById("adminUserTableWrap");
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-note">불러오는 중...</div>';
  const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
  if (error) { wrap.innerHTML = `<div class="empty-note">오류: ${error.message}</div>`; return; }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>이메일</th><th>부서</th><th>직급</th><th>권한</th><th>가입일</th><th></th></tr></thead>
      <tbody>${data.map(u => `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.email)}</td>
          <td><input type="text" class="dept-input" value="${escapeHtml(u.department || "")}" placeholder="부서" style="width:100px;border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:12.5px"></td>
          <td><input type="text" class="position-input" value="${escapeHtml(u.position || "")}" placeholder="직급" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:12.5px"></td>
          <td>${u.is_admin ? '<span class="badge-admin">관리자</span>' : '<span class="badge-viewer">뷰어</span>'}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm save-profile-btn">저장</button>
            <button class="btn btn-sm reset-pw-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}">비번 재설정</button>
            ${u.id !== Store.session.user.id ? `
              <button class="btn btn-sm toggle-admin-btn" data-id="${u.id}" data-cur="${u.is_admin}">${u.is_admin ? "권한 해제" : "관리자 지정"}</button>
              <button class="btn btn-sm btn-danger del-user-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}">삭제</button>
            ` : '<span class="text-faint">본인</span>'}
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll(".save-profile-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const department = tr.querySelector(".dept-input").value.trim() || null;
      const position = tr.querySelector(".position-input").value.trim() || null;
      btn.disabled = true; btn.textContent = "저장 중...";
      const { error } = await sb.from("profiles").update({ department, position }).eq("id", id);
      if (error) { toast(error.message, "error"); }
      else { toast("저장되었습니다", "success"); }
      btn.disabled = false; btn.textContent = "저장";
    });
  });
  wrap.querySelectorAll(".toggle-admin-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const makeAdmin = btn.dataset.cur !== "true";
      btn.disabled = true;
      try {
        await callAdminFn({ action: "set_admin", target_id: btn.dataset.id, is_admin: makeAdmin });
        toast("권한이 변경되었습니다", "success");
        await loadUserTable();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  });
  wrap.querySelectorAll(".reset-pw-btn").forEach(btn => {
    btn.addEventListener("click", () => openResetPasswordModal(btn.dataset.id, btn.dataset.email));
  });
  wrap.querySelectorAll(".del-user-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`${btn.dataset.email} 계정을 삭제할까요?`)) return;
      btn.disabled = true;
      try {
        await callAdminFn({ action: "delete", target_id: btn.dataset.id });
        toast("계정이 삭제되었습니다", "success");
        await loadUserTable();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  });
}

function openResetPasswordModal(targetId, email) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:380px">
      <div class="modal-title">비밀번호 재설정</div>
      <div class="text-mute" style="font-size:12.5px;margin-bottom:14px">${escapeHtml(email)} 계정의 새 비밀번호를 설정합니다.</div>
      <form id="resetPwForm">
        <label class="modal-label">새 비밀번호<input type="text" id="resetPwInput" required minlength="8" placeholder="8자 이상"></label>
        <div class="modal-error" id="resetPwError"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="resetPwCancelBtn">취소</button>
          <button type="submit" class="btn btn-primary">재설정</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("resetPwCancelBtn").addEventListener("click", () => overlay.remove());
  document.getElementById("resetPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("resetPwInput").value;
    const errEl = document.getElementById("resetPwError");
    const btn = e.target.querySelector("button[type=submit]");
    errEl.textContent = "";
    btn.disabled = true; btn.textContent = "처리 중...";
    try {
      await callAdminFn({ action: "reset_password", target_id: targetId, password });
      toast(`${email} 비밀번호가 재설정되었습니다.`, "success");
      overlay.remove();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = "재설정";
    }
  });
}
