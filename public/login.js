const $ = (id) => document.getElementById(id);
const form = $("auth-form");
const btn = $("auth-submit");
const btnLabel = btn.querySelector(".btn-label");
const spinner = btn.querySelector(".btn-spinner");
const status = $("auth-status");
const meta = $("auth-meta");
const tabs = document.querySelectorAll(".auth-tab");

let mode = "login"; // "login" | "register"

function setMode(m) {
  mode = m;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === m));
  if (m === "login") {
    btnLabel.textContent = "ログイン";
    $("auth-password").autocomplete = "current-password";
    meta.innerHTML = `アカウントをお持ちでない方は<a href="#" id="link-switch-register">新規登録</a>`;
  } else {
    btnLabel.textContent = "新規登録 (無料)";
    $("auth-password").autocomplete = "new-password";
    meta.innerHTML = `すでにアカウントをお持ちの方は<a href="#" id="link-switch-login">ログイン</a>`;
  }
  bindSwitchLinks();
  status.textContent = "";
  status.className = "auth-status";
}
function bindSwitchLinks() {
  $("link-switch-register")?.addEventListener("click", (e) => { e.preventDefault(); setMode("register"); });
  $("link-switch-login")?.addEventListener("click", (e) => { e.preventDefault(); setMode("login"); });
}
bindSwitchLinks();

tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.tab)));

function setBusy(b) {
  btn.disabled = b;
  spinner.hidden = !b;
  if (mode === "login") btnLabel.textContent = b ? "ログイン中..." : "ログイン";
  else btnLabel.textContent = b ? "登録中..." : "新規登録 (無料)";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (!email || !password) {
    status.textContent = "メールアドレスとパスワードを入力してください";
    status.className = "auth-status error";
    return;
  }
  setBusy(true);
  status.textContent = "";
  try {
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "認証に失敗しました");
    // Redirect to dashboard
    const next = new URLSearchParams(location.search).get("next") || "/";
    location.href = next;
  } catch (err) {
    status.textContent = err.message;
    status.className = "auth-status error";
  } finally { setBusy(false); }
});

// Auto-redirect if already logged in
(async () => {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    const d = await r.json();
    if (d.ok && d.data) {
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.href = next;
    }
  } catch {}
})();
