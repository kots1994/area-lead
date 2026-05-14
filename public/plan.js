const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

let planState = null;

async function loadAll() {
  const [ps, ref] = await Promise.all([
    api("GET", "/api/plan/state"),
    api("GET", "/api/referral/info"),
  ]);
  if (ps.ok) {
    planState = ps.data;
    renderPlan();
  }
  if (ref.ok) renderReferral(ref.data);
}

function renderPlan() {
  const p = planState;
  const nameMap = { free: "Free", starter: "Starter", pro: "✨ Pro", enterprise: "Enterprise" };
  $("current-plan-name").textContent = nameMap[p.plan] || p.plan_name;

  const meta = [];
  if (p.price_jpy) meta.push(`¥${p.price_jpy.toLocaleString()}/月`);
  if (p.plan_source === "ambassador") meta.push(`アンバサダー特典 (期限: ${new Date(p.plan_expires_ts).toLocaleDateString("ja-JP")})`);
  if (p.plan_cancelled) meta.push(`解約済 (期間末日: ${p.plan_expires_ts ? new Date(p.plan_expires_ts).toLocaleDateString("ja-JP") : "—"} まで利用可)`);
  $("current-plan-meta").textContent = meta.join(" · ");

  const status = $("plan-status-pill");
  if (p.plan_cancelled) status.innerHTML = '<span class="pill-warn">解約予定</span>';
  else if (p.plan !== "free") status.innerHTML = '<span class="pill-pro">アクティブ</span>';
  else status.innerHTML = '<span class="pill-free">無料プラン</span>';

  // Usage
  const used = p.quota_used || 0;
  const total = p.quota_total;
  if (total === "unlimited") {
    $("usage-stat").textContent = `${used} 行 (無制限)`;
    $("usage-bar").style.width = "30%";
  } else {
    $("usage-stat").textContent = `${used} / ${total} 行`;
    const pct = Math.min(100, (used / total) * 100);
    $("usage-bar").style.width = `${pct}%`;
    $("usage-bar").classList.remove("warning", "danger");
    if (pct > 90) $("usage-bar").classList.add("danger");
    else if (pct > 70) $("usage-bar").classList.add("warning");
  }

  // Action buttons
  const actions = $("plan-card-actions");
  if (p.plan === "free") {
    actions.innerHTML = `<button class="btn-primary" data-upgrade="starter">Starterにアップグレード</button>`;
  } else {
    actions.innerHTML = `<a class="btn-secondary" href="mailto:makotoejima@gmail.com?subject=AreaLead%20%E3%83%97%E3%83%A9%E3%83%B3%E5%A4%89%E6%9B%B4%2F%E8%A7%A3%E7%B4%84">変更・解約のお問い合わせ</a>`;
  }

  // Wire upgrade buttons (mailto: based)
  document.querySelectorAll("[data-upgrade], [data-checkout]").forEach((b) => {
    b.addEventListener("click", async () => {
      const plan = b.dataset.upgrade || b.dataset.checkout;
      const r = await api("POST", "/api/plan/upgrade-link", { plan });
      if (r.ok) location.href = r.data.url;
    });
  });
}

function renderReferral(ref) {
  $("ref-code").textContent = ref.code;
  $("ref-sent").textContent = ref.referrals_sent_count;
  $("ref-converted").textContent = ref.referrals_pro_count;
  $("ref-rewards").textContent = ref.rewards_months_earned;

  $("ref-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ref.code); $("ref-copy").textContent = "✓ コピー済"; setTimeout(() => $("ref-copy").textContent = "コピー", 1500); } catch {}
  });
  $("ref-share-text").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ref.share_text); $("ref-share-text").textContent = "✓ コピー済"; setTimeout(() => $("ref-share-text").textContent = "招待文をコピー", 1500); } catch {}
  });
  $("ref-share-x").addEventListener("click", () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(ref.share_text)}`, "_blank");
  });
}

// Auth gate
(async () => {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    const d = await r.json();
    if (!d.ok || !d.data) {
      location.href = "/login.html?next=/plan.html";
      return;
    }
    await loadAll();
  } catch {
    location.href = "/login.html?next=/plan.html";
  }
})();
