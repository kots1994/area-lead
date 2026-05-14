// Feedback FAB → modal → POST /api/feedback
(function () {
  const $ = (id) => document.getElementById(id);
  const fab = $("feedback-fab");
  const modal = $("feedback-modal");
  const form = $("feedback-form");
  const closeBtn = $("btn-feedback-close");
  const status = $("feedback-status");

  if (!fab || !modal || !form) return;

  function open() { modal.hidden = false; setTimeout(() => $("feedback-message")?.focus(), 100); }
  function close() {
    modal.hidden = true; status.textContent = ""; status.className = "modal-status";
  }

  fab.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = $("feedback-message").value.trim();
    if (!message) { status.textContent = "メッセージを入力してください"; status.className = "modal-status error"; return; }
    const body = {
      message,
      email: $("feedback-email").value.trim(),
      category: $("feedback-category").value,
    };
    status.textContent = "送信中...";
    status.className = "modal-status info";
    try {
      const r = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.ok) {
        status.textContent = "✓ 送信しました。ありがとうございます！";
        status.className = "modal-status success";
        $("feedback-message").value = "";
        setTimeout(close, 1500);
      } else {
        throw new Error(data.error || "送信失敗");
      }
    } catch (err) {
      status.textContent = `エラー: ${err.message}`;
      status.className = "modal-status error";
    }
  });
})();
