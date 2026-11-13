/* Live date on the schedule poster (Asia/Riyadh), drawn where the old baked-in date was.
   Positions are poster pixels (1920x1080) inside #poster-box, which is sized to the poster.
   ?date=YYYY-MM-DD overrides the date for testing. */
(function () {
  var AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  var AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var EN_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  var EN_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  var sp = new URLSearchParams(location.search);
  var FONT = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && sp.get("font")) || "Cairo";

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(FONT) + ":wght@500;700;800&display=swap";
  document.head.appendChild(link);

  var css = document.createElement("style");
  css.textContent =
    "#poster-box{container-type:size}" +
    "#poster-date{position:absolute;left:0;width:100%;top:" + (149 / 10.8) + "%;text-align:center;pointer-events:none;" +
    "font-family:'" + FONT + "',system-ui,sans-serif;color:#fff}" +
    "#poster-date .ar{direction:rtl;font-weight:700;font-size:calc(34 / 1080 * 100cqh);line-height:calc(48 / 1080 * 100cqh)}" +
    "#poster-date .ar .star{color:#EAF04A;font-size:.8em;margin-inline-start:.3em;vertical-align:.1em}" +
    "#poster-date .en{font-weight:700;font-size:calc(17.5 / 1080 * 100cqh);letter-spacing:.12em;margin-top:calc(7 / 1080 * 100cqh);line-height:1}";
  document.head.appendChild(css);

  function ymdRiyadh() {
    var q = sp.get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  var el = null, shown = "";
  function render() {
    var box = document.getElementById("poster-box");
    if (!box) return;
    var ymd = ymdRiyadh();
    if (el && el.parentNode === box && ymd === shown) return;
    var d = new Date(ymd + "T12:00:00Z");
    var dow = d.getUTCDay(), day = d.getUTCDate(), mon = d.getUTCMonth();
    el = document.getElementById("poster-date") || document.createElement("div");
    el.id = "poster-date";
    el.innerHTML = "";
    var ar = document.createElement("div");
    ar.className = "ar";
    ar.textContent = AR_DAYS[dow] + " " + day + " " + AR_MONTHS[mon];
    var star = document.createElement("span");
    star.className = "star"; star.textContent = "✦";
    ar.appendChild(star);
    var en = document.createElement("div");
    en.className = "en";
    en.textContent = EN_DAYS[dow] + " · " + day + " " + EN_MONTHS[mon];
    el.appendChild(ar); el.appendChild(en);
    if (el.parentNode !== box) box.appendChild(el);
    shown = ymd;
  }
  window.XR_renderDate = render;
  render();
  setInterval(render, 60000);
})();
