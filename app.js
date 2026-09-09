/* =========================================================
1. SUPABASE CONFIG
========================================================= */
const SUPABASE_URL = "https://ukwwsmtirjneylszhcgv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wV7uMO8ZFsTw_tLCRidQIA_HVxsPOPV";

if (!window.supabase) {
  console.error("Supabase library was not loaded.");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================================================
2. GLOBAL VARIABLES
========================================================= */
let confessionsList = [];
let activeCategory = "الكل";
let searchQuery = "";
let realtimeChannel = null;
let pendingReportData = null;

/* =========================================================
3. ANONYMOUS SESSION
========================================================= */
let sessionId = localStorage.getItem("user_sid");
if (!sessionId) {
  sessionId = "user_" + Math.random().toString(36).substring(2, 12);
  localStorage.setItem("user_sid", sessionId);
}

/* =========================================================
4. DOM READY
========================================================= */
document.addEventListener("DOMContentLoaded", function () {
  initializeApp();
});

/* =========================================================
5. INITIALIZE APP
========================================================= */
function initializeApp() {
  setupEvents();
  updateCharacterCount();
  loadData();
  setupRealtime();
}

/* =========================================================
6. EVENTS
========================================================= */
function setupEvents() {
  const submitButton = document.getElementById("submitButton");
  const searchInput = document.getElementById("searchInput");
  const textInput = document.getElementById("inputText");
  const categories = document.getElementById("categories");
  const btnConfirmReportAction = document.getElementById("btnConfirmReportAction");
  const btnCancelReportAction = document.getElementById("btnCancelReportAction");

  if (submitButton) submitButton.addEventListener("click", submitConfession);
  if (searchInput) searchInput.addEventListener("input", handleSearch);
  if (textInput) textInput.addEventListener("input", updateCharacterCount);

  if (categories) {
    categories.addEventListener("click", function (event) {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      filterCategory(chip.dataset.category, chip);
    });
  }

  if (btnConfirmReportAction) btnConfirmReportAction.addEventListener("click", executeReportPost);
  if (btnCancelReportAction) btnCancelReportAction.addEventListener("click", closeReportModal);
}

/* =========================================================
7. LOAD CONFESSIONS
========================================================= */
async function loadData() {
  const container = document.getElementById("feedContainer");
  if (!container) return;

  if (confessionsList.length === 0) {
    container.innerHTML = '<div class="loading">جارٍ تحميل الاعترافات...</div>';
  }

  try {
    const response = await supabaseClient
      .from("confessions")
      .select(
        "id, category, text, status, reports_count, views_count, created_at, reactions(id, confession_id, reaction_type, user_session_id), comments(id, confession_id, comment_text, created_at)"
      )
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);

    if (response.error) {
      console.error("Load error:", response.error);
      container.innerHTML = '<div class="empty">تعذر تحميل المنشورات.</div>';
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    confessionsList = Array.isArray(response.data) ? response.data : [];
    renderFeed();
  } catch (error) {
    console.error("Unexpected load error:", error);
    container.innerHTML = '<div class="empty">حدث خطأ أثناء تحميل المنشورات.</div>';
    showToast(getErrorMessage(error));
  }
}

/* =========================================================
8. REALTIME
========================================================= */
let realtimeDebounceTimer = null;
function setupRealtime() {
  try {
    realtimeChannel = supabaseClient
      .channel("public-confessions-channel")
      .on("postgres_changes", { event: "*", schema: "public", table: "confessions" }, handleRealtimeChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, handleRealtimeChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, handleRealtimeChange)
      .subscribe();
  } catch (error) {
    console.error("Realtime error:", error);
  }
}

function handleRealtimeChange() {
  clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = setTimeout(() => {
    if (activeCategory === "اعترافاتي") {
      loadMyConfessions();
    } else {
      loadData();
    }
  }, 2000);
}

/* =========================================================
9. RENDER FEED
========================================================= */
function renderFeed() {
  const container = document.getElementById("feedContainer");
  if (!container) return;

  container.innerHTML = "";
  const normalizedSearch = searchQuery.toLowerCase().trim();

  const filtered = confessionsList.filter(function (item) {
    const categoryMatch =
      activeCategory === "الكل" ||
      activeCategory === "اعترافاتي" ||
      item.category === activeCategory;

    const itemText = String(item.text || "").toLowerCase();
    const searchMatch = normalizedSearch === "" || itemText.includes(normalizedSearch);
    return categoryMatch && searchMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">لا توجد منشورات مطابقة حالياً.</div>';
    return;
  }

  filtered.forEach(function (item) {
    const card = createConfessionCard(item);
    container.appendChild(card);
  });
}

/* =========================================================
10. CREATE CONFESSION CARD
========================================================= */
function createConfessionCard(item) {
  const card = document.createElement("article");
  card.className = "confession-card";

  const reactions = Array.isArray(item.reactions) ? item.reactions : [];
  const comments = Array.isArray(item.comments) ? item.comments : [];

  const understandCount = reactions.filter((r) => r.reaction_type === "understand").length;
  const notAloneCount = reactions.filter((r) => r.reaction_type === "notAlone").length;

  const hasUnderstand = reactions.some((r) => String(r.user_session_id) === String(sessionId) && r.reaction_type === "understand");
  const hasNotAlone = reactions.some((r) => String(r.user_session_id) === String(sessionId) && r.reaction_type === "notAlone");

  const commentsHTML = buildCommentsHTML(comments);
  const understandClass = hasUnderstand ? "active" : "";
  const notAloneClass = hasNotAlone ? "active" : "";

  card.innerHTML =
    '<div class="card-top">' +
      '<span class="badge-cat">' + escapeHtml(item.category || "عام") + '</span>' +
      '<button class="report-btn" type="button" data-action="report">🚩 إبلاغ</button>' +
    '</div>' +
    '<div class="card-body-text">' + escapeHtml(item.text || "") + '</div>' +
    '<div class="card-meta">' +
      '<span>👁 ' + String(item.views_count || 0) + '</span>' +
      '<span>💬 ' + String(comments.length) + '</span>' +
      '<span>🕊 مجهول</span>' +
    '</div>' +
    '<div class="reactions-row">' +
      '<button class="react-btn ' + understandClass + '" type="button" data-action="understand">♡ أفهمك (' + String(understandCount) + ')</button>' +
      '<button class="react-btn ' + notAloneClass + '" type="button" data-action="notAlone">◌ لست وحدك (' + String(notAloneCount) + ')</button>' +
    '</div>' +
    '<div class="comments-box">' +
      commentsHTML +
      '<div class="add-comment-input">' +
        '<input type="text" maxlength="500" placeholder="رد دون حُكم..." autocomplete="off" data-action="comment-input">' +
        '<button type="button" data-action="comment">إرسال</button>' +
      '</div>' +
    '</div>';

  card.querySelector('[data-action="report"]').addEventListener("click", () => reportPost(item.id, item.reports_count || 0));
  card.querySelector('[data-action="understand"]').addEventListener("click", () => toggleReaction(item.id, "understand"));
  card.querySelector('[data-action="notAlone"]').addEventListener("click", () => toggleReaction(item.id, "notAlone"));

  // تفعيل إظهار وإخفاء التعليقات المخفية عند الضغط
  const toggleBtn = card.querySelector('[data-action="toggle-comments"]');
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      const extraComments = card.querySelector(".extra-comments");
      if (extraComments) {
        if (extraComments.style.display === "none") {
          extraComments.style.display = "block";
          toggleBtn.textContent = "إخفاء الردود الإضافية";
        } else {
          extraComments.style.display = "none";
          const count = extraComments.querySelectorAll(".comment-item").length;
          toggleBtn.textContent = "عرض باقي الردود (" + count + ")...";
        }
      }
    });
  }

  const commentInput = card.querySelector('[data-action="comment-input"]');
  const commentButton = card.querySelector('[data-action="comment"]');

  if (commentInput && commentButton) {
    commentButton.addEventListener("click", () => addComment(item.id, commentInput, commentButton));
    commentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addComment(item.id, commentInput, commentButton);
      }
    });
  }

  return card;
}

/* =========================================================
11. BUILD COMMENTS
========================================================= */
function buildCommentsHTML(comments) {
  if (!Array.isArray(comments) || comments.length === 0) {
    return '<div class="comments-preview"><div class="comment-item">لا توجد ردود بعد.</div></div>';
  }

  const sortedComments = comments.slice().sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  
  let html = '<div class="comments-preview">';
  
  const initialComments = sortedComments.slice(-3);
  const hiddenComments = sortedComments.slice(0, -3);

  if (hiddenComments.length > 0) {
    html += '<div class="extra-comments" style="display: none;">';
    hiddenComments.forEach((comment) => {
      html += '<div class="comment-item">' + escapeHtml(comment.comment_text || "") + '</div>';
    });
    html += '</div>';
  }

  initialComments.forEach((comment) => {
    html += '<div class="comment-item">' + escapeHtml(comment.comment_text || "") + '</div>';
  });

  if (hiddenComments.length > 0) {
    html += '<div class="comment-more" data-action="toggle-comments">عرض باقي الردود (' + hiddenComments.length + ')...</div>';
  }

  html += '</div>';
  return html;
}

/* =========================================================
12. SUBMIT CONFESSION
========================================================= */
async function submitConfession() {
  const textInput = document.getElementById("inputText");
  const categoryInput = document.getElementById("inputCategory");
  const submitButton = document.getElementById("submitButton");

  if (!textInput || !categoryInput || !submitButton) return;

  const text = textInput.value.trim();
  const category = categoryInput.value;

  if (!text) {
    showToast("اكتب ما بداخلك أولاً.");
    textInput.focus();
    return;
  }

  if (text.length < 3) {
    showToast("اكتب نصاً أطول قليلاً.");
    return;
  }

  const lastPostTime = localStorage.getItem("last_post_time");
  const now = Date.now();
  if (lastPostTime && now - parseInt(lastPostTime) < 15000) {
    const remaining = Math.ceil((15000 - (now - parseInt(lastPostTime))) / 1000);
    showToast(`يرجى الانتظار ${remaining} ثوانٍ قبل نشر اعتراف جديد.`);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "جارٍ النشر...";

  try {
    const response = await supabaseClient
      .from("confessions")
      .insert([{ category: category, text: text, status: "active", reports_count: 0 }])
      .select("id");

    if (response.error) {
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    if (response.data && response.data.length > 0) {
      const newPostId = response.data[0].id;
      let myPosts = JSON.parse(localStorage.getItem("my_confessions")) || [];
      myPosts.push(newPostId);
      localStorage.setItem("my_confessions", JSON.stringify(myPosts));
    }

    localStorage.setItem("last_post_time", Date.now().toString());
    textInput.value = "";
    updateCharacterCount();
    showToast("تم نشر اعترافك وحفظه في اعترافاتي 🤍");
    
    if (activeCategory === "اعترافاتي") {
      await loadMyConfessions();
    } else {
      await loadData();
    }
  } catch (error) {
    showToast(getErrorMessage(error));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "نشر دون اسم";
  }
}

/* =========================================================
12.B. LOAD MY CONFESSIONS
========================================================= */
async function loadMyConfessions() {
  const container = document.getElementById("feedContainer");
  if (!container) return;

  const myPosts = JSON.parse(localStorage.getItem("my_confessions")) || [];

  if (myPosts.length === 0) {
    container.innerHTML = '<div class="empty">لم تقم بنشر أي اعترافات من هذا المتصفح بعد.</div>';
    return;
  }

  container.innerHTML = '<div class="loading">جارٍ تحميل اعترافاتك...</div>';

  try {
    const response = await supabaseClient
      .from("confessions")
      .select(
        "id, category, text, status, reports_count, views_count, created_at, reactions(id, confession_id, reaction_type, user_session_id), comments(id, confession_id, comment_text, created_at)"
      )
      .in("id", myPosts)
      .order("created_at", { ascending: false });

    if (response.error) {
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    confessionsList = Array.isArray(response.data) ? response.data : [];
    renderFeed();
  } catch (error) {
    showToast(getErrorMessage(error));
  }
}

/* =========================================================
13. TOGGLE REACTION
========================================================= */
async function toggleReaction(confessionId, reactionType) {
  const target = confessionsList.find((i) => String(i.id) === String(confessionId));
  if (!target) return;

  const reactions = Array.isArray(target.reactions) ? target.reactions : [];
  const existing = reactions.find((r) => String(r.user_session_id) === String(sessionId) && r.reaction_type === reactionType);

  try {
    let response;
    if (existing) {
      response = await supabaseClient.from("reactions").delete().eq("id", existing.id);
    } else {
      response = await supabaseClient.from("reactions").insert([
        { confession_id: confessionId, reaction_type: reactionType, user_session_id: sessionId }
      ]);
    }

    if (response.error) {
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    if (activeCategory === "اعترافاتي") {
      await loadMyConfessions();
    } else {
      await loadData();
    }
  } catch (error) {
    showToast(getErrorMessage(error));
  }
}

/* =========================================================
14. ADD COMMENT
========================================================= */
async function addComment(confessionId, input, button) {
  const commentText = input.value.trim();
  if (!commentText) {
    showToast("اكتب رداً أولاً.");
    input.focus();
    return;
  }

  const lastCommentTime = localStorage.getItem("last_comment_time");
  const now = Date.now();
  if (lastCommentTime && now - parseInt(lastCommentTime) < 5000) {
    showToast("تمهل قليلاً قبل إرسال رد آخر.");
    return;
  }

  button.disabled = true;
  button.textContent = "...";

  try {
    const response = await supabaseClient.from("comments").insert([
      { confession_id: confessionId, comment_text: commentText }
    ]);

    if (response.error) {
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    localStorage.setItem("last_comment_time", Date.now().toString());
    input.value = "";
    showToast("تم إرسال الرد.");

    if (activeCategory === "اعترافاتي") {
      await loadMyConfessions();
    } else {
      await loadData();
    }
  } catch (error) {
    showToast(getErrorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "إرسال";
  }
}

/* =========================================================
15. REPORT POST
========================================================= */
function reportPost(confessionId, currentCount) {
  pendingReportData = { confessionId, currentCount };
  const modal = document.getElementById("customConfirmModal");
  if (modal) modal.classList.add("active");
}

function closeReportModal() {
  const modal = document.getElementById("customConfirmModal");
  if (modal) modal.classList.remove("active");
  pendingReportData = null;
}

async function executeReportPost() {
  if (!pendingReportData) return;
  const { confessionId, currentCount } = pendingReportData;
  closeReportModal();

  try {
    const response = await supabaseClient.rpc("increment_report", { p_confession_id: confessionId });

    if (response.error) {
      showToast(getSupabaseErrorMessage(response.error));
      return;
    }

    showToast("تم استقبال البلاغ، شكراً لك.");
    
    if (activeCategory === "اعترافاتي") {
      await loadMyConfessions();
    } else {
      await loadData();
    }
  } catch (error) {
    showToast(getErrorMessage(error));
  }
}

/* =========================================================
16. SEARCH, FILTER & UTILS
========================================================= */
function handleSearch(event) {
  searchQuery = String(event.target.value || "");
  renderFeed();
}

function filterCategory(category, element) {
  activeCategory = category || "الكل";
  document.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
  if (element) element.classList.add("active");
  
  if (category === "اعترافاتي") {
    loadMyConfessions();
  } else {
    loadData();
  }
}

function updateCharacterCount() {
  const input = document.getElementById("inputText");
  const counter = document.getElementById("characterCount");
  if (input && counter) counter.textContent = input.value.length + " / 3000";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

function getSupabaseErrorMessage(error) {
  if (!error) return "حدث خطأ غير معروف.";
  const msg = String(error.message || "").toLowerCase();
  if (error.code === "42501" || msg.includes("row-level security")) {
    return "لا توجد صلاحية لتنفيذ العملية. تحقق من سياسات RLS.";
  }
  return error.message || "حدث خطأ في قاعدة البيانات.";
}

function getErrorMessage(error) {
  return error?.message || "حدث خطأ غير متوقع.";
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = String(message || "");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

window.addEventListener("beforeunload", () => {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
});
