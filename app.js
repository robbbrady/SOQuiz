(function () {
  "use strict";
  var STORE_KEY = "bbquiz.progress.v1";
  var PREF_KEY = "bbquiz.prefs.v1";
  var MIN_ATTEMPTS = 2;          // attempts before a topic is ranked
  var RECENT_SKIP = 6;           // don't repeat the last N questions

  var questions = [], byId = {}, categories = [];
  var progress = load(STORE_KEY, {});
  var prefs = load(PREF_KEY, { category: "All", mode: "random" });
  var view = "quiz";
  var current = null;            // {q, order, picked}
  var recent = [];
  var session = { right: 0, wrong: 0 };
  var app = document.getElementById("app");

  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v && typeof v === "object" ? v : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pct(c, w) { return c + w ? Math.round(100 * c / (c + w)) : null; }

  // ---------- selection ----------
  function weight(q, drill) {
    var p = progress[q.id];
    if (drill) {
      if (!p || p.w === 0) return 0;
      var net = p.w - p.c * 0.6;       // missed more than learned -> heavier
      return Math.max(0.3, net + 1);
    }
    if (!p) return 3;                  // unseen first
    var miss = p.w / (p.c + p.w);
    return 0.5 + 4 * miss;
  }
  function pool() {
    return questions.filter(function (q) { return prefs.category === "All" || q.category === prefs.category; });
  }
  function pick() {
    var drill = prefs.mode === "weak";
    var cand = pool();
    var weighted = cand.map(function (q) { return [q, weight(q, drill)]; }).filter(function (x) { return x[1] > 0; });
    if (!weighted.length) return null;
    var fresh = weighted.filter(function (x) { return recent.indexOf(x[0].id) < 0; });
    if (fresh.length) weighted = fresh;
    var total = weighted.reduce(function (s, x) { return s + x[1]; }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < weighted.length; i++) { r -= weighted[i][1]; if (r <= 0) return weighted[i][0]; }
    return weighted[weighted.length - 1][0];
  }

  // ---------- quiz view ----------
  function nextQuestion() {
    var q = pick();
    if (!q) { current = null; return; }
    var order = shuffle([0, 1, 2, 3]);
    current = { q: q, order: order, picked: null };
    recent.push(q.id); if (recent.length > RECENT_SKIP) recent.shift();
  }

  function renderQuiz() {
    app.textContent = "";
    var cats = ["All"].concat(categories);
    app.appendChild(el("div", { class: "card" }, [
      (function () {
        var sel = el("select", { "aria-label": "Category", class: "select", onchange: function () {
          prefs.category = sel.value; save(PREF_KEY, prefs); nextQuestion(); render(); } },
          cats.map(function (c) { return el("option", { value: c, text: c }); }));
        sel.value = prefs.category;
        return sel;
      })(),
      el("div", { class: "chips", style: "margin-top:10px", role: "group", "aria-label": "Mode" }, [
        el("button", { class: "chip" + (prefs.mode === "random" ? " on" : ""), text: "Random", onclick: function () {
          prefs.mode = "random"; save(PREF_KEY, prefs); nextQuestion(); render(); } }),
        el("button", { class: "chip" + (prefs.mode === "weak" ? " on" : ""), text: "Drill my weak spots", onclick: function () {
          prefs.mode = "weak"; save(PREF_KEY, prefs); nextQuestion(); render(); } })
      ])
    ]));

    if (!current) {
      var msg = prefs.mode === "weak"
        ? "No missed questions in this category yet. Nice! Switch to Random to keep practicing."
        : "No questions in this category.";
      app.appendChild(el("div", { class: "card" }, [el("p", { text: msg }),
        el("button", { class: "btn", text: "Switch to Random", onclick: function () {
          prefs.mode = "random"; save(PREF_KEY, prefs); nextQuestion(); render(); } })]));
      return;
    }

    var q = current.q, answered = current.picked !== null;
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "meta" }, [
      el("span", { text: q.category + " · " + q.topic }),
      el("span", { text: "Session: " + session.right + " ✓  " + session.wrong + " ✗" })
    ]));
    card.appendChild(el("p", { class: "q", text: q.question }));
    current.order.forEach(function (idx, pos) {
      var cls = "choice";
      if (answered) {
        if (idx === q.answerIndex) cls += " correct";
        else if (idx === current.picked) cls += " wrong";
      }
      var b = el("button", { class: cls, disabled: answered ? "disabled" : null, onclick: function () { answer(idx); } },
        [String.fromCharCode(65 + pos) + ".  " + q.choices[idx]]);
      if (!answered) b.removeAttribute("disabled");
      card.appendChild(b);
    });
    if (answered) {
      var ok = current.picked === q.answerIndex;
      card.appendChild(el("p", { class: "result " + (ok ? "good" : "bad"), text: ok ? "Correct!" : "Not quite." }));
      card.appendChild(el("p", { class: "explain", text: q.explanation }));
      card.appendChild(el("button", { class: "btn block", text: "Next question", onclick: function () { nextQuestion(); render(); window.scrollTo(0, 0); } }));
    }
    app.appendChild(card);
  }

  function answer(idx) {
    if (!current || current.picked !== null) return;
    current.picked = idx;
    var ok = idx === current.q.answerIndex;
    var p = progress[current.q.id] || { c: 0, w: 0, last: 0 };
    if (ok) { p.c++; session.right++; } else { p.w++; session.wrong++; }
    p.last = Date.now();
    progress[current.q.id] = p;
    save(STORE_KEY, progress);
    render();
  }

  // ---------- progress view ----------
  function group(keyFn) {
    var g = {};
    questions.forEach(function (q) {
      var k = keyFn(q);
      var x = g[k] || (g[k] = { name: k, total: 0, seen: 0, c: 0, w: 0, cat: q.category });
      x.total++;
      var p = progress[q.id];
      if (p) { x.seen++; x.c += p.c; x.w += p.w; }
    });
    return Object.keys(g).map(function (k) { return g[k]; });
  }
  function barEl(a) {
    var cls = a == null ? "" : a < 60 ? "low" : a < 80 ? "mid" : "";
    return el("div", { class: "bar " + cls }, [el("i", { style: "width:" + (a || 0) + "%" })]);
  }

  function renderProgress() {
    app.textContent = "";
    var tc = 0, tw = 0, seen = 0;
    questions.forEach(function (q) { var p = progress[q.id]; if (p) { tc += p.c; tw += p.w; seen++; } });
    var acc = pct(tc, tw);
    app.appendChild(el("div", { class: "card" }, [el("div", { class: "stats" }, [
      el("div", { class: "stat" }, [el("b", { text: acc == null ? "–" : acc + "%" }), el("span", { text: "overall accuracy" })]),
      el("div", { class: "stat" }, [el("b", { text: tc + tw }), el("span", { text: "answers (" + tc + " ✓ / " + tw + " ✗)" })]),
      el("div", { class: "stat" }, [el("b", { text: seen + "/" + questions.length }), el("span", { text: "questions seen" })])
    ])]));

    var cats = group(function (q) { return q.category; });
    var topics = group(function (q) { return q.topic; });

    // advice
    var adv = el("div", { class: "card" }, [el("h2", { text: "What to study next", style: "margin-top:0" })]);
    var ranked = topics.filter(function (t) { return t.c + t.w >= MIN_ATTEMPTS; })
      .map(function (t) { t.acc = pct(t.c, t.w); return t; })
      .filter(function (t) { return t.acc < 85; })
      .sort(function (a, b) { return a.acc - b.acc; }).slice(0, 5);
    var untouched = topics.filter(function (t) { return t.seen === 0; });
    if (!tc && !tw) {
      adv.appendChild(el("p", { class: "muted", text: "Answer a few questions and advice will show up here." }));
    } else {
      if (ranked.length) {
        adv.appendChild(el("p", { text: "Review these topics first. They have the lowest scores:" }));
        var ul = el("ul", { class: "plain" });
        ranked.forEach(function (t) {
          ul.appendChild(el("li", {}, [el("b", { text: t.name }), " (" + t.cat + ") — " + t.acc + "% over " + (t.c + t.w) + " answers"]));
        });
        adv.appendChild(ul);
      } else {
        var wc = cats.filter(function (c) { return c.c + c.w >= 3 && pct(c.c, c.w) < 85; })
          .sort(function (a, b) { return pct(a.c, a.w) - pct(b.c, b.w); }).slice(0, 3);
        if (wc.length) {
          adv.appendChild(el("p", { text: "Weakest categories so far: " + wc.map(function (c) { return c.name + " (" + pct(c.c, c.w) + "%)"; }).join(", ") + ". Keep answering to see which topics inside them need work." }));
        } else {
          adv.appendChild(el("p", { text: "No weak spots yet. Keep going." }));
        }
      }
      if (untouched.length) {
        adv.appendChild(el("p", { class: "small muted", text: "Not started: " + untouched.slice(0, 8).map(function (t) { return t.name; }).join(", ") +
          (untouched.length > 8 ? " and " + (untouched.length - 8) + " more" : "") + "." }));
      }
      if (ranked.length || tw) {
        adv.appendChild(el("button", { class: "btn", text: "Drill my weak spots", onclick: function () {
          prefs.mode = "weak"; prefs.category = "All"; save(PREF_KEY, prefs); nextQuestion(); setView("quiz"); } }));
      }
    }
    app.appendChild(adv);

    // by category
    var cc = el("div", { class: "card" }, [el("h2", { text: "By category", style: "margin-top:0" })]);
    cats.sort(function (a, b) { return categories.indexOf(a.name) - categories.indexOf(b.name); }).forEach(function (c) {
      var a = pct(c.c, c.w);
      cc.appendChild(el("div", { class: "cat" }, [
        el("div", { class: "line" }, [el("span", { text: c.name }),
          el("span", { class: "muted", text: (a == null ? "not started" : a + "%") + " · " + c.seen + "/" + c.total + " seen" })]),
        barEl(a)]));
    });
    app.appendChild(cc);

    // missed questions
    var missed = questions.filter(function (q) { var p = progress[q.id]; return p && p.w > 0 && p.w >= p.c; })
      .sort(function (a, b) { return progress[b.id].last - progress[a.id].last; });
    var md = el("details", { class: "card" }, [el("summary", { text: "Questions to review (" + missed.length + ")" })]);
    if (!missed.length) md.appendChild(el("p", { class: "muted", text: "Nothing here yet." }));
    missed.slice(0, 30).forEach(function (q) {
      md.appendChild(el("div", { class: "miss" }, [
        el("div", { text: q.question }),
        el("div", { class: "small", style: "color:var(--good)", text: "Answer: " + q.choices[q.answerIndex] }),
        el("div", { class: "small muted", text: q.explanation })]));
    });
    app.appendChild(md);

    // data tools
    var tools = el("div", { class: "card" }, [el("h2", { text: "Your data", style: "margin-top:0" }),
      el("p", { class: "small muted", text: "Progress is saved on this device only. Export to move it to another device." })]);
    var file = el("input", { type: "file", accept: "application/json", style: "display:none", onchange: importFile });
    tools.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn secondary", text: "Export", onclick: exportData }),
      el("button", { class: "btn secondary", text: "Import", onclick: function () { file.click(); } }),
      el("button", { class: "btn danger", text: "Reset", onclick: function () {
        if (confirm("Erase all progress on this device?")) { progress = {}; session = { right: 0, wrong: 0 }; save(STORE_KEY, progress); render(); } } })
    ]));
    tools.appendChild(file);
    app.appendChild(tools);
  }

  function exportData() {
    var blob = new Blob([JSON.stringify({ app: "bbquiz", version: 1, progress: progress }, null, 1)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "bbquiz-progress.json" });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function importFile(e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result), imp = d.progress, n = 0;
        if (!imp || typeof imp !== "object") throw new Error("bad file");
        Object.keys(imp).forEach(function (id) {
          var v = imp[id];
          if (!byId[id] || typeof v.c !== "number" || typeof v.w !== "number") return;
          var p = progress[id] || { c: 0, w: 0, last: 0 };
          // merge by keeping whichever record has more answers
          if (v.c + v.w > p.c + p.w) { progress[id] = { c: v.c, w: v.w, last: v.last || 0 }; }
          n++;
        });
        save(STORE_KEY, progress);
        alert("Imported " + n + " question records.");
        render();
      } catch (err) { alert("That file isn't a valid progress export."); }
    };
    r.readAsText(f);
  }

  // ---------- shell ----------
  function setView(v) { view = v; render(); }
  function render() {
    document.getElementById("tab-quiz").classList.toggle("active", view === "quiz");
    document.getElementById("tab-progress").classList.toggle("active", view === "progress");
    if (view === "quiz") renderQuiz(); else renderProgress();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
    b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
  });

  fetch("questions.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      questions = data;
      questions.forEach(function (q) { byId[q.id] = q; if (categories.indexOf(q.category) < 0) categories.push(q.category); });
      if (prefs.category !== "All" && categories.indexOf(prefs.category) < 0) prefs.category = "All";
      nextQuestion(); render();
    })
    .catch(function () {
      app.textContent = "Could not load questions.json. If you opened this file directly, serve it over http (see README).";
    });
})();
