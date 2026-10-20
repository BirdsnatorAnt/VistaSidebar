/* ---------------------------------------------------------------------------
   Vista Sidebar - ИИ-помічник на сайті.

   Задача агента: вислухати проблему/баг, оформити ее в готовый отчет и
   отправить владельцу (через GitHub Issue - туда приходят уведомления).
   --------------------------------------------------------------------------- */
(function () {
  var OWNER_REPO = "BirdsnatorAnt/VistaSidebar";
  var APP_VERSION = "1.2";
  var KB = [
    {
      keys: ["встанов", "install", "постав", "запуст"],
      answer: "Установка проста: запусти windowsSidebarSetup.exe → Install. Програма стає в " +
              "C:\\Program Files\\Vista Sidebar, запускається разом з Windows і одразу показує " +
              "вікно «Віджети» з усіма гаджетами. Видалення - Панель керування → Програми та компоненти."
    },
    {
      keys: ["налашт", "config", "де зберіга", "дані", "config.txt"],
      answer: "Усі налаштування лежать у %APPDATA%\\VistaSidebar:\n" +
              "• config.txt - список віджетів на столі (формат: GadgetName, а другий «GadgetName#2»);\n" +
              "• settings\\<Гаджет>.txt - налаштування конкретного гаджета (напр. скін ЦП-метра);\n" +
              "• settings\\Clock_Gadget.txt - тема годинника (themeID)."
    },
    {
      keys: ["гаджет", "додати", "витяг", "перетяг", "панел", "вікно віджет"],
      answer: "Усі гаджети живуть у вікні «Віджети» (Ctrl+Alt+W або трей-меню). Там кожен гаджет - " +
              "плитка з іконкою. Перетягніть іконку на робочий стіл - віджет оживе на місці. " +
              "Подвійний клік по плитці теж створює віджет. Скільки завгодно однакових віджетів можна " +
              "поставити - кожен має власні налаштування. ПКМ по віджету: «Опції», «Зберегти іконку», " +
              "«Закрити віджет»."
    },
    {
      keys: ["скін", "шкім", "skin", "циферблат", "тема", "apple", "black", "pumpkin"],
      answer: "Скіни - у налаштуваннях самого гаджета: ПКМ по віджету → «Опції» → стрілки ◀ ▶ " +
              "та лічильник «1 з 9». У ЦП-метра 8 скінів (Стандартний, Apple, Black, Phantom, Blue, " +
              "Green, Red, Yellow), у годинника - 13 циферблатів, включно з новорічними " +
              "(3 різдвяні + гарбузова ніч). Перегляд показує гаджет у реальному вигляді."
    },
    {
      keys: ["нов", "оновлен", "changelog", "release", "верс"],
      answer: null // answered from the updates feed
    },
    {
      keys: ["швидк", "performance", "тормоз", "fps", "cpu"],
      answer: "Усі гаджети - нативні C++/GDI+, без браузера, тому вони майже не впливають на " +
              "продуктивність. Найважчі - погода, акції та слайдшоу (вони оновлюють дані з мережі)."
    },
    {
      keys: ["мови", "language", "ukrain", "ru", "переклад"],
      answer: "Мова інтерфейсу зараз англійська в діалогах гаджетів і українська у вікні «Віджети». " +
              "Повний український переклад усіх діалогів - у планах."
    }
  ];

  var BUG_WORDS = ["помилк", "баг", "не працю", "не работа", "крашит", "crash", "помилка", "вилет", "завис", "глюк", "не показу"];
  var DONE_WORDS = ["готово", "done", "все", "більше нічого", "закінчити"];

  var fab, panel, log, quick, input, form;
  var report = null;      // { title, steps, version, os }
  var mode = "chat";      // "chat" | "report"

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function add(who, text, buttons) {
    var row = el("div", "ai-msg ai-" + who);
    row.appendChild(el("div", "ai-bubble", escapeHtml(text).replace(/\n/g, "<br>")));
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

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function quickButtons(items) {
    quick.innerHTML = "";
    items.forEach(function (it) {
      var b = el("button", "ai-quick-btn", it.label);
      b.onclick = it.action || function () { submitText(it.label); };
      quick.appendChild(b);
    });
  }

  function has(text, words) {
    var t = text.toLowerCase();
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) >= 0) return true;
    return false;
  }

  function answer(text) {
    for (var i = 0; i < KB.length; i++) {
      if (has(text, KB[i].keys)) {
        if (KB[i].answer) return KB[i].answer;
        return updatesAnswer();
      }
    }
    return null;
  }

  function updatesAnswer() {
    var list = (window.VISTA_UPDATES || []);
    if (!list.length) return "Оновлень поки немає.";
    var out = "Останні оновлення:\n";
    list.slice(0, 2).forEach(function (u) {
      out += "• v" + u.version + " (" + u.date + ") - " + u.title + "\n";
      (u.items || []).slice(0, 3).forEach(function (i) { out += "   - " + i + "\n"; });
    });
    out += "Повний список - внизу сторінки.";
    return out;
  }

  function buildReport() {
    var r = report;
    var body = "**Проблема**\n\n" + (r.title || r.details) + "\n\n" +
               "**Кроки відтворення**\n\n" + (r.steps || "не описані") + "\n\n" +
               "**Версія Vista Sidebar:** " + r.version + "\n\n" +
               "**Windows:** " + r.os + "\n\n" +
               "_(Створено через ИИ-помічника на сайте)_\n";
    return body;
  }

  function openIssue() {
    var body = buildReport();
    var url = "https://github.com/" + OWNER_REPO + "/issues/new?title=" +
              encodeURIComponent("[баг] " + (report.title || "Проблема з гаджетом")) +
              "&body=" + encodeURIComponent(body);
    window.open(url, "_blank", "noopener");
  }

  function copyReport() {
    var text = buildReport();
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

  function startReport(text) {
    mode = "report";
    report = {
      title: text.length > 120 ? text.slice(0, 117) + "..." : text,
      steps: "", version: APP_VERSION, os: "Windows (не вказано)"
    };
    add("bot", "Зрозумів, це схоже на баг. Опишіть детальніше - що робили, що очікували і що " +
              "побачили замість цього. Якщо треба, додайте версію Windows (напр. Windows 11 23H2).",
        reportButtons());
    quickButtons([
      { label: "Вже описано, сформувати звіт" }
    ]);
  }

  function continueReport(text) {
    if (has(text, DONE_WORDS)) {
      add("bot", "Ось готовий звіт - надішліть його, і я візьму проблему в роботу:", reportButtons());
      return;
    }
    report.steps += (report.steps ? "\n" : "") + "- " + text;
    var os = text.match(/windows\s*\d+(\.\d+)?(\s*\w+)?/i);
    if (os) report.os = os[0];
    add("bot", "Записав. Далі ще щось важливе? Коли все - натисніть «Вже описано, сформувати звіт».",
        reportButtons());
  }

  function submitText(text) {
    text = (text || "").trim();
    if (!text) return;
    add("user", text);

    setTimeout(function () {
      if (mode === "report") { continueReport(text); return; }
      if (has(text, BUG_WORDS)) { startReport(text); return; }
      var a = answer(text);
      if (a) { add("bot", a); return; }
      add("bot", "Не зовсім зрозумів. Ось що я вмію:", null);
      quickButtons([
        { label: "Як встановити?" },
        { label: "Де налаштування?" },
        { label: "Як додати гаджет?" },
        { label: "Як змінити скін?" },
        { label: "Що нового?" },
        { label: "Помилка з гаджетом" }
      ]);
    }, 350);
  }

  function build() {
    fab = el("button", "ai-fab");
    fab.id = "aiFab";
    fab.innerHTML = '<span class="ai-fab-dot"></span>Помічник';
    fab.title = "ІІ-помічник Vista Sidebar";
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
      }
    };
    document.body.appendChild(fab);

    panel = el("div", "ai-panel");
    panel.id = "aiPanel";
    var head = el("div", "ai-head");
    head.innerHTML = '<span class="ai-title">Vista Sidebar · помічник</span>';
    var close = el("button", "ai-x", "✕");
    close.onclick = function () { panel.classList.remove("ai-open"); };
    head.appendChild(close);
    panel.appendChild(head);

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
  }

  function init() {
    if (!document.body) return setTimeout(init, 100);
    build();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
