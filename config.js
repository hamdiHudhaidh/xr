/* Shared settings for /in and /admin.
   XR_API is the Cloudflare Worker that stores teams and assignments.
   Set it to the deployed workers.dev URL, e.g. https://xr-admin-api.<subdomain>.workers.dev */
(function () {
  var API = "";
  var q = new URLSearchParams(location.search).get("api");
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (q && local) API = q; // test override, only when served locally
  window.XR_API = API.replace(/\/+$/, "");
  window.XR_SESSIONS = [
    ["16:15", "16:45"], ["17:30", "18:00"], ["18:30", "19:00"], ["19:15", "19:45"],
    ["20:00", "20:30"], ["20:45", "21:15"], ["21:30", "22:00"], ["22:15", "22:45"]
  ];
  window.XR_FIRST_DAY = "2026-11-12";
  window.XR_LAST_DAY = "2026-11-30";
  /* Resolve the team and people for one date + session from the stored data.
     data = { teams:[{id,name,people:[]}], daily:{ "1":teamId,... },
              days:{ "YYYY-MM-DD": { "1": teamId | "" } }, swaps:{ "YYYY-MM-DD|1": [{from,to}] } } */
  window.XR_resolve = function (data, ymd, s) {
    data = data || {};
    var key = String(s);
    var day = (data.days || {})[ymd] || {};
    var overridden = Object.prototype.hasOwnProperty.call(day, key);
    var teamId = overridden ? day[key] : ((data.daily || {})[key] || "");
    var team = (data.teams || []).find(function (t) { return t.id === teamId; }) || null;
    var swaps = ((data.swaps || {})[ymd + "|" + key] || []).filter(function (w) {
      return team && team.people.indexOf(w.from) >= 0;
    });
    var people = team ? team.people.map(function (p) {
      var w = swaps.find(function (x) { return x.from === p; });
      return w ? { name: w.to, swappedFrom: p } : { name: p };
    }) : [];
    return { team: team, overridden: overridden, swaps: swaps, people: people };
  };
})();
