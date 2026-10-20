/* ---------------------------------------------------------------------------
   Vista Sidebar - ИИ-помічник (справжній чат з мовною моделлю).

   Запити йдуть на endpoint з agent-config.js (OpenAI / Ollama / LM Studio /
   локальний проксі tools\agent_server.py). Якщо сервер недоступний або не
   заданий - працює офлайн-база знань, щоб чат не був мертвим.

   Розмова з багом: помічник збирає деталі й показує кнопку «Надіслати баг»
   (GitHub Issue) - повідомлення приходить розробникові.
   --------------------------------------------------------------------------- */
(function () {
  var CFG = window.VISTA_AGENT || {};
  var ENDPOINT = CFG.endpoint || "";
  var API_KEY = CFG.apiKey || "";
  var MODEL = CFG.model || "gpt-4o-mini";
  var REPO = CFG.repo || "BirdsnatorAnt/VistaSidebar";
  var APP_VERSION = "1.2";

  var KB = [
    { keys: ["встанов", "install", "постав", "запуст"],
      answer: "Установка: запусти windowsSidebarSetup.exe → Install. Програма стає в " +
              "C:\\Program Files\\Vista Sidebar, запускається разом з Windows і одразу показує " +
              "вікно «Віджети» з усіма гаджетами." },
    { keys: ["налашт", "config", "де зберіга", "дані"],
      answer: "Усі налаштування у %APPDATA%\\VistaSidebar:\n" +
              "• config.txt - список віджетів на столі (GadgetName, друга копія - GadgetName#2);\n" +
              "• settings\\<Гаджет>.txt - налаштування конкретного гаджета (скін ЦП-метра, тема годинника)." },
    { keys: ["гаджет", "додати", "перетяг", "панел", "вікно віджет", "скільки"],
      answer: "Усі гаджети - у вікні «Віджети» (Ctrl+Alt+W або трей-меню). Кожен гаджет - плитка з " +
              "іконкою. Перетягніть іконку на робочий стіл - віджет оживе на місці, подвійний клік теж " +
              "створює його. Одинакових віджетів можна поставити скільки завгодно, кожен має свій скін." },
    { keys: ["скін", "шкім", "skin", "циферблат", "тема", "apple", "black", "pumpkin", "гарбуз"],
      answer: "Скіни - у налаштуваннях віджета: ПКМ → «Опції» → стрілки ◀ ▶ і лічильник «1 з 9». " +
              "У ЦП-метра 8 скінів (Стандартний, Apple, Black, Phantom, Blue, Green, Red, Yellow), " +
              "у годинника - 13 циферблатів, включно з новорічними (3 різдвяні + гарбузова ніч)." },
    { keys: ["нов", "оновлен", "changelog", "release", "верс"],
      answer: null },
    { keys: ["швидк", "performance", "тормоз", "fps"],
      answer: "Усі гаджети - нативні C++/GDI+, без браузера, тому майже не впливають на " +
              "продуктивність. Найважчі - погода, акції та слайдшоу (вони беруть дані з мережі)." }
  ];

  var BUG_WORDS = ["помилк", "баг", "не працю", "не работа", "крашит", "crash", "вилет",
                   "завис", "глюк", "не показу", "не відкрива", "не малює", "чорн"];
  var DONE_WORDS = ["готово", "done", "більше нічого", "все описав"];

  var fab, panel, log, quick, input, form, statusEl;
  var history = [];      // [{role, content}]
  var reportLines = [];  // зібрані рядки звіту
  var online = false;    // чи відповідає справжня модель
  var busy = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function md(text) {
    var s = escapeHtml(text || "");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.replace(/\n/g, "<br>");
  }

  function add(who, text, buttons) {
    var row = el("div", "ai-msg ai-" + who);
    var bubble = el("div", "ai-bubble");
    bubble.innerHTML = who === "user" ? escapeHtml(text) : md(text);
    row.appendChild(bubble);
    log.appendChild(row);
    if (buttons && buttons.length) {
      var bar = el("div", "ai-btns");
      buttons.forEach(function (b) {
        var btn = el("button", "ai-btn", b.label);
        btn.onclick = b.action;
        bar.appendChild(btn);
      });
      row.appendChild(bar);
    }
    log.scrollTop = log.scrollHeight;
  }

  function thinking(on) {
    if (on) {
      var row = el("div", "ai-msg ai-bot");
      row.id = "aiTyping";
      row.innerHTML = '<div class="ai-bubble ai-typing"><i></i><i></i><i></i></div>';
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    } else {
      var t = document.getElementById("aiTyping");
      if (t) t.parentNode.removeChild(t);
    }
  }

  function quickButtons(items) {
    quick.innerHTML = "";
    items.forEach(function (it) {
      var b = el("button", "ai-quick-btn", it.label);
      b.onclick = it.action || function () { submitText(it.label); };
      quick.appendChild(b);
    });
  }

  function setStatus(txt, cls) {
    statusEl.textContent = txt;
    statusEl.className = "ai-status " + (cls || "");
  }

  function has(text, words) {
    var t = text.toLowerCase();
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) >= 0) return true;
    return false;
  }

  // ---------------------------------------------------------------- offline KB
  function updatesAnswer() {
    var list = (window.VISTA_UPDATES || []);
    if (!list.length) return "Оновлень поки немає.";
    var out = "Останні оновлення:\n";
    list.slice(0, 2).forEach(function (u) {
      out += "• v" + u.version + " (" + u.date + ") - " + u.title + "\n";
      (u.items || []).slice(0, 3).forEach(function (i) { out += "   - " + i + "\n"; });
    });
    return out;
  }

  function offlineAnswer(text) {
    for (var i = 0; i < KB.length; i++)
      if (has(text, KB[i].keys)) return KB[i].answer !== null ? KB[i].answer : updatesAnswer();
    return null;
  }

  // ------------------------------------------------------------------- chat API
  function extractAnswer(data) {
    if (!data) return "";
    if (data.choices && data.choices[0] && data.choices[0].message)
      return data.choices[0].message.content || "";       // OpenAI / vLLM
    if (data.message && data.message.content)
      return data.message.content || "";                   // Ollama
    if (data.response) return data.response;                // ollama /api/generate
    return "";
  }

  function askModel(text) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [{ role: "system", content: CFG.system || "" }].concat(history)
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      var answer = extractAnswer(data);
      if (!answer) throw new Error("empty answer");
      return answer;
    });
  }

  // -------------------------------------------------------------------- баг-репорт
  function reportText() {
    var lines = reportLines.slice();
    if (!lines.length) return "";
    return lines.join("\n");
  }

  function openIssue() {
    var body = reportText() || "Проблема з гаджетом Vista Sidebar.\n\n(Опис відсутній - додайте деталі в чаті.)";
    var title = "[" + (CFG.name || "Vista Sidebar") + "] баг з гаджетом";
    var url = "https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent(title) +
              "&body=" + encodeURIComponent(body);
    window.open(url, "_blank", "noopener");
  }

  function copyReport() {
    var text = reportText();
    if (!text) { add("bot", "Звіт поки порожній - розкажіть про проблему детальніше."); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        add("bot", "Звіт скопійовано. Вставте його в будь-який месенджер або лист - і я виправлю проблему.");
      });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      add("bot", "Звіт скопійовано в буфер обміну.");
    }
  }

  function reportButtons() {
    return [
      { label: "📬 Надіслати баг (GitHub Issue)", action: openIssue },
      { label: "📋 Скопіювати звіт", action: copyReport }
    ];
  }

  function collectReport(text) {
    reportLines.push("- " + text);
    var os = text.match(/windows\s*\d+(\.\d+)?/i);
    var ver = text.match(/v?\d+\.\d+(\.\d+)?/);
    var env = [];
    if (os) env.push(os[0]);
    env.push("Vista Sidebar " + APP_VERSION);
    reportLines.push("СЕРЕДОВИЩЕ: " + env.join(", "));
  }

  // ------------------------------------------------------------------- головний потік
  function submitText(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    add("user", text);
    history.push({ role: "user", content: text });
    busy = true;
    input.disabled = true;

    var bug = has(text, BUG_WORDS);
    if (bug) collectReport(text);

    if (!ENDPOINT) {
      setTimeout(function () { answerOffline(text, bug); }, 300);
      return;
    }

    thinking(true);
    askModel(text).then(function (answer) {
      thinking(false);
      online = true;
      setStatus("онлайн · " + MODEL, "on");
      history.push({ role: "assistant", content: answer });
      add("bot", answer, bug ? reportButtons() : null);
      if (bug) {
        add("bot", "Якщо це справді баг - натисніть «Надіслати баг», повідомлення прийде мені " +
                   "в GitHub, і я виправлю. Або допишіть деталі сюди.", reportButtons());
      }
    }).catch(function (err) {
      thinking(false);
      online = false;
      setStatus("офлайн · база знань", "off");
      add("bot", "Мовна модель зараз недоступна (" + (err && err.message ? err.message : "помилка") +
                 "). Відповідаю з локальної бази знань.");
      answerOffline(text, bug);
    }).then(function () {
      busy = false;
      input.disabled = false;
      input.focus();
    });
  }

  function answerOffline(text, bug) {
    var a = offlineAnswer(text);
    if (a) {
      add("bot", a, bug ? reportButtons() : null);
    } else {
      add("bot", "Не зовсім зрозумів. Ось що я вмію:");
      quickButtons([
        { label: "Як встановити?" },
        { label: "Де налаштування?" },
        { label: "Як додати гаджет?" },
        { label: "Як змінити скін?" },
        { label: "Що нового?" },
        { label: "Помилка з гаджетом" }
      ]);
    }
    if (bug) {
      add("bot", "Опишіть детальніше: що робили, що очікували, що побачили, версія Windows. " +
                 "Якщо все - надішліть звіт кнопкою нижче.", reportButtons());
    }
    busy = false;
    input.disabled = false;
  }

  // --------------------------------------------------------------------- інтерфейс
  function build() {
    fab = el("button", "ai-fab");
    fab.id = "aiFab";
    fab.innerHTML = '<span class="ai-fab-dot"></span>Помічник';
    fab.title = "ИИ-помічник Vista Sidebar";
    fab.onclick = function () {
      panel.classList.toggle("ai-open");
      if (panel.classList.contains("ai-open")) {
        add("bot", "Привіт! Я помічник Vista Sidebar. Розкажіть, що хочете зробити або що зламалося - " +
                  "а якщо це баг, я оформлю звіт і надішлю розробникові.");
        quickButtons([
          { label: "Як встановити?" },
          { label: "Де налаштування?" },
          { label: "Як додати гаджет?" },
          { label: "Як змінити скін?" },
          { label: "Що нового?" },
          { label: "Помилка з гаджетом" }
        ]);
        input.focus();
      }
    };
    document.body.appendChild(fab);

    panel = el("div", "ai-panel");
    panel.id = "aiPanel";
    var head = el("div", "ai-head");
    head.innerHTML = '<span class="ai-title">' + escapeHtml(CFG.name || "Vista Sidebar · помічник") + "</span>";
    var close = el("button", "ai-x", "✕");
    close.onclick = function () { panel.classList.remove("ai-open"); };
    head.appendChild(close);
    panel.appendChild(head);

    statusEl = el("div", "ai-status", ENDPOINT ? "підключення..." : "офлайн · база знань");
    panel.appendChild(statusEl);

    log = el("div", "ai-log");
    panel.appendChild(log);

    quick = el("div", "ai-quick");
    panel.appendChild(quick);

    form = el("form", "ai-form");
    input = el("input", "ai-input");
    input.type = "text";
    input.placeholder = "Опишіть проблему або питання...";
    input.autocomplete = "off";
    var send = el("button", "ai-send", "➤");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    form.onsubmit = function (e) {
      e.preventDefault();
      var t = input.value;
      input.value = "";
      submitText(t);
    };
    panel.appendChild(form);
    document.body.appendChild(panel);

    if (!ENDPOINT) setStatus("офлайн · база знань", "off");
  }

  function init() {
    if (!document.body) return setTimeout(init, 100);
    build();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
