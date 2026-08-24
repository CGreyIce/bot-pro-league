/* Bot Pro League — single-page app. Reads data.json and renders client-side. */
(() => {
"use strict";

let DATA = null;
const $ = (s, r=document) => r.querySelector(s);
const app = $("#app");

// ---------- helpers ----------
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = v => (v*100).toFixed(1) + "%";
const initials = n => (n||"?").replace(/[^A-Za-z0-9 ]/g,"").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase() || "?";
const teamBySlug = s => DATA.teams.find(t=>t.slug===s);
const teamByName = n => DATA.teams.find(t=>t.key===normKey(n));
const normKey = s => String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
function allPlayers(){ return [].concat(DATA.players.pro, DATA.players.amateur, DATA.players.solo); }
function playerBySlug(s){ return allPlayers().find(p=>p.slug===s); }

const TIER_VARS = {Champion:"--tier-champion",Grandmaster:"--tier-grandmaster",Master:"--tier-master",Emerald:"--tier-emerald",Diamond:"--tier-diamond",Platinum:"--tier-platinum",Gold:"--tier-gold",Silver:"--tier-silver",Bronze:"--tier-bronze",Iron:"--tier-iron"};
function tierColor(t){ return `var(${TIER_VARS[t]||"--muted"})`; }
function tierBadge(t){ if(!t) return '<span class="muted">—</span>'; return `<span class="tier"><span class="dot" style="background:${tierColor(t)}"></span>${esc(t)}</span>`; }
function ratingBadge(r){ if(r==null) return '<span class="muted">—</span>'; return `<span class="rating-badge">${r.toFixed(2)}</span>`; }
function teamLogo(t){ return t && t.logo ? `<img src="${esc(t.logo)}" alt="">` : ''; }
function teamCell(name){ const t=teamByName(name); if(!t) return `<span class="team-inline"><span class="muted">${esc(name||"—")}</span></span>`;
  return `<a class="team-inline" href="#/team/${t.slug}">${teamLogo(t)}<span>${esc(t.name)}</span></a>`; }
function rankDeltaBadge(t, since){
  const d = t.rankDelta||0; if(!d) return '';
  const up = d>0, n = Math.abs(d);
  return ` <span class="rank-delta ${up?'up':'down'}" title="${up?'Up':'Down'} ${n} place${n>1?'s':''} since ${since||'the last event'}">${up?'▲':'▼'}${n}</span>`;
}
function flag(iso){
  if(!iso) return '';
  if(iso==="neutral") return `<span class="flag flag-neutral" title="Land of Make Believe"></span>`;
  return `<img class="flag" src="https://flagcdn.com/20x15/${iso}.png" alt="${esc(iso)}" title="${esc(iso.toUpperCase())}" loading="lazy">`;
}
function playerLink(p){ return `${flag(p.iso)}<a href="#/player/${p.slug}">${esc(p.name)}</a>`; }

// ---------- roster hover popups ----------
let PAGE_ROSTERS = [];
function rosterIdx(row){ PAGE_ROSTERS.push(row); return PAGE_ROSTERS.length - 1; }
let _proSlugs = null;
function proSlugs(){  // slugs of players currently on a pro team roster
  if(!_proSlugs){ _proSlugs = new Set(); (DATA.teams||[]).forEach(t=>(t.roster||[]).forEach(p=>_proSlugs.add(p.slug))); }
  return _proSlugs;
}
function rosterPopHTML(row){
  const t = row.teamSlug ? teamBySlug(row.teamSlug) : null;
  const teamName = row.teamSlug ? `<a href="#/team/${row.teamSlug}">${esc(row.team)}</a>` : `<strong>${esc(row.team)}</strong>`;
  const head = `<div class="rp-head">${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}${teamName}<span class="rp-close" title="Close">×</span></div>`;
  const rows = (row.players||[]).map(p=>{
    const pro = p.slug && proSlugs().has(p.slug);  // teammate who is a current pro player
    const nm = p.slug ? `<a href="#/player/${p.slug}" class="${pro?'rp-pro':''}">${esc(p.name)}</a>` : `<span>${esc(p.name)}</span>`;
    const old = (p.hist && normKey(p.hist)!==normKey(p.name)) ? `<span class="rp-old">${esc(p.hist)}</span>` : '';
    return `<div class="rp-row">${flag(p.iso)}${nm}${p.captain?'<span class="rp-c" title="Captain">C</span>':''}${old}</div>`;
  }).join("");
  return head + rows;
}
let _pinned = false;
function setupRosterPop(){
  let pop = document.getElementById("roster-pop");
  if(!pop){ pop = document.createElement("div"); pop.id = "roster-pop"; pop.style.display="none"; document.body.appendChild(pop); }
  let hideT;
  const hide = ()=>{ if(_pinned) return; hideT = setTimeout(()=>{ pop.style.display="none"; }, 160); };
  const closePop = ()=>{ _pinned = false; pop.classList.remove("pinned"); pop.style.display="none"; };
  const show = el=>{
    clearTimeout(hideT);
    const row = PAGE_ROSTERS[+el.dataset.roster]; if(!row) return;
    pop.innerHTML = rosterPopHTML(row); pop.style.display="block";
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth || 220;
    let left = r.left + window.scrollX;
    if(left + w > window.scrollX + window.innerWidth - 10) left = window.scrollX + window.innerWidth - w - 10;
    pop.style.left = Math.max(6, left) + "px";
    pop.style.top = (window.scrollY + r.bottom + 6) + "px";
  };
  document.addEventListener("mouseover", e=>{
    if(_pinned) return;                       // don't swap the popup while pinned
    const el = e.target.closest("[data-roster]");
    if(el){ show(el); } else if(e.target.closest("#roster-pop")){ clearTimeout(hideT); }
  });
  document.addEventListener("mouseout", e=>{
    if(_pinned) return;
    if(e.target.closest("[data-roster]") || e.target.closest("#roster-pop")) hide();
  });
  // click a Career-Teams row to PIN the popup (so its player links are clickable)
  document.addEventListener("click", e=>{
    if(e.target.closest("#roster-pop .rp-close")){ closePop(); return; }
    if(e.target.closest("#roster-pop a")){ closePop(); return; }   // navigating away -> clear
    const trig = e.target.closest(".th-row[data-roster]");
    if(trig){ e.preventDefault(); show(trig); _pinned = true; pop.classList.add("pinned"); return; }
    if(_pinned && !e.target.closest("#roster-pop")) closePop();     // click elsewhere closes it
  });
}

// event tier classifier (from tournament name)
function eventTier(name){
  const n=name.toLowerCase();
  if(/challengers stage|legends stage|conquerors stage/.test(n)) return {c:"et-major",t:"MAJOR"};
  if(/bot pro cup|audax esse|ranking reshuffle|\bsrr\b|major srr/.test(n)) return {c:"et-s",t:"S-TIER"};
  if(/minor|battle of tuscan|minor league/.test(n)) return {c:"et-a",t:"A-TIER"};
  return {c:"et-a",t:"A-TIER"};
}

// ---------- router ----------
const routes = {
  "": renderHome, "home": renderHome,
  "teams": renderTeams, "team": renderTeam,
  "players": renderPlayers, "player": renderPlayer,
  "tournaments": renderTournaments, "tournament": renderTournament,
  "rankings": renderRankings,
  "results": renderResults, "records": renderRecords, "compare": renderCompare,
  "transfers": renderTransfers, "matches": renderMatches, "awards": renderAwards, "maps": renderMaps,
  "compareteams": renderTeamCompare, "stats": renderStats,
  "admin": renderAdmin, "match": renderMatch,
};
function parseHash(){
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(x=>x!=="");
  return { route: parts[0]||"home", arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function router(){
  const {route, arg} = parseHash();
  const fn = routes[route] || renderHome;
  window.scrollTo(0,0);
  PAGE_ROSTERS = [];
  fn(arg);
  document.querySelectorAll(".mainnav a").forEach(a=>{
    const map={team:"teams",player:"players",tournament:"tournaments"};
    a.classList.toggle("active", a.dataset.route === (map[route]||route));
  });
}

// ================= PAGES =================
function renderHome(){
  const teams = DATA.teams;
  const top3 = teams.slice(0,3);
  const podium = `<div class="podium">${
    [top3[1],top3[0],top3[2]].map((t,i)=>{
      const cls = t===top3[0]?"p1":t===top3[1]?"p2":"p3";
      return `<a class="pcard ${cls}" href="#/team/${t.slug}">
        <div class="rankno">#${t.rank}</div>${teamLogo(t)?`<img src="${esc(t.logo)}" alt="">`:''}
        <div class="pname">${esc(t.name)} ${t.star?'<span class="star">★</span>':''}</div>
        <div class="ppts">${t.rank_points} pts</div></a>`;
    }).join("")}</div>`;

  const rankRows = teams.slice(0,10).map(t=>`<tr>
      <td class="rankcol">${t.rank}</td>
      <td class="name-cell">${teamCell(t.name)}</td>
      <td class="mono">${t.rank_points}</td>
      <td class="mono">${t.map_wins}-${t.map_losses}</td>
      <td class="mono">${pct(t.wlr)}</td>
      <td class="mono">${t.major_wins?('<span class="star">★</span>'+t.major_wins):'–'}</td>
    </tr>`).join("");

  const pro = DATA.players.pro.filter(p=>p.rating!=null);
  const leader = (title, arr, fmt) => `<div class="leader-card"><h4>${title}</h4>${
    arr.map((p,i)=>`<div class="leader-row"><span class="lr-rank">${i+1}</span>
      <span class="lr-name">${playerLink(p)}</span><span class="lr-val">${fmt(p)}</span></div>`).join("")}</div>`;
  const byRating = [...pro].sort((a,b)=>b.rating-a.rating).slice(0,5);
  const byKills  = [...pro].sort((a,b)=>b.kills-a.kills).slice(0,5);
  const byKdr    = [...pro].sort((a,b)=>b.kdr-a.kdr).slice(0,5);
  const byMvp    = [...pro].sort((a,b)=>b.mvp-a.mvp).slice(0,5);

  app.innerHTML = `
    <div class="grid home-grid">
      <div>
        <h2 class="section-title"><span class="accent-bar"></span>Top Teams</h2>
        ${podium}
        <div class="tablewrap"><table class="data">
          <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th>
            <th class="no-sort">Pts</th><th class="no-sort">Map W-L</th><th class="no-sort">WLR</th><th class="no-sort">Majors</th></tr></thead>
          <tbody>${rankRows}</tbody></table></div>
        <div style="margin-top:10px"><a href="#/teams" class="muted">View full ranking →</a></div>
      </div>
      <div>
        ${(DATA.tournaments&&DATA.tournaments.length)?`
        <h2 class="section-title"><span class="accent-bar"></span>Latest Results</h2>
        <div class="leader-card" style="margin-bottom:18px">
          ${DATA.tournaments.slice(0,6).map(tr=>`<div class="leader-row" style="align-items:center">
            <span class="event-tier ${TIER_CLASS[tr.tier]}" style="margin-right:8px">${esc(tr.tierLabel[0]==='M'?'MAJ':tr.tierLabel[0]==='S'?'S':'A')}</span>
            <a class="lr-name" href="#/tournament/${tr.slug}" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tr.name)}</a>
            <span class="lr-val" style="font-size:12px">${esc(tr.champion||'')}</span></div>`).join("")}
          <div style="margin-top:8px"><a href="#/tournaments" class="muted" style="font-size:12px">All tournaments →</a></div>
        </div>`:''}
        <h2 class="section-title"><span class="accent-bar"></span>Stat Leaders <span class="muted" style="font-size:11px">(pro)</span></h2>
        <div class="leaders">
          ${leader("BPL Rating", byRating, p=>p.rating.toFixed(2))}
          ${leader("Total Kills", byKills, p=>p.kills)}
          ${leader("K/D Ratio", byKdr, p=>p.kdr.toFixed(2))}
          ${leader("MVPs", byMvp, p=>p.mvp)}
        </div>
      </div>
    </div>`;
}

function renderTeams(){
  const cols = [
    ["#", t=>t.rank, "rankcol"],
    ["Team", t=>`<span class="tm-rank">${teamCell(t.name)}${t.star?' <span class="star" title="Major winner">★</span>':''}${rankDeltaBadge(t)}</span>`, "name-cell", t=>t.name],
    ["Pts", t=>t.rank_points, "mono"],
    ["Maps", t=>t.total_maps, "mono"],
    ["W-L-T", t=>`${t.map_wins}-${t.map_losses}-${t.map_ties}`, "mono", t=>t.map_wins],
    ["WLR", t=>pct(t.wlr), "mono", t=>t.wlr],
    ["A", t=>t.a_tier_wins, "mono"],
    ["S", t=>t.s_tier_wins, "mono"],
    ["Major", t=>t.major_wins, "mono"],
    ["Podiums", t=>t.podiums, "mono"],
    ["Events", t=>t.events_played, "mono"],
  ];
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Team Ranking · ${DATA.teams.length} pro teams
      <a href="#/compareteams" class="muted" style="margin-left:auto;font-size:12px">⇄ Compare teams</a></h2>
    ${sortableTable(DATA.teams, cols, "rank")}`;
}

function renderTeam(slug){
  const t = teamBySlug(slug);
  if(!t){ app.innerHTML = notFound("Team"); return; }
  const roster = t.roster||[];
  const rosterHtml = roster.map(p=>`<a class="pcard-mini" href="#/player/${p.slug}">
      <div class="avatar">${initials(p.name)}</div>
      <div><div class="pm-name">${flag(p.iso)}${esc(p.name)}</div>
      <div class="pm-sub">${esc(p.role||'—')} · ${p.rating?p.rating.toFixed(2):'—'} ${p.tier?'· '+esc(p.tier):''}</div></div>
    </a>`).join("");

  const stat = (v,l,acc)=>`<div class="stat${acc?' accent':''}"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;

  // playoff timeline
  let playoffHtml = '<p class="muted">No playoff history recorded.</p>';
  if(t.playoffs && Object.keys(t.playoffs).length){
    const years = [...new Set(Object.values(t.playoffs).flatMap(o=>Object.keys(o)))].sort();
    const rows = Object.entries(t.playoffs).map(([label,yrs])=>{
      const cells = years.map(y=>{
        const v = yrs[y];
        if(!v) return '<td class="no">–</td>';
        if(/won/i.test(v)) return '<td class="won">WON</td>';
        return '<td class="yes">✓</td>';
      }).join("");
      return `<tr><td style="text-align:left;font-weight:600">${esc(label)}</td>${cells}</tr>`;
    }).join("");
    playoffHtml = `<div class="tablewrap"><table class="playoff-table">
      <thead><tr><th style="text-align:left">Competition</th>${years.map(y=>`<th>${y}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  const trophies = [];
  if(t.major_wins) trophies.push(`${t.major_wins}× Major`);
  if(t.s_tier_wins) trophies.push(`${t.s_tier_wins}× S-Tier`);
  if(t.a_tier_wins) trophies.push(`${t.a_tier_wins}× A-Tier`);

  app.innerHTML = `
    <div class="crumb"><a href="#/teams">Teams</a><span class="sep">/</span>${esc(t.name)}</div>
    <div class="profile-head">
      ${t.logo?`<img class="crest" src="${esc(t.logo)}" alt="">`:''}
      <div class="ph-main">
        <h1>${t.originIso?`<span class="th-flag" title="${esc(t.originCountry||'')}">${flag(t.originIso)}</span>`:''}${esc(t.name)} ${t.star?'<span class="star" title="Major winner">★</span>':''} ${t.tag?`<span class="tag">${esc(t.tag)}</span>`:''}</h1>
        <div class="ph-sub">${t.region?`<span class="th-region">${esc(t.region)}</span>`:''}${t.origin?(' · Earned pro status: '+esc(t.origin)):''}${t.notes?` · <span class="muted">${esc(t.notes)}</span>`:''}</div>
      </div>
      <div class="ph-rank"><div class="big">#${t.rank}</div><div class="lbl">BPL Rank</div></div>
      <div class="ph-rank"><div class="big">${t.rank_points}</div><div class="lbl">Points</div></div>
    </div>
    ${t.bio?`<div class="player-bio">${esc(t.bio)}</div>`:''}

    <div class="profile-grid">
      <div class="infobox">
        <div class="ib-title">Team Info</div>
        <div class="ib-row"><span class="k">Tag</span><span class="v">${esc(t.tag||'—')}</span></div>
        <div class="ib-row"><span class="k">BPL Rank</span><span class="v">#${t.rank} · ${t.rank_points} pts</span></div>
        <div class="ib-row"><span class="k">Region</span><span class="v">${t.region?esc(t.region):'—'}</span></div>
        <div class="ib-row"><span class="k">Country</span><span class="v">${t.originIso?`${flag(t.originIso)} ${esc(t.originCountry||'')}`:'—'}</span></div>
        <div class="ib-row"><span class="k">Origin</span><span class="v">${esc(t.origin||'—')}</span></div>
        <div class="ib-row"><span class="k">Map record</span><span class="v">${t.map_wins}-${t.map_losses}-${t.map_ties}</span></div>
        <div class="ib-row"><span class="k">Win rate</span><span class="v">${pct(t.wlr)}</span></div>
        <div class="ib-row"><span class="k">Events played</span><span class="v">${t.events_played}</span></div>
        <div class="ib-row"><span class="k">Podiums</span><span class="v">${t.podiums} (${t.major_podiums} major)</span></div>
        <div class="ib-row"><span class="k">Trophies</span><span class="v">${trophies.length?esc(trophies.join(' · ')):'—'}</span></div>
      </div>
      <div>
        <div class="statgrid">
          ${stat(t.total_maps,"Maps Played")}
          ${stat(pct(t.wlr),"Win Rate",true)}
          ${stat(t.major_wins,"Major Titles")}
          ${stat(t.major_playoffs,"Major Playoffs")}
        </div>
        ${(t.recentResults&&t.recentResults.length)?`
        <h2 class="section-title"><span class="accent-bar"></span>Recent Form
          ${t.streak?`<span class="streak ${t.streak[0]==='W'?'sw':'sl'}">${t.streak[0]}${t.streak.slice(1)} streak</span>`:''}</h2>
        <div class="formrow">${t.recentResults.map(r=>{
          const title = `${r.result==='W'?'Won':'Lost'} vs ${esc(r.opp||'?')}${r.sf!=null?` (${r.sf}-${r.sa})`:''} · ${esc(r.event)}`;
          return `<a class="formpill ${r.result==='W'?'fw':'fl'}" href="#/tournament/${r.eventSlug}" title="${title}">${r.result}</a>`;
        }).join("")}</div>`:''}
        <h2 class="section-title"><span class="accent-bar"></span>Roster</h2>
        <div class="roster">${rosterHtml||'<p class="muted">No roster on record.</p>'}</div>
        ${(t.formerPlayers&&t.formerPlayers.length)?`
        <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Former Players
          <span class="muted" style="font-size:11px">(${t.formerPlayers.length})</span></h2>
        <div class="roster">${t.formerPlayers.map(f=>{
          const yrs = f.years&&f.years.length ? (f.years.length>1?`${f.years[0]}–${f.years[f.years.length-1]}`:f.years[0]) : '';
          const now = f.nowTeam ? esc(f.nowTeam) : 'Teamless';
          return `<a class="pcard-mini former" href="#/player/${f.slug}">
            <div class="avatar">${initials(f.name)}</div>
            <div><div class="pm-name">${flag(f.iso)}${esc(f.name)}</div>
            <div class="pm-sub">${yrs?esc(yrs)+' · ':''}now: ${now}</div></div>
          </a>`;}).join("")}</div>`:''}
        ${(t.events&&t.events.length)?(()=>{
          const pb={}; (t.points_breakdown||[]).forEach(b=>pb[b.slug]=(pb[b.slug]||0)+b.points);
          return `
        <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Tournament Results <span class="muted" style="font-size:11px">(${t.events.length})</span></h2>
        <div class="tablewrap"><table class="data">
          <thead><tr><th class="no-sort">Date</th><th class="no-sort">Tier</th><th class="no-sort">Event</th><th class="no-sort">Placement</th><th class="no-sort" title="Ranking points earned (tier-weighted, recency-faded)">Pts</th></tr></thead>
          <tbody>${t.events.map(e=>`<tr>
            <td class="mono">${fmtDate(e.date)}</td>
            <td><span class="event-tier ${TIER_CLASS[e.tier]}">${esc(e.tierLabel.toUpperCase())}</span></td>
            <td class="name-cell"><a href="#/tournament/${e.slug}">${esc(e.name)}</a></td>
            <td>${e.isChampion?'<span class="star">★</span> <strong>Champion</strong>':'#'+e.placement}</td>
            <td class="mono" style="color:var(--accent)">${pb[e.slug]!=null?'+'+Math.round(pb[e.slug]):'—'}</td>
          </tr>`).join("")}</tbody></table></div>`;})():''}
        <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Playoff & S-Tier History</h2>
        ${playoffHtml}
        ${(t.h2h&&t.h2h.length)?`
        <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Head-to-Head <span class="muted" style="font-size:11px">(all-time, vs pro teams)</span></h2>
        <div class="tablewrap" style="max-height:360px;overflow-y:auto"><table class="data">
          <thead><tr><th class="no-sort">Opponent</th><th class="no-sort">W</th><th class="no-sort">L</th><th class="no-sort">Win%</th></tr></thead>
          <tbody>${t.h2h.map(h=>{const tot=h.w+h.l,wr=tot?Math.round(h.w/tot*100):0;
            return `<tr><td class="name-cell">${teamCell(h.oppName)}</td>
              <td class="mono" style="color:var(--good)">${h.w}</td>
              <td class="mono" style="color:var(--accent2)">${h.l}</td>
              <td class="mono">${wr}%</td></tr>`;}).join("")}</tbody></table></div>`:''}
      </div>
    </div>`;
}

let playersPool = "pro", playersSort = {key:"Rating", dir:-1};
function renderPlayers(){
  const pool = playersPool;
  const players = DATA.players[pool];
  const cols = [
    ["#", (p,i)=>i+1, "rankcol"],
    ["Player", p=>`<span class="tm-rank">${playerLink(p)}${playersSort.key==="Rating"?rankDeltaBadge(p,"their last match"):''}</span>`, "name-cell", p=>p.name],
    ["Team", p=>teamCell(p.team), "", p=>p.team],
    ["Role", p=>p.role?`<span class="pill role-pill">${esc(p.role)}</span>`:'—', "", p=>p.role],
    ["Rating", p=>ratingBadge(p.rating), "mono", p=>p.rating==null?-1:p.rating],
    ["Tier", p=>tierBadge(p.tier), "", p=>p.rating==null?-1:p.rating],
    ["Lvl", p=>p.level?`<span class="levelchip">${p.level}</span>`:'—', "mono", p=>p.level||0],
    ["K", p=>p.kills, "mono"],
    ["D", p=>p.deaths, "mono"],
    ["KDR", p=>p.kdr.toFixed(2), "mono", p=>p.kdr],
    ["MVP", p=>p.mvp, "mono"],
    ["Maps", p=>p.maps, "mono"],
    ["Win%", p=>pct(p.winrate), "mono", p=>p.winrate],
  ];
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Player Leaderboard
      <a href="#/compare" class="muted" style="margin-left:auto;font-size:12px">⇄ Compare players</a></h2>
    <div class="tabs">
      ${["pro","amateur","solo"].map(k=>`<button data-pool="${k}" class="${k===pool?'active':''}">${
        k==="pro"?"Pro":k==="amateur"?"Amateur":"Solo Queue"} <span style="opacity:.7">${DATA.players[k].length}</span></button>`).join("")}
    </div>
    <div id="ptable"></div>`;
  app.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{playersPool=b.dataset.pool;playersSort={key:"Rating",dir:-1};renderPlayers();});
  drawPlayerTable(players, cols);
}
function drawPlayerTable(players, cols){
  const sorted = sortData([...players], cols, playersSort);
  $("#ptable").innerHTML = tableHtml(sorted, cols, playersSort);
  wireSort($("#ptable"), players, cols, playersSort, (s)=>{playersSort=s;drawPlayerTable(players,cols);});
}

function renderPlayer(slug){
  const p = playerBySlug(slug);
  if(!p){ app.innerHTML = notFound("Player"); return; }
  const t = teamByName(p.team);
  const stat = (v,l,acc)=>`<div class="stat${acc?' accent':''}"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;
  const poolName = p.pool==="pro"?"Pro Circuit":p.pool==="amateur"?"Amateur":"Solo Queue";
  app.innerHTML = `
    <div class="crumb"><a href="#/players">Players</a><span class="sep">/</span>${esc(p.name)}</div>
    <div class="profile-head">
      <div class="avatar" style="width:88px;height:88px;border-radius:14px;font-size:34px">${initials(p.name)}</div>
      <div class="ph-main">
        <h1>${flag(p.iso)}${esc(p.name)}</h1>
        <div class="ph-sub">${p.nat?esc(p.nat)+' · ':''}${p.role?esc(p.role)+' · ':''}${t?`<a href="#/team/${t.slug}" style="color:var(--link)">${esc(t.name)}</a>`:esc(p.team||'Teamless')} · ${poolName}</div>
        <div style="margin-top:10px">${tierBadge(p.tier)} ${p.level?`<span class="levelchip">Lvl ${p.level}</span>`:''}</div>
      </div>
      <div class="ph-rank"><div class="big">${p.rating!=null?p.rating.toFixed(2):'—'}</div><div class="lbl">BPL Rating</div></div>
    </div>
    ${p.bio?`<div class="player-bio">${esc(p.bio)}</div>`:''}
    <div class="profile-grid">
      <div class="profile-side">
      <div class="infobox">
        <div class="ib-title">Player Info</div>
        ${p.aka&&p.aka.length?`<div class="ib-row"><span class="k">Also known as</span><span class="v" style="font-size:12px">${p.aka.map(esc).join(', ')}</span></div>`:''}
        <div class="ib-row"><span class="k">Team</span><span class="v">${t?`<a href="#/team/${t.slug}" style="color:var(--link)">${esc(t.name)}</a>`:esc(p.team||'—')}</span></div>
        <div class="ib-row"><span class="k">Role</span><span class="v">${esc(p.role||'—')}</span></div>
        <div class="ib-row"><span class="k">Pool</span><span class="v">${poolName}</span></div>
        <div class="ib-row"><span class="k">BPL Rating</span><span class="v">${p.rating!=null?p.rating.toFixed(2):'—'}</span></div>
        <div class="ib-row"><span class="k">Tier</span><span class="v">${p.tier?esc(p.tier):'—'}</span></div>
        <div class="ib-row"><span class="k">Level</span><span class="v">${p.level||'—'} / 10</span></div>
        <div class="ib-row"><span class="k">Record</span><span class="v">${p.wins}-${p.losses} (${pct(p.winrate)})</span></div>
        <div class="ib-row"><span class="k">Maps</span><span class="v">${p.maps}</span></div>
      </div>
      ${(p.teamHistory&&p.teamHistory.length)?`
      <div class="infobox teamhist">
        <div class="ib-title">Career Teams</div>
        ${p.teamHistory.map(th=>{
          const tm = th.teamSlug ? teamBySlug(th.teamSlug) : null;
          const logo = tm&&tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : '';
          const nm = th.teamSlug
            ? `<a class="team-inline th-pro" href="#/team/${th.teamSlug}">${logo}<span>${esc(th.team)}</span></a>`
            : `<span class="th-am">${esc(th.team)}</span>`;
          const ridx = (th.roster&&th.roster.length) ? rosterIdx({team:th.team, teamSlug:th.teamSlug, players:th.roster}) : null;
          const dr = ridx!=null ? ` data-roster="${ridx}"` : '';
          return `<div class="th-row"${dr}>${nm}<span class="th-years">${th.years.join(', ')}</span></div>`;
        }).join("")}
      </div>` : ''}
      </div>
      <div>
        ${p.soloStats?`<h2 class="section-title" style="margin-top:0"><span class="accent-bar"></span>Tournament
          <span class="muted" style="font-size:11px">S-Tier &amp; Major</span></h2>`:''}
        <div class="statgrid">
          ${stat(p.kills,"Kills")}
          ${stat(p.deaths,"Deaths")}
          ${stat(p.kdr.toFixed(2),"K/D Ratio",true)}
          ${stat(p.mvp,"MVPs")}
          ${stat(p.assists,"Assists")}
          ${stat((p.kills/Math.max(1,p.maps)).toFixed(1),"Kills / Map")}
          ${stat(p.ot,"OT Played")}
          ${stat(pct(p.winrate),"Win Rate")}
        </div>
        ${p.soloStats?(()=>{const s=p.soloStats;return `
        <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Solo Queue
          <span class="muted" style="font-size:11px">${esc(s.tier||'')}${s.rating!=null?' · '+s.rating.toFixed(2)+' rating':''}${s.soloRank?' · #'+s.soloRank+' of '+s.soloTotal:''}</span></h2>
        <div class="statgrid">
          ${stat(s.kills,"Kills")}
          ${stat(s.deaths,"Deaths")}
          ${stat(s.kdr.toFixed(2),"K/D Ratio",true)}
          ${stat(s.mvp,"MVPs")}
          ${stat(s.assists,"Assists")}
          ${stat((s.kills/Math.max(1,s.maps)).toFixed(1),"Kills / Map")}
          ${stat(s.wins+'-'+s.losses,"Record")}
          ${stat(pct(s.winrate),"Win Rate")}
        </div>`;})():''}
        ${(p.titles&&p.titles.length)||(p.mvpAwards&&p.mvpAwards.length)?`
        <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Honors
          <span class="muted" style="font-size:11px">${p.titles?p.titles.length+'× champion':''}${p.mvpAwards&&p.mvpAwards.length?(p.titles&&p.titles.length?' · ':'')+p.mvpAwards.length+'× MVP':''}</span></h2>
        <div class="honors">
          ${(p.titles||[]).map(tt=>`<a class="honor" href="#/tournament/${tt.slug}">
             <span class="honor-ico">🏆</span>
             <span class="honor-body"><span class="honor-ev">${esc(tt.event)}</span>
             <span class="honor-sub"><span class="event-tier ${TIER_CLASS[tt.tier]}">${esc(tt.tierLabel.toUpperCase())}</span> ${tt.year} · ${esc(tt.team)}</span></span></a>`).join("")}
          ${(p.mvpAwards||[]).map(a=>`<a class="honor" href="#/tournament/${a.slug}">
             <span class="honor-ico">⭐</span>
             <span class="honor-body"><span class="honor-ev">${esc(a.event)}</span>
             <span class="honor-sub">Event MVP · ${a.year}</span></span></a>`).join("")}
        </div>`:''}
        <div class="notice" style="text-align:left;margin-top:18px">
          <strong>BPL Rating ${p.rating!=null?p.rating.toFixed(2):'—'}</strong> — normalized within the ${poolName.toLowerCase()} pool
          (1.00 = pool average). Weighted: 40% K/D, 30% kills/map, 15% MVP impact, 10% assists, 5% win rate,
          with small-sample shrinkage. ${t?`Ranks ${p.rating!=null?ratingRankInPool(p):''} in the pool.`:''}
        </div>
      </div>
    </div>`;
}
function ratingRankInPool(p){
  const arr = DATA.players[p.pool].filter(x=>x.rating!=null).sort((a,b)=>b.rating-a.rating);
  const i = arr.findIndex(x=>x.slug===p.slug);
  return i>=0?`#${i+1} of ${arr.length}`:'';
}

function renderRankings(){
  const pro = DATA.players.pro.filter(p=>p.rating!=null);
  const board = (title, arr, fmt, delta=false) => {
    const rows = arr.map((p,i)=>`<tr><td class="rankcol">${i+1}</td>
      <td class="name-cell"><span class="tm-rank">${playerLink(p)}${delta?rankDeltaBadge(p,"their last match"):''}</span></td><td>${teamCell(p.team)}</td>
      <td class="mono" style="color:var(--accent);font-weight:700">${fmt(p)}</td></tr>`).join("");
    return `<div class="panel" style="padding:0;overflow:hidden">
      <div class="ib-title" style="padding:10px 14px">${title}</div>
      <div class="tablewrap" style="border:0"><table class="data"><tbody>${rows}</tbody></table></div></div>`;
  };
  const top = (key,n=10)=>[...pro].sort((a,b)=>b[key]-a[key]).slice(0,n);
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Team Points Ladder</h2>
    <div class="tablewrap"><table class="data">
      <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th><th class="no-sort">Points</th>
        <th class="no-sort">Majors</th><th class="no-sort">S-Tier</th><th class="no-sort">Events</th></tr></thead>
      <tbody>${DATA.teams.map(t=>`<tr><td class="rankcol">${t.rank}</td><td class="name-cell"><span class="tm-rank">${teamCell(t.name)}${rankDeltaBadge(t)}</span></td>
        <td class="mono" style="color:var(--accent);font-weight:700">${t.rank_points}</td>
        <td class="mono">${t.major_wins||'–'}</td><td class="mono">${t.s_tier_wins||'–'}</td><td class="mono">${t.events_played}</td></tr>`).join("")}</tbody></table></div>
    <h2 class="section-title" style="margin-top:26px"><span class="accent-bar"></span>Player Leaderboards <span class="muted" style="font-size:11px">(pro)</span></h2>
    <div class="grid" style="grid-template-columns:repeat(2,1fr)">
      ${board("BPL Rating", top("rating"), p=>p.rating.toFixed(2), true)}
      ${board("Total Kills", top("kills"), p=>p.kills)}
      ${board("K/D Ratio", top("kdr"), p=>p.kdr.toFixed(2))}
      ${board("MVPs", top("mvp"), p=>p.mvp)}
      ${board("Assists", top("assists"), p=>p.assists)}
      ${board("Win Rate", top("winrate"), p=>pct(p.winrate))}
    </div>`;
}

// ---------- Results feed ----------
let _allMatches = null;
function allMatches(){
  if(_allMatches) return _allMatches;
  const out = [];
  (DATA.tournaments||[]).forEach(tr=>tr.bracket.forEach(rd=>rd.matches.forEach(m=>{
    if(m.w!==1 && m.w!==2) return;
    if(m.a==="(bye)" || m.b==="(bye)") return;      // a bye isn't a played match
    out.push({date:tr.date, event:tr.name, eventSlug:tr.slug, tier:tr.tier, tierLabel:tr.tierLabel,
      round:rd.title, a:m.a, aTeam:m.aTeam, sa:m.sa, b:m.b, bTeam:m.bTeam, sb:m.sb, w:m.w, ts:m.ts});
  })));
  // newest event date first; within the same date, most recently recorded (ts) first
  out.sort((x,y)=> x.date<y.date?1 : x.date>y.date?-1 : (y.ts||0)-(x.ts||0));
  _allMatches = out; return out;
}
let resultsFilter = {tier:"all", q:""}, resultsShown = 100;
function renderResults(){
  let list = allMatches();
  if(resultsFilter.tier!=="all") list = list.filter(m=>m.tier===resultsFilter.tier);
  if(resultsFilter.q){ const q=resultsFilter.q.toLowerCase();
    list = list.filter(m=>(m.a||"").toLowerCase().includes(q)||(m.b||"").toLowerCase().includes(q)); }
  const shown = list.slice(0, resultsShown);
  const teamHtml = (name, slug, win) => {
    const tm = slug ? teamBySlug(slug) : null;
    const logo = tm&&tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : '';
    const nm = slug ? `<a href="#/team/${slug}">${esc(name||'?')}</a>` : esc(name||'?');
    return `<span class="team-inline ${win?'rwin':''}">${logo}<span>${nm}</span></span>`;
  };
  const rows = shown.map(m=>`<tr>
      <td class="mono muted">${fmtDate(m.date)}</td>
      <td><span class="event-tier ${TIER_CLASS[m.tier]}">${esc(m.tierLabel.toUpperCase())}</span></td>
      <td style="text-align:right">${teamHtml(m.a,m.aTeam,m.w===1)}</td>
      <td class="mono rscore">${m.sa!=null?m.sa:''} <span class="muted">:</span> ${m.sb!=null?m.sb:''}</td>
      <td>${teamHtml(m.b,m.bTeam,m.w===2)}</td>
      <td class="name-cell"><a href="#/tournament/${m.eventSlug}" class="muted" style="font-size:12px">${esc(m.event)}</a></td>
    </tr>`).join("");
  const tab=(k,l)=>`<button data-rt="${k}" class="${k===resultsFilter.tier?'active':''}">${l}</button>`;
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Results <span class="muted" style="font-size:11px">(${list.length} matches)</span></h2>
    <div class="tabs" style="align-items:center">
      ${tab("all","All")}${tab("major","Majors")}${tab("s","S-Tier")}${tab("a","A-Tier")}
      <input id="results-q" class="rq" type="text" placeholder="Filter by team…" value="${esc(resultsFilter.q)}">
    </div>
    <div class="tablewrap"><table class="data results-table"><tbody>${rows}</tbody></table></div>
    ${shown.length<list.length?`<div style="text-align:center;margin-top:14px"><button id="results-more" class="loadmore">Load more (${list.length-shown.length} left)</button></div>`:''}`;
  app.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{resultsFilter.tier=b.dataset.rt;resultsShown=100;renderResults();});
  const qi=$("#results-q"); if(qi) qi.oninput=()=>{resultsFilter.q=qi.value.trim();resultsShown=100;renderResults();setTimeout(()=>{const e=$("#results-q");if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}},0);};
  const mb=$("#results-more"); if(mb) mb.onclick=()=>{resultsShown+=100;renderResults();};
}

// ---------- Records / Hall of Fame ----------
function renderRecords(){
  const pro = DATA.players.pro.filter(p=>p.rating!=null);
  const qualified = pro.filter(p=>p.maps>=12);
  const teams = DATA.teams;
  // title counts from tournaments
  const titles = {};
  (DATA.tournaments||[]).forEach(tr=>{ if(tr.championTeam) titles[tr.championTeam]=(titles[tr.championTeam]||0)+1; });
  const mostTitles = Object.entries(titles).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([slug,n])=>({slug, name:(teamBySlug(slug)||{}).name||slug, n}));
  // biggest blowout (Bo1 round scores)
  let blow=null;
  allMatches().forEach(m=>{ if(m.sa!=null&&m.sb!=null){ const tot=m.sa+m.sb, marg=Math.abs(m.sa-m.sb);
    if(tot>=13&&tot<=32&&(!blow||marg>blow.marg)) blow={marg, m}; }});
  const bestStreak = [...teams].filter(t=>t.streak&&t.streak[0]==="W").sort((a,b)=>parseInt(b.streak.slice(1))-parseInt(a.streak.slice(1)))[0];

  const maxBy = (arr,key)=>[...arr].sort((a,b)=>b[key]-a[key])[0];
  const recCard = (title, holder, val, href) => `<div class="rec-card">
      <div class="rec-title">${title}</div>
      <div class="rec-holder">${href?`<a href="${href}">${esc(holder)}</a>`:esc(holder)}</div>
      <div class="rec-val">${val}</div></div>`;
  const pl = p => recCard.bind(null);
  const topRating=maxBy(qualified,'rating'), topKills=maxBy(pro,'kills'), topMvp=maxBy(pro,'mvp'),
        topKdr=maxBy(qualified,'kdr'), topAssist=maxBy(pro,'assists'), topOT=maxBy(pro,'ot');
  const mostMaps=maxBy(teams,'total_maps'), mostEvents=maxBy(teams,'events_played'),
        mostMajors=maxBy(teams,'major_wins'), mostPodiums=maxBy(teams,'podiums');
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Records &amp; Hall of Fame</h2>
    <h3 class="rec-group">Titles &amp; Teams</h3>
    <div class="rec-grid">
      ${recCard("Most Event Titles", mostTitles[0].name, mostTitles[0].n+"×", `#/team/${mostTitles[0].slug}`)}
      ${recCard("Most Major Titles", mostMajors.name, mostMajors.major_wins+"×", `#/team/${mostMajors.slug}`)}
      ${recCard("Most Podiums", mostPodiums.name, mostPodiums.podiums, `#/team/${mostPodiums.slug}`)}
      ${recCard("Most Events Played", mostEvents.name, mostEvents.events_played, `#/team/${mostEvents.slug}`)}
      ${recCard("Most Maps Played", mostMaps.name, mostMaps.total_maps, `#/team/${mostMaps.slug}`)}
      ${recCard("Longest Win Streak (active)", bestStreak?bestStreak.name:'—', bestStreak?bestStreak.streak:'—', bestStreak?`#/team/${bestStreak.slug}`:null)}
    </div>
    <h3 class="rec-group">Players <span class="muted" style="font-size:11px">(pro; rate stats min 12 maps)</span></h3>
    <div class="rec-grid">
      ${recCard("Highest BPL Rating", topRating.name, topRating.rating.toFixed(2), `#/player/${topRating.slug}`)}
      ${recCard("Best K/D Ratio", topKdr.name, topKdr.kdr.toFixed(2), `#/player/${topKdr.slug}`)}
      ${recCard("Most Total Kills", topKills.name, topKills.kills, `#/player/${topKills.slug}`)}
      ${recCard("Most MVPs", topMvp.name, topMvp.mvp, `#/player/${topMvp.slug}`)}
      ${recCard("Most Assists", topAssist.name, topAssist.assists, `#/player/${topAssist.slug}`)}
      ${recCard("Most OT Games", topOT.name, topOT.ot, `#/player/${topOT.slug}`)}
    </div>
    <h3 class="rec-group">Matches</h3>
    <div class="rec-grid">
      ${blow?recCard("Biggest Blowout", `${blow.m.w===1?blow.m.a:blow.m.b} vs ${blow.m.w===1?blow.m.b:blow.m.a}`,
        `${Math.max(blow.m.sa,blow.m.sb)}–${Math.min(blow.m.sa,blow.m.sb)}`, `#/tournament/${blow.m.eventSlug}`):''}
    </div>`;
}

// ---------- Transfers ----------
let _transferScope = "pro", _transferShown = 60;
function renderTransfers(){
  const all = (DATA.transfers||[]).filter(t=>t.type==="transfer");
  const proMoves = all.filter(t=>t.fromSlug||t.toSlug);
  const list = _transferScope==="pro" ? proMoves : all;
  const teamCellT = (name, slug) => {
    if(!name) return '<span class="muted">—</span>';
    const tm = slug ? teamBySlug(slug) : null;
    const logo = tm&&tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : '';
    const nm = slug ? `<a href="#/team/${slug}">${esc(name)}</a>` : `<span class="muted">${esc(name)}</span>`;
    return `<span class="team-inline">${logo}${nm}</span>`;
  };
  const rows = list.slice(0, _transferShown).map(t=>{
    const dir = t.toSlug ? 'in' : (t.fromSlug ? 'out' : '');
    return `<tr>
      <td class="mono muted">${fmtDate(t.date)}</td>
      <td class="name-cell">${flag(t.iso)}<a href="#/player/${t.playerSlug}">${esc(t.player)}</a></td>
      <td style="text-align:right">${teamCellT(t.fromTeam,t.fromSlug)}</td>
      <td class="tf-arrow ${dir}">→</td>
      <td>${teamCellT(t.toTeam,t.toSlug)}</td>
    </tr>`;
  }).join("");
  const tab=(k,l,n)=>`<button data-ts="${k}" class="${k===_transferScope?'active':''}">${l} <span style="opacity:.7">${n}</span></button>`;
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Transfers <span class="muted" style="font-size:11px">(${list.length} moves)</span></h2>
    <p class="muted" style="font-size:12px;margin:-6px 0 12px">Roster moves derived from historical event line-ups. Green = joined a pro team, red = left one.</p>
    <div class="tabs">${tab("pro","Pro teams",proMoves.length)}${tab("all","All",all.length)}</div>
    <div class="tablewrap"><table class="data results-table"><thead><tr>
      <th class="no-sort">Date</th><th class="no-sort">Player</th><th class="no-sort" style="text-align:right">From</th><th class="no-sort"></th><th class="no-sort">To</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    ${list.length>_transferShown?`<div style="text-align:center;margin-top:14px"><button id="tf-more" class="loadmore">Load more (${list.length-_transferShown} left)</button></div>`:''}`;
  app.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{_transferScope=b.dataset.ts;_transferShown=60;renderTransfers();});
  const mb=$("#tf-more"); if(mb) mb.onclick=()=>{_transferShown+=100;renderTransfers();};
}

// ---------- Matches & schedule ----------
function renderMatches(){
  const upcoming=[];
  (DATA.tournaments||[]).forEach(tr=>{
    if(tr.champion) return;                 // event finished -> no upcoming matches
    const scan=(rounds,stName,stId)=>rounds.forEach(rd=>rd.matches.forEach(m=>{
      if(m.w===1||m.w===2) return;          // decided
      if(!m.a && !m.b) return;              // fully TBD (both unknown)
      upcoming.push({event:tr.name,eventSlug:tr.slug,date:tr.date,tier:tr.tier,tierLabel:tr.tierLabel,
        ongoing:true, stage:stName, round:rd.title,
        a:m.a,aTeam:m.aTeam,b:m.b,bTeam:m.bTeam,
        ref: stId!=null ? `${stId}-${m.i}` : (m.i!=null?`${m.i}`:null)});
    }));
    if(tr.stages) tr.stages.forEach(st=>scan(st.rounds,st.name,st.id));
    else scan(tr.bracket||[],'',null);
  });
  const byEvent={};
  upcoming.forEach(u=>{ (byEvent[u.eventSlug]=byEvent[u.eventSlug]||{name:u.event,slug:u.eventSlug,date:u.date,
    tier:u.tier,tierLabel:u.tierLabel,ongoing:u.ongoing,items:[]}).items.push(u); });
  const events=Object.values(byEvent).sort((a,b)=> (b.ongoing-a.ongoing) || (a.date<b.date?1:-1));
  const teamSide=(name,slug)=>{ const tm=slug?teamBySlug(slug):null; const logo=tm&&tm.logo?`<img src="${esc(tm.logo)}" alt="">`:'';
    const nm=slug?`<a href="#/team/${slug}">${esc(name||'?')}</a>`:`<span class="muted">${esc(name||'TBD')}</span>`;
    return `<span class="team-inline">${logo}<span>${nm}</span></span>`; };
  const upHtml = events.length ? events.map(ev=>`
      <div class="mt-event">
        <div class="mt-ev-head">
          <a href="#/tournament/${ev.slug}"><span class="event-tier ${TIER_CLASS[ev.tier]}">${esc(ev.tierLabel.toUpperCase())}</span> ${esc(ev.name)}</a>
          ${ev.ongoing?'<span class="live-dot">● LIVE</span>':`<span class="muted" style="font-size:11px">${fmtDate(ev.date)}</span>`}
        </div>
        ${ev.items.map(u=>`<div class="mt-row" data-href="#/match/${u.eventSlug}/${u.ref||''}" data-fallback="#/tournament/${u.eventSlug}">
          <span class="mt-stage">${esc((u.stage?u.stage+' · ':'')+u.round)}</span>
          <span class="mt-teams">
            <span class="mt-a">${teamSide(u.a,u.aTeam)}</span>
            <span class="mt-vs">vs</span>
            <span class="mt-b">${teamSide(u.b,u.bTeam)}</span>
          </span>
        </div>`).join("")}
      </div>`).join("") : '<p class="muted">No upcoming or live matches right now — everything on record is finished. Check <a href="#/results">Results</a>.</p>';
  const recent = allMatches().slice(0,12);
  const recentHtml = recent.map(m=>`<tr>
      <td class="mono muted">${fmtDate(m.date)}</td>
      <td style="text-align:right">${teamSide(m.a,m.aTeam)}</td>
      <td class="mono rscore">${m.sa!=null?m.sa:''} <span class="muted">:</span> ${m.sb!=null?m.sb:''}</td>
      <td>${teamSide(m.b,m.bTeam)}</td>
      <td class="name-cell"><a href="#/tournament/${m.eventSlug}" class="muted" style="font-size:12px">${esc(m.event)}</a></td>
    </tr>`).join("");
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Matches</h2>
    <h3 class="rec-group">Upcoming &amp; Live <span class="muted" style="font-size:11px">(${upcoming.length})</span></h3>
    <div class="mt-list">${upHtml}</div>
    <h3 class="rec-group" style="margin-top:26px">Recent Results</h3>
    <div class="tablewrap"><table class="data results-table"><tbody>${recentHtml}</tbody></table></div>
    <div style="margin-top:10px"><a href="#/results" class="muted">View all results →</a></div>`;
  app.querySelectorAll(".mt-row[data-href]").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("a")) return;               // let team links work
    const ref = el.dataset.href.endsWith("/") ? el.dataset.fallback : el.dataset.href;
    location.hash = ref;
  }));
}

// ---------- Awards ----------
function renderAwards(){
  const ts=(DATA.tournaments||[]).filter(t=>t.champion);
  const byYear={};
  ts.forEach(t=>{ (byYear[t.year]=byYear[t.year]||[]).push(t); });
  const years=Object.keys(byYear).sort((a,b)=>b-a);
  const champCard=t=>{
    const tm=t.championTeam?teamBySlug(t.championTeam):null;
    const logo=tm&&tm.logo?`<img src="${esc(tm.logo)}" alt="">`:`<div class="m-noimg">${initials(t.champion||'?')}</div>`;
    const nm=t.championTeam?`<a href="#/team/${t.championTeam}">${esc(t.champion)}</a>`:esc(t.champion);
    return `<div class="aw-champ">
      <div class="aw-crest">${logo}</div>
      <div class="aw-info">
        <a href="#/tournament/${t.slug}" class="aw-event"><span class="event-tier ${TIER_CLASS[t.tier]}">${esc(t.tierLabel.toUpperCase())}</span> ${esc(t.name)}</a>
        <div class="aw-winner">🏆 ${nm}</div>
      </div></div>`;
  };
  const cabinet=years.map(y=>`<div class="aw-year"><div class="aw-year-h">${y}</div>
     <div class="aw-grid">${byYear[y].slice().sort((a,b)=>a.date<b.date?1:-1).map(champCard).join("")}</div></div>`).join("");
  const titles={};
  ts.forEach(t=>{ if(t.championTeam){ const x=titles[t.championTeam]=titles[t.championTeam]||{n:0,major:0,s:0,a:0,slug:t.championTeam,name:t.champion}; x.n++; if(t.tier==='major')x.major++; else if(t.tier==='s')x.s++; else if(t.tier==='a')x.a++; }});
  const decorated=Object.values(titles).sort((a,b)=>b.n-a.n||b.major-a.major).slice(0,8);
  const decHtml=decorated.map((d,i)=>`<tr>
     <td class="rankcol">${i+1}</td>
     <td class="name-cell">${nameOrTeamCrest(d.name,d.slug)}</td>
     <td class="mono" style="font-weight:700;color:var(--accent)">${d.n}</td>
     <td class="mono">${d.major||'—'}</td><td class="mono">${d.s||'—'}</td><td class="mono">${d.a||'—'}</td>
   </tr>`).join("");
  const seen={}, rivalries=[];
  DATA.teams.forEach(t=>(t.h2h||[]).forEach(h=>{
    const key=[t.slug,h.opp].sort().join("|");
    if(seen[key]) return; seen[key]=1;
    rivalries.push({aSlug:t.slug,aName:t.name,bSlug:h.opp,bName:h.oppName,aw:h.w,bw:h.l,games:h.w+h.l});
  }));
  const topRiv=rivalries.filter(r=>r.games>=3).sort((a,b)=>b.games-a.games).slice(0,8);
  const rivHtml=topRiv.map(r=>`<tr>
     <td class="name-cell" style="text-align:right">${nameOrTeamCrest(r.aName,r.aSlug)}</td>
     <td class="mono" style="font-weight:700">${r.aw}<span class="muted"> – </span>${r.bw}</td>
     <td class="name-cell">${nameOrTeamCrest(r.bName,r.bSlug)}</td>
     <td class="mono muted" style="font-size:12px">${r.games} maps</td></tr>`).join("");
  const mvps=[];
  (DATA.tournaments||[]).forEach(tr=>{
    const agg={};
    const scanM=rounds=>rounds.forEach(rd=>rd.matches.forEach(m=>{ if(!m.stats)return; m.stats.maps.forEach(mp=>(mp.players||[]).forEach(pl=>{
      if(!pl.slug)return; const a=agg[pl.slug]=agg[pl.slug]||{name:pl.name,slug:pl.slug,iso:pl.iso,k:0,mvp:0}; a.k+=pl.k||0; a.mvp+=pl.mvp||0; })); }));
    (tr.stages||[]).forEach(st=>scanM(st.rounds)); scanM(tr.bracket||[]);
    const arr=Object.values(agg); if(!arr.length) return;
    arr.sort((a,b)=>b.mvp-a.mvp||b.k-a.k);
    mvps.push({event:tr.name,slug:tr.slug,p:arr[0]});
  });
  const mvpHtml = mvps.length ? mvps.map(x=>`<tr>
      <td class="name-cell"><a href="#/tournament/${x.slug}">${esc(x.event)}</a></td>
      <td class="name-cell">${flag(x.p.iso)}<a href="#/player/${x.p.slug}">${esc(x.p.name)}</a></td>
      <td class="mono">${x.p.mvp} MVP · ${x.p.k}K</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No scoreboards recorded yet — event MVPs will appear here as you add match scoreboards.</td></tr>`;
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>Awards</h2>
    <h3 class="rec-group">🏆 Champions Cabinet <span class="muted" style="font-size:11px">(${ts.length} titles)</span></h3>
    ${cabinet}
    <h3 class="rec-group" style="margin-top:26px">Most Decorated Teams</h3>
    <div class="tablewrap"><table class="data"><thead><tr>
      <th class="no-sort">#</th><th class="no-sort">Team</th><th class="no-sort">Titles</th>
      <th class="no-sort">Major</th><th class="no-sort">S</th><th class="no-sort">A</th></tr></thead>
      <tbody>${decHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:26px">Biggest Rivalries <span class="muted" style="font-size:11px">(most maps, pro vs pro)</span></h3>
    <div class="tablewrap"><table class="data"><tbody>${rivHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:26px">Event MVPs</h3>
    <div class="tablewrap"><table class="data"><tbody>${mvpHtml}</tbody></table></div>`;
}

// ---------- Maps ----------
function renderMaps(){
  const maps={}, teamMap={}, results=[];
  (DATA.tournaments||[]).forEach(tr=>{
    const scan=rounds=>rounds.forEach(rd=>rd.matches.forEach(m=>{
      if(!m.stats||!m.stats.maps) return;
      m.stats.maps.forEach(mp=>{
        const mapName=(mp.map||'').trim()||'Unknown';
        const e=maps[mapName]=maps[mapName]||{name:mapName,played:0,rounds:0};
        e.played++;
        const sa=mp.scoreA, sb=mp.scoreB;
        if(sa!=null&&sb!=null) e.rounds+=(sa+sb);
        results.push({map:mapName,event:tr.name,eventSlug:tr.slug,a:m.a,aTeam:m.aTeam,sa,b:m.b,bTeam:m.bTeam,sb});
        if(sa!=null&&sb!=null&&sa!==sb){
          const winA=sa>sb;
          [[m.aTeam,m.a,winA],[m.bTeam,m.b,!winA]].forEach(([slug,name,won])=>{
            if(!name) return; const k=slug||name;
            const t=teamMap[k]=teamMap[k]||{slug,name,byMap:{},w:0,l:0};
            const bm=t.byMap[mapName]=t.byMap[mapName]||{w:0,l:0};
            won?(bm.w++,t.w++):(bm.l++,t.l++);
          });
        }
      });
    }));
    (tr.stages||[]).forEach(st=>scan(st.rounds)); scan(tr.bracket||[]);
  });
  const mapList=Object.values(maps).sort((a,b)=>b.played-a.played);
  const totalMaps=mapList.reduce((s,m)=>s+m.played,0);
  if(!mapList.length){
    app.innerHTML=`<h2 class="section-title"><span class="accent-bar"></span>Maps</h2>
      <div class="notice"><h2>No map data yet</h2>
      <p class="muted">Map statistics are built from recorded match scoreboards. Add a scoreboard with map names (via <a href="#/admin">Admin</a>) and this page fills in automatically — most-played maps, per-team map records, and every map result.</p></div>`;
    return;
  }
  const mapCards=mapList.map(m=>`<div class="rec-card">
      <div class="rec-title">${esc(m.name)}</div>
      <div class="rec-holder">${m.played} <span class="muted" style="font-size:13px;font-weight:400">map${m.played!==1?'s':''} played</span></div>
      <div class="rec-val" style="font-size:18px">${m.rounds?('~'+Math.round(m.rounds/m.played)+' rds/map'):'—'}</div></div>`).join("");
  const teamSide=(name,slug)=>{ const tm=slug?teamBySlug(slug):null; const logo=tm&&tm.logo?`<img src="${esc(tm.logo)}" alt="">`:'';
    const nm=slug?`<a href="#/team/${slug}">${esc(name||'?')}</a>`:esc(name||'?'); return `<span class="team-inline">${logo}<span>${nm}</span></span>`; };
  const resHtml=results.map(r=>`<tr>
      <td><span class="pill" style="background:var(--panel2,#141b2b)">${esc(r.map)}</span></td>
      <td style="text-align:right">${teamSide(r.a,r.aTeam)}</td>
      <td class="mono rscore">${r.sa!=null?r.sa:''} <span class="muted">:</span> ${r.sb!=null?r.sb:''}</td>
      <td>${teamSide(r.b,r.bTeam)}</td>
      <td class="name-cell"><a href="#/tournament/${r.eventSlug}" class="muted" style="font-size:12px">${esc(r.event)}</a></td>
    </tr>`).join("");
  const teams=Object.values(teamMap).sort((a,b)=>(b.w+b.l)-(a.w+a.l));
  const trecHtml=teams.map(t=>{
    const byMap=Object.entries(t.byMap).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l))
      .map(([mn,r])=>`${esc(mn)} ${r.w}-${r.l}`).join(' · ');
    return `<tr><td class="name-cell">${teamSide(t.name,t.slug)}</td>
      <td class="mono">${t.w}-${t.l}</td>
      <td class="muted" style="font-size:12px">${byMap}</td></tr>`;
  }).join("");
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>Maps <span class="muted" style="font-size:11px">(${totalMaps} maps recorded)</span></h2>
    <p class="muted" style="font-size:12px;margin:-6px 0 14px">Built from recorded match scoreboards — grows as you add more. <a href="#/admin">Record a scoreboard →</a></p>
    <h3 class="rec-group">Map Pool</h3>
    <div class="rec-grid">${mapCards}</div>
    <h3 class="rec-group" style="margin-top:24px">Team Map Records</h3>
    <div class="tablewrap"><table class="data"><thead><tr>
      <th class="no-sort">Team</th><th class="no-sort">Overall</th><th class="no-sort">By map</th></tr></thead>
      <tbody>${trecHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:24px">Map Results</h3>
    <div class="tablewrap"><table class="data results-table"><tbody>${resHtml}</tbody></table></div>`;
}

// ---------- Player comparison ----------
let cmpA=null, cmpB=null;
function renderCompare(){
  const pool = DATA.players.pro;
  const byRating=[...pool].filter(p=>p.rating!=null).sort((a,b)=>b.rating-a.rating);
  if(!cmpA) cmpA=byRating[0]&&byRating[0].slug;
  if(!cmpB) cmpB=byRating[1]&&byRating[1].slug;
  const opts=(sel)=>["pro","amateur","solo"].map(pk=>`<optgroup label="${pk==='pro'?'Pro':pk==='amateur'?'Amateur':'Solo'}">`+
    DATA.players[pk].map(p=>`<option value="${p.slug}" ${p.slug===sel?'selected':''}>${esc(p.name)}</option>`).join("")+`</optgroup>`).join("");
  const A=playerBySlug(cmpA), B=playerBySlug(cmpB);
  const rows=[
    ["BPL Rating",p=>p.rating!=null?p.rating.toFixed(2):'—',p=>p.rating||0],
    ["Tier",p=>p.tier||'—',null],
    ["K/D Ratio",p=>p.kdr.toFixed(2),p=>p.kdr],
    ["Kills",p=>p.kills,p=>p.kills],
    ["Deaths",p=>p.deaths,p=>-p.deaths],
    ["Assists",p=>p.assists,p=>p.assists],
    ["MVPs",p=>p.mvp,p=>p.mvp],
    ["Kills / Map",p=>(p.kills/Math.max(1,p.maps)).toFixed(1),p=>p.kills/Math.max(1,p.maps)],
    ["Win Rate",p=>pct(p.winrate),p=>p.winrate],
    ["Maps",p=>p.maps,p=>p.maps],
    ["Record",p=>`${p.wins}-${p.losses}`,null],
  ];
  const cell=(p,fmt,cmp,other,side)=>{ const v=fmt(p); const win=cmp&&other&&cmp(p)>cmp(other); return `<td class="mono cmp-val ${side} ${win?'cmp-win':''}">${v}</td>`; };
  const body = (A&&B)?rows.map(([label,fmt,cmp])=>`<tr>
      ${cell(A,fmt,cmp,B,'a')}<td class="cmp-mid">${label}</td>${cell(B,fmt,cmp,A,'b')}</tr>`).join(""):'';
  const head=p=>{
    if(!p) return '<div class="cmp-player"></div>';
    const t=teamByName(p.team);
    return `<div class="cmp-player">
      <div class="avatar cmp-av">${initials(p.name)}</div>
      <div class="cmp-pname">${flag(p.iso)}<a href="#/player/${p.slug}">${esc(p.name)}</a></div>
      <div class="cmp-pteam">${t?`<a href="#/team/${t.slug}" style="color:var(--link)">${esc(p.team)}</a>`:esc(p.team||'Teamless')}</div>
      <div class="cmp-ptier">${tierBadge(p.tier)}</div></div>`;
  };
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Player Comparison
      <a href="#/players" class="muted" style="margin-left:auto;font-size:12px">← All players</a></h2>
    <div class="cmp-selectors">
      <select id="cmpA">${opts(cmpA)}</select>
      <span class="cmp-vs">vs</span>
      <select id="cmpB">${opts(cmpB)}</select>
    </div>
    <div class="cmp-heads">${head(A)}<div class="cmp-vs-big">VS</div>${head(B)}</div>
    <div class="tablewrap"><table class="data cmp-table"><tbody>${body}</tbody></table></div>`;
  $("#cmpA").onchange=e=>{cmpA=e.target.value;renderCompare();};
  $("#cmpB").onchange=e=>{cmpB=e.target.value;renderCompare();};
}

// ---------- Team comparison ----------
let tcmpA=null, tcmpB=null;
function rosterAvg(t){ const rs=(t.roster||[]).map(p=>p.rating).filter(r=>r!=null); return rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null; }
function renderTeamCompare(){
  const teams=[...DATA.teams].sort((a,b)=>a.rank-b.rank);
  if(!tcmpA) tcmpA=teams[0]&&teams[0].slug;
  if(!tcmpB) tcmpB=teams[1]&&teams[1].slug;
  const opts=sel=>teams.map(t=>`<option value="${t.slug}" ${t.slug===sel?'selected':''}>${esc(t.name)}</option>`).join("");
  const A=teamBySlug(tcmpA), B=teamBySlug(tcmpB);
  const rows=[
    ["BPL Rank", t=>'#'+t.rank, t=>-t.rank],
    ["Rank Points", t=>t.rank_points, t=>t.rank_points],
    ["Major Titles", t=>t.major_wins, t=>t.major_wins],
    ["S-Tier Titles", t=>t.s_tier_wins, t=>t.s_tier_wins],
    ["A-Tier Titles", t=>t.a_tier_wins, t=>t.a_tier_wins],
    ["Map Record", t=>`${t.map_wins}-${t.map_losses}`, null],
    ["Win Rate", t=>pct(t.wlr), t=>t.wlr],
    ["Events Played", t=>t.events_played, t=>t.events_played],
    ["Podiums", t=>t.podiums, t=>t.podiums],
    ["Avg Roster Rating", t=>{const a=rosterAvg(t);return a!=null?a.toFixed(2):'—';}, t=>rosterAvg(t)||0],
    ["Current Streak", t=>t.streak||'—', null],
  ];
  const cell=(t,fmt,cmp,other,side)=>{ const v=fmt(t); const win=cmp&&other&&cmp(t)>cmp(other); return `<td class="mono cmp-val ${side} ${win?'cmp-win':''}">${v}</td>`; };
  const body=(A&&B)?rows.map(([label,fmt,cmp])=>`<tr>
      ${cell(A,fmt,cmp,B,'a')}<td class="cmp-mid">${label}</td>${cell(B,fmt,cmp,A,'b')}</tr>`).join(""):'';
  const head=t=>{
    if(!t) return '<div class="cmp-player"></div>';
    const logo=t.logo?`<img class="cmp-crest" src="${esc(t.logo)}" alt="">`:`<div class="avatar cmp-av">${initials(t.name)}</div>`;
    return `<div class="cmp-player">
      ${logo}
      <div class="cmp-pname"><a href="#/team/${t.slug}">${esc(t.name)}</a></div>
      <div class="cmp-pteam">#${t.rank} · ${t.rank_points} pts${t.tag?' · '+esc(t.tag):''}</div></div>`;
  };
  const h2h=(A&&B)?((A.h2h||[]).find(h=>h.opp===B.slug)):null;
  const h2hHtml=h2h?`<div class="cmp-h2h"><span class="cmp-h2h-t">Head-to-head</span>
      <span class="cmp-h2h-s"><strong>${esc(A.name)}</strong> ${h2h.w} <span class="muted">–</span> ${h2h.l} <strong>${esc(B.name)}</strong></span>
      <span class="muted" style="font-size:12px">${h2h.w+h2h.l} maps, all-time</span></div>`
    : (A&&B?`<div class="cmp-h2h muted">No head-to-head matches on record between ${esc(A.name)} and ${esc(B.name)}.</div>`:'');
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>Team Comparison
      <a href="#/compare" class="muted" style="margin-left:auto;font-size:12px">⇄ Compare players</a></h2>
    <div class="cmp-selectors">
      <select id="tcmpA">${opts(tcmpA)}</select>
      <span class="cmp-vs">vs</span>
      <select id="tcmpB">${opts(tcmpB)}</select>
    </div>
    <div class="cmp-heads">${head(A)}<div class="cmp-vs-big">VS</div>${head(B)}</div>
    ${h2hHtml}
    <div class="tablewrap"><table class="data cmp-table"><tbody>${body}</tbody></table></div>`;
  $("#tcmpA").onchange=e=>{tcmpA=e.target.value;renderTeamCompare();};
  $("#tcmpB").onchange=e=>{tcmpB=e.target.value;renderTeamCompare();};
}

// ---------- League Stats ----------
function renderStats(){
  const pools=["pro","amateur","solo"];
  // dedupe people across pools by name
  const seen=new Set(), nat={};
  pools.forEach(pk=>DATA.players[pk].forEach(p=>{
    const key=normKey(p.name); if(seen.has(key)) return; seen.add(key);
    const name=p.nat||'Unknown', e=nat[name]=nat[name]||{nat:name,iso:p.iso||'',n:0}; e.n++;
    if(!e.iso&&p.iso) e.iso=p.iso;
  }));
  const natList=Object.values(nat).sort((a,b)=>b.n-a.n);
  const totalPeople=seen.size;
  const countries=natList.filter(x=>x.nat!=='Unknown').length;
  // tier distribution (pro)
  const tiers=(DATA.tiers||[]);
  const tierCount={}; DATA.players.pro.forEach(p=>{ if(p.tier) tierCount[p.tier]=(tierCount[p.tier]||0)+1; });
  const tierMax=Math.max(1,...Object.values(tierCount));
  // matches recorded
  const matchCount=allMatches().length;
  const bar=(label,n,max,color)=>`<div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(n/max*100))}%${color?';background:'+color:''}"></div></div>
      <span class="bar-val">${n}</span></div>`;
  const natMax=Math.max(1,...natList.map(x=>x.n));
  // highest-rated player per nationality (for the flag hover tooltip).
  // prefer the top PRO player; fall back to amateur/solo only if the country has no pro.
  const topByNat={};
  DATA.players.pro.forEach(p=>{
    if(p.rating==null||!p.nat) return;
    const cur=topByNat[p.nat];
    if(!cur||p.rating>cur.rating) topByNat[p.nat]={name:p.name,rating:p.rating,team:p.team,slug:p.slug,pro:true};
  });
  ["amateur","solo"].forEach(pk=>DATA.players[pk].forEach(p=>{
    if(p.rating==null||!p.nat) return;
    const cur=topByNat[p.nat];
    if(cur&&cur.pro) return;                         // a pro from this country already wins
    if(!cur||p.rating>cur.rating) topByNat[p.nat]={name:p.name,rating:p.rating,team:p.team,slug:p.slug,pro:false};
  }));
  const natBars=natList.slice(0,14).map(x=>{
    const tp=topByNat[x.nat];
    const fl = tp ? `<span class="flag-tip">${flag(x.iso)}<span class="ftbox"><span class="ftlabel">Top player</span><b>${esc(tp.name)}</b><span class="ftmeta">${tp.rating.toFixed(2)} rating${tp.team?' · '+esc(tp.team):''}</span></span></span>` : flag(x.iso);
    return `<div class="bar-row"><span class="bar-label">${fl}<span class="bar-cty">${esc(x.nat)}</span></span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(x.n/natMax*100))}%"></div></div>
      <span class="bar-val">${x.n}</span></div>`;
  }).join("");
  const tierBars=tiers.map(t=>tierCount[t]?bar(`<span class="dot" style="background:${tierColor(t)}"></span>${esc(t)}`,tierCount[t],tierMax,tierColor(t)):'').join("");
  const poolMax=Math.max(...pools.map(pk=>DATA.players[pk].length));
  const poolBars=pools.map(pk=>bar(pk==='pro'?'Pro':pk==='amateur'?'Amateur':'Solo Queue',DATA.players[pk].length,poolMax)).join("");
  const tile=(v,l)=>`<div class="stat"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>League Stats</h2>
    <div class="statgrid" style="margin-bottom:22px">
      ${tile(totalPeople,"Players")}
      ${tile(DATA.teams.length,"Pro Teams")}
      ${tile(countries,"Countries")}
      ${tile((DATA.tournaments||[]).length,"Events")}
      ${tile(matchCount,"Matches")}
    </div>
    <div class="stats2col">
      <div><h3 class="rec-group">Players by Country <span class="muted" style="font-size:11px">(top 14)</span></h3>
        <div class="bars">${natBars}</div></div>
      <div><h3 class="rec-group">Pro Rating Tiers</h3>
        <div class="bars">${tierBars}</div>
        <h3 class="rec-group" style="margin-top:22px">Player Pools</h3>
        <div class="bars">${poolBars}</div></div>
    </div>`;
}

// ---------- Match page ----------
function renderMatch(){
  const parts = location.hash.replace(/^#\/?/,"").split("/");
  const slug = parts[1], ref = parts.slice(2).join("/");
  const tr = (DATA.tournaments||[]).find(t=>t.slug===slug);
  if(!tr){ app.innerHTML = notFound("Match"); return; }
  let match=null, roundTitle="", stageName="";
  const scan = (rounds, sName)=>rounds.forEach(rd=>rd.matches.forEach(m=>{
    if(m.i!=null && (String(m.i)===ref || `${ref}`.endsWith("-"+m.i))){ match=m; roundTitle=rd.title; stageName=sName||""; }
  }));
  if(ref.includes("-") && tr.stages){ const sid=ref.split("-")[0]; const st=tr.stages.find(s=>String(s.id)===sid); if(st) scan(st.rounds, st.name); }
  if(!match){ (tr.bracket||[]).forEach(rd=>rd.matches.forEach(m=>{ if(String(m.i)===ref){match=m;roundTitle=rd.title;} })); }
  if(!match && tr.stages){ tr.stages.forEach(st=>scan(st.rounds, st.name)); }
  if(!match){ app.innerHTML = notFound("Match"); return; }

  const side = (name, slug2, score, win)=>{
    const t = slug2 ? teamBySlug(slug2) : null;
    const logo = t&&t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<div class="m-noimg">${initials(name||'?')}</div>`;
    const nm = name ? (slug2?`<a href="#/team/${slug2}">${esc(name)}</a>`:esc(name)) : '<span class="muted">TBD</span>';
    return `<div class="m-side ${win?'m-win':''}">${logo}<div class="m-name">${nm}</div><div class="m-score">${score!=null?score:'–'}</div></div>`;
  };
  // head-to-head between these two current teams
  let h2hHtml = '';
  if(match.aTeam && match.bTeam){
    const ta = teamBySlug(match.aTeam);
    const rec = ta && (ta.h2h||[]).find(h=>h.opp===match.bTeam);
    if(rec) h2hHtml = `<div class="m-h2h"><span class="muted">All-time head-to-head</span>
      <div class="m-h2h-rec"><span class="m-h2h-w">${rec.w}</span><span class="muted">–</span><span class="m-h2h-l">${rec.l}</span></div></div>`;
  }
  // pre-match preview: rankings + recent form (only when not yet played and both teams known)
  let previewHtml = '';
  if(match.w!==1 && match.w!==2 && match.aTeam && match.bTeam){
    const ta = teamBySlug(match.aTeam), tb = teamBySlug(match.bTeam);
    const formPills = t => (t.recentResults||[]).slice(-5).map(r=>
      `<span class="formpill ${r.result==='W'?'fw':'fl'}" title="${esc((r.result==='W'?'Won':'Lost')+' vs '+(r.opp||'?'))}">${r.result}</span>`).join("");
    const col = t => t?`<div class="mp-col">
        <div class="mp-rank">#${t.rank}<span class="mp-rank-l">BPL RANK</span></div>
        <div class="mp-team">${t.logo?`<img src="${esc(t.logo)}" alt="">`:''}<a href="#/team/${t.slug}">${esc(t.name)}</a></div>
        <div class="mp-pts">${t.rank_points} pts</div>
        <div class="mp-form">${formPills(t)||'<span class="muted">no recent games</span>'}</div>
        <div class="mp-streak">${t.streak?('Streak: '+t.streak):''}</div>
      </div>`:'<div class="mp-col"></div>';
    previewHtml = `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Match Preview</h2>
      <div class="mp-grid">${col(ta)}<div class="mp-vs">vs</div>${col(tb)}</div>`;
  }
  // rosters at this event (if available)
  const rosterCol = (slug2)=>{
    const row = (tr.attending||[]).find(r=>r.teamSlug===slug2);
    if(!row) return '';
    return `<div class="m-roster"><div class="m-roster-h">${esc(row.team)}</div>${row.players.map(p=>
      `<div class="m-rp">${flag(p.iso)}${p.slug?`<a href="#/player/${p.slug}">${esc(p.name)}</a>`:esc(p.name)}${p.captain?'<span class="rp-c">C</span>':''}</div>`).join("")}</div>`;
  };
  const rosters = (match.aTeam||match.bTeam) ? `${rosterCol(match.aTeam)}${rosterCol(match.bTeam)}` : '';

  // full player scoreboard(s) (HLTV-style, Bo1/Bo3/Bo5) when recorded
  let sbHtml = '';
  const maps = (match.stats && match.stats.maps) || [];
  if(maps.length){
    _sbMatch = match; _sbTab = maps.length > 1 ? 'all' : 0;
    sbHtml = `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Scoreboard</h2><div id="sb-container"></div>`;
  }

  app.innerHTML = `
    <div class="crumb"><a href="#/tournaments">Tournaments</a><span class="sep">/</span>
      <a href="#/tournament/${esc(slug)}">${esc(tr.name)}</a><span class="sep">/</span>Match</div>
    <div class="m-context">${tierBadgeEvent(tr)} <span class="muted">${esc(stageName?stageName+' · ':'')}${esc(roundTitle)}${match.bo>1?' · Bo'+match.bo:''} · ${fmtDate(tr.date)}</span></div>
    <div class="m-card">
      ${side(match.a, match.aTeam, match.sa, match.w===1)}
      <div class="m-mid"><div class="m-vs">${(match.sa!=null&&match.sb!=null)?`${match.sa} : ${match.sb}`:'vs'}</div>
        ${match.w?`<div class="muted" style="font-size:12px">${esc(match.w===1?match.a:match.b)} won</div>`:'<div class="muted" style="font-size:12px">not played</div>'}</div>
      ${side(match.b, match.bTeam, match.sb, match.w===2)}
    </div>
    ${h2hHtml}
    ${previewHtml}
    ${sbHtml || (rosters?`<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Rosters</h2><div class="m-rosters">${rosters}</div>`:'')}
    ${_adminOn?`<div style="margin-top:16px"><button id="m-editstats" class="loadmore">${match.stats?'Edit':'Record'} scoreboard</button></div><div id="m-statsform"></div>`:''}
    <div style="margin-top:20px"><a href="#/tournament/${esc(slug)}" class="muted">← back to ${esc(tr.name)}</a></div>`;

  if(maps.length) renderScoreboard();
  const eb = $("#m-editstats");
  if(eb) eb.onclick = ()=>openStatsForm(slug, ref, match);
}
let _sbMatch = null, _sbTab = 'all';
function aggregateMaps(maps){
  const by = {};
  maps.forEach(mp=>mp.players.forEach(p=>{
    const key = (p.slug||"") + "|" + normKey(p.name) + "|" + normKey(p.team);
    if(!by[key]) by[key] = {team:p.team, name:p.name, slug:p.slug, iso:p.iso, k:0, a:0, d:0, mvp:0, score:0};
    const t = by[key]; t.k+=p.k||0; t.a+=p.a||0; t.d+=p.d||0; t.mvp+=p.mvp||0; t.score+=p.score||0;
  }));
  return Object.values(by);
}
function matchRating(k,a,d,score,R){
  // HLTV-style per-match rating from K/A/D/score over the map's rounds; ~1.00 = average.
  if(!R) return null;
  const kpr=k/R, surv=(R-d)/R, apr=a/R, spr=score/R;
  return 0.44*(kpr/0.707) + 0.25*(surv/0.293) + 0.24*(spr/1.793) + 0.07*(apr/0.108);
}
function rtgColor(r){
  if(r==null) return 'var(--muted)';
  if(r>=1.10) return 'var(--good)';
  if(r<0.90)  return 'var(--accent2, #ff6b6b)';
  return 'var(--text)';
}
function renderScoreboard(){
  const match = _sbMatch; if(!match) return;
  const c = document.getElementById("sb-container"); if(!c) return;
  const maps = match.stats.maps;
  const view = _sbTab === 'all' ? aggregateMaps(maps) : maps[_sbTab].players;
  const rounds = _sbTab === 'all'
    ? maps.reduce((s,mp)=>s+((mp.scoreA||0)+(mp.scoreB||0)),0)
    : ((maps[_sbTab].scoreA||0)+(maps[_sbTab].scoreB||0));
  const block = (teamName, teamSlug)=>{
    const rtgOf = p => { const r = matchRating(p.k,p.a,p.d,p.score,rounds); return r==null ? -Infinity : r; };
    const players = view.filter(p=>normKey(p.team)===normKey(teamName)).sort((a,b)=>rtgOf(b)-rtgOf(a)||b.score-a.score);
    if(!players.length) return '';
    const t = teamSlug ? teamBySlug(teamSlug) : null;
    return `<div class="sb-team">
      <div class="sb-head">${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}<strong>${esc(teamName)}</strong></div>
      <div class="tablewrap"><table class="data sb-table">
        <thead><tr><th class="no-sort">Player</th><th class="no-sort">K</th><th class="no-sort">A</th><th class="no-sort">D</th>
          <th class="no-sort">+/–</th><th class="no-sort">MVP</th><th class="no-sort">Score</th>
          <th class="no-sort" title="BPL match rating (HLTV-style, ~1.00 = average)">RTG</th></tr></thead>
        <tbody>${players.map(p=>{const pm=p.k-p.d; const rtg=matchRating(p.k,p.a,p.d,p.score,rounds); return `<tr>
          <td class="name-cell">${flag(p.iso)}${p.slug?`<a href="#/player/${p.slug}">${esc(p.name)}</a>`:esc(p.name)}</td>
          <td class="mono">${p.k}</td><td class="mono">${p.a}</td><td class="mono">${p.d}</td>
          <td class="mono" style="color:${pm>0?'var(--good)':pm<0?'var(--accent2)':'var(--muted)'}">${pm>0?'+':''}${pm}</td>
          <td class="mono">${p.mvp?'★'+p.mvp:'–'}</td><td class="mono">${p.score}</td>
          <td class="mono sb-rtg" style="color:${rtgColor(rtg)}">${rtg!=null?rtg.toFixed(2):'–'}</td></tr>`;}).join("")}</tbody>
      </table></div></div>`;
  };
  const tabs = maps.length > 1 ? `<div class="tabs" style="margin-bottom:10px">
      <button data-tab="all" class="${_sbTab==='all'?'active':''}">All maps</button>
      ${maps.map((mp,i)=>`<button data-tab="${i}" class="${_sbTab===i?'active':''}">Map ${i+1}${mp.map?' · '+esc(mp.map):''}${mp.scoreA!=null?` (${mp.scoreA}–${mp.scoreB})`:''}</button>`).join("")}
    </div>` : (maps[0].map?`<div class="muted" style="font-size:12px;margin-bottom:8px">${esc(maps[0].map)}${maps[0].scoreA!=null?` · ${maps[0].scoreA}–${maps[0].scoreB}`:''}</div>`:'');
  c.innerHTML = tabs + `<div class="sb-wrap">${block(match.a, match.aTeam)}${block(match.b, match.bTeam)}</div>`;
  c.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{ _sbTab = b.dataset.tab==='all'?'all':+b.dataset.tab; renderScoreboard(); });
}
let _sfMaps = [];
function openStatsForm(slug, ref, match){
  const box = $("#m-statsform"); if(!box) return;
  const em = (match.stats&&match.stats.maps)||[];
  _sfMaps = em.length ? JSON.parse(JSON.stringify(em)) : [{map:"", players:[]}];
  box.innerHTML = `
    <div class="sf-wrap">
      <datalist id="allplayers">${allPlayers().map(p=>`<option value="${esc(p.name)}">`).join("")}</datalist>
      <div id="sf-maps"></div>
      <button id="sf-addmap" class="loadmore" style="margin-top:6px">+ Add map</button>
      <div style="margin-top:12px"><button id="sf-save" class="adm-btn" style="max-width:220px">Save all maps</button>
        <span id="sf-msg" class="muted" style="font-size:12px;margin-left:10px"></span></div>
    </div>`;
  renderSfMaps(match);
  $("#sf-addmap").onclick = ()=>{ collectSf(match); _sfMaps.push({map:"", players:[]}); renderSfMaps(match); };
  $("#sf-save").onclick = async ()=>{
    collectSf(match);
    $("#sf-msg").textContent = "Saving…";
    const res = await apiPost("/api/matchstats", {slug, ref, maps:_sfMaps});
    if(res.ok){ await reloadData(); renderMatch(); } else $("#sf-msg").textContent = "Error: "+(res.error||"failed");
  };
}
function collectSf(match){
  _sfMaps = [...document.querySelectorAll(".sf-map")].map(bl=>{
    const num=(el,c)=>{const v=el.querySelector(c).value; return v===''?0:+v;};
    const sa=bl.querySelector(".sf-scA").value, sb=bl.querySelector(".sf-scB").value;
    const players=[];
    bl.querySelectorAll(".sf-row").forEach(r=>{
      const name=r.querySelector(".sf-name").value.trim(); if(!name) return;
      players.push({team:r.dataset.team, name, k:num(r,".sf-k"), a:num(r,".sf-a"), d:num(r,".sf-d"), mvp:num(r,".sf-mvp"), score:num(r,".sf-score")});
    });
    return {map:bl.querySelector(".sf-mapname").value.trim(), scoreA:sa===''?null:+sa, scoreB:sb===''?null:+sb, players};
  });
}
function renderSfMaps(match){
  const c = $("#sf-maps"); if(!c) return;
  const rowFor=(mp,teamName,idx)=>{
    const p=(mp.players||[]).filter(x=>normKey(x.team)===normKey(teamName))[idx]||{};
    const v=k=>p[k]!=null?p[k]:'';
    return `<div class="sf-row" data-team="${esc(teamName)}">
      <input class="sf-in sf-name" placeholder="player" list="allplayers" value="${esc(p.name||'')}">
      <input class="sf-in sf-k" type="number" placeholder="K" value="${v('k')}">
      <input class="sf-in sf-a" type="number" placeholder="A" value="${v('a')}">
      <input class="sf-in sf-d" type="number" placeholder="D" value="${v('d')}">
      <input class="sf-in sf-mvp" type="number" placeholder="MVP" value="${v('mvp')}">
      <input class="sf-in sf-score" type="number" placeholder="Score" value="${v('score')}"></div>`;
  };
  const teamBlock=(mp,teamName)=> teamName ? `<div class="sf-team"><div class="sf-th">${esc(teamName)}</div>
    <div class="sf-hdr"><span>Player</span><span>K</span><span>A</span><span>D</span><span>MVP</span><span>Score</span></div>
    ${[0,1,2,3,4].map(i=>rowFor(mp,teamName,i)).join("")}</div>` : '';
  c.innerHTML = _sfMaps.map((mp,mi)=>`<div class="sf-map">
      <div class="sf-maphdr"><span class="sf-mapno">Map ${mi+1}</span>
        <input class="sf-in sf-mapname" placeholder="map" value="${esc(mp.map||'')}" style="max-width:150px">
        <span class="muted" style="font-size:11px">score</span>
        <input class="sf-in sf-scA" type="number" title="${esc(match.a||'A')}" value="${mp.scoreA!=null?mp.scoreA:''}" style="width:52px">
        <input class="sf-in sf-scB" type="number" title="${esc(match.b||'B')}" value="${mp.scoreB!=null?mp.scoreB:''}" style="width:52px">
        ${_sfMaps.length>1?`<button class="sf-delmap" data-mi="${mi}" title="remove map">✕ map</button>`:''}</div>
      <div class="sf-teams">${teamBlock(mp,match.a)}${teamBlock(mp,match.b)}</div></div>`).join("");
  c.querySelectorAll(".sf-delmap").forEach(b=>b.onclick=()=>{ collectSf(match); _sfMaps.splice(+b.dataset.mi,1); if(!_sfMaps.length) _sfMaps=[{map:"",players:[]}]; renderSfMaps(match); });
}

// ---------- Admin (local editing) ----------
let adminEditing = null, _adminTeams = [], _adminOn = false;
async function reloadData(){ try{ DATA = await loadData(5); _allMatches=null; _proSlugs=null; }catch(e){} }
function apiPost(p, body){ return fetch(p,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body)}).then(r=>r.json()).catch(e=>({ok:false,error:String(e)})); }
async function renderAdmin(){
  app.innerHTML = `<div class="loading">Connecting to admin…</div>`;
  let state = null;
  try{ const r = await fetch("/api/state"); state = await r.json(); }catch(e){ state=null; }
  if(!state || !state.admin){
    app.innerHTML = `
      <h2 class="section-title"><span class="accent-bar"></span>Admin</h2>
      <div class="notice" style="text-align:left">
        <p style="margin-top:0"><strong>Editing is only available when you run the admin server on your PC.</strong></p>
        <p>Open a terminal in the project folder and run:</p>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:10px 12px;font-family:monospace">python build/admin_server.py</div>
        <p class="muted" style="margin-bottom:0">Then reload this page. On the public/published site this page stays read-only.</p>
      </div>`;
    return;
  }
  _adminTeams = state.teams || [];
  const tiers = [["major","Major"],["s","S-Tier"],["a","A-Tier"]];
  const listHtml = state.tournaments.length ? state.tournaments.map(t=>`
      <div class="adm-trow">
        <span class="event-tier ${TIER_CLASS[t.tier]}">${esc((t.tier==='major'?'MAJ':t.tier==='s'?'S':'A'))}</span>
        <a href="#/admin" data-edit="${esc(t.slug)}" class="adm-name">${esc(t.name)}</a>
        <span class="muted" style="font-size:12px">${esc(t.date)} · ${t.stages} stage${t.stages===1?'':'s'}</span>
        <a href="#/tournament/${esc(t.slug)}" class="muted" style="font-size:12px">view →</a>
        <button class="adm-del" data-del="${esc(t.slug)}" title="Delete">✕</button>
      </div>`).join("") : '<p class="muted">No admin tournaments yet.</p>';

  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Admin <span class="muted" style="font-size:11px">· editing enabled</span></h2>
    <div class="adm-publish">
      <div>
        <div class="adm-pub-t">⬆ Publish to the live site</div>
        <div class="muted" style="font-size:12px">Push all your latest edits to GitHub — the public site updates about a minute later.</div>
        <div id="adm-pubmsg" style="font-size:12px;margin-top:6px"></div>
      </div>
      <button id="adm-publish" class="adm-btn adm-pub-btn">Publish to GitHub</button>
    </div>
    <div class="profile-grid" style="grid-template-columns:300px 1fr">
      <div class="infobox" style="padding:14px">
        <div class="ib-title" style="margin:-14px -14px 12px">New Tournament</div>
        <label class="adm-l">Name</label>
        <input id="adm-name" class="adm-in" placeholder="e.g. Audax Esse BPL Invitational 2026">
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label class="adm-l">Tier</label>
            <select id="adm-tier" class="adm-in">${tiers.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div>
          <div style="flex:1"><label class="adm-l">Date</label>
            <input id="adm-date" class="adm-in" type="date"></div>
        </div>
        <button id="adm-create" class="adm-btn">Create tournament</button>
        <div id="adm-msg" class="muted" style="font-size:12px;margin-top:8px">Create it, then add stages (a bracket, groups, swiss…) in the editor.</div>
      </div>
      <div>
        <h3 class="rec-group" style="margin-top:0">Your Tournaments</h3>
        <div class="adm-list">${listHtml}</div>
        <div id="adm-editor" style="margin-top:18px"></div>
      </div>
    </div>
    <div class="adm-solo" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>Solo Queue Scoreboards</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Record a solo-queue game. These stats stack on top of the sheet into each player's <strong>Solo Queue</strong> block only — tournament stats are never touched. Check <strong>W</strong> for players on the winning side.</p>
      <div class="profile-grid" style="grid-template-columns:360px 1fr">
        <div class="infobox" style="padding:14px">
          <div class="ib-title" style="margin:-14px -14px 12px">New Solo Game</div>
          <div style="display:flex;gap:8px">
            <div style="flex:1"><label class="adm-l">Map (optional)</label><input id="sq-map" class="adm-in" placeholder="Dust2"></div>
            <div style="flex:1"><label class="adm-l">Date</label><input id="sq-date" class="adm-in" type="date"></div>
          </div>
          <label class="adm-l">Players</label>
          <div id="sq-players"></div>
          <button id="sq-addrow" class="adm-btn" style="margin-top:6px;background:var(--panel);border:1px solid var(--border);color:var(--text)">+ Add player</button>
          <button id="sq-save" class="adm-btn" style="margin-top:6px">Save game</button>
          <div id="sq-msg" class="muted" style="font-size:12px;margin-top:8px"></div>
        </div>
        <div>
          <h3 class="rec-group" style="margin-top:0">Recorded Solo Games</h3>
          <div id="sq-list" class="adm-list"><p class="muted">Loading…</p></div>
        </div>
      </div>
    </div>
    <div class="adm-shuffle" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>Amateur Team Shuffler</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Shuffles all <strong>${DATA.players.amateur.length}</strong> amateur players into teams of 5. Each team gets 1 IGL + 1 Awper first (scarce roles spread as far as they go), then fills by shared country/region. Nothing is saved — this is a scratch tool.</p>
      <div class="profile-grid" style="grid-template-columns:360px 1fr">
        <div class="infobox" style="padding:14px">
          <div class="ib-title" style="margin:-14px -14px 12px">Locked Groups</div>
          <label class="adm-l">One group per line, comma-separated names — these stay together</label>
          <textarea id="shf-locks" class="adm-in" rows="5" placeholder="tiniibee, hyvred&#10;playerA, playerB, playerC"></textarea>
          <div id="shf-lockmsg" class="muted" style="font-size:11px;margin:4px 0 0"></div>
          <label style="display:flex;align-items:center;gap:7px;margin-top:12px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="shf-country" checked> Group by country/region
          </label>
          <div class="muted" style="font-size:11px;margin-top:2px">Off = purely random teams (roles + locked groups still apply).</div>
          <button id="shf-go" class="adm-btn" style="margin-top:10px">🎲 Shuffle teams</button>
          <button id="shf-copy" class="adm-btn" style="margin-top:6px;background:var(--panel);border:1px solid var(--border);color:var(--text)">Copy result</button>
          <div id="shf-msg" class="muted" style="font-size:12px;margin-top:8px"></div>
        </div>
        <div>
          <h3 class="rec-group" style="margin-top:0">Generated Teams</h3>
          <div id="shf-out"><p class="muted">Click “Shuffle teams” to generate.</p></div>
        </div>
      </div>
    </div>`;

  $("#adm-publish").onclick = async ()=>{
    const btn=$("#adm-publish"), msg=$("#adm-pubmsg");
    btn.disabled=true; const orig=btn.textContent; btn.textContent="Publishing…"; msg.textContent="";
    const r = await apiPost("/api/publish",{});
    btn.disabled=false; btn.textContent=orig;
    msg.textContent = r.msg || (r.ok?"Published.":"Publish failed.");
    msg.style.color = r.ok ? "var(--good)" : "var(--accent2, #ff6b6b)";
  };
  $("#adm-create").onclick = async ()=>{
    const name = $("#adm-name").value.trim();
    if(!name){ $("#adm-msg").textContent = "Enter a name."; return; }
    $("#adm-msg").textContent = "Creating…";
    const r = await apiPost("/api/create",{name, tier:$("#adm-tier").value, date:$("#adm-date").value});
    if(r.ok){ await reloadData(); adminEditing = r.slug; renderAdmin(); }
    else $("#adm-msg").textContent = "Error: "+(r.error||"failed");
  };
  app.querySelectorAll("[data-edit]").forEach(a=>a.onclick=e=>{e.preventDefault();adminEditing=a.dataset.edit;openEditor(a.dataset.edit);});
  app.querySelectorAll("[data-del]").forEach(b=>b.onclick=async e=>{
    e.preventDefault();
    if(!confirm("Delete this tournament?")) return;
    await apiPost("/api/delete",{slug:b.dataset.del}); adminEditing=null; await reloadData(); renderAdmin();
  });
  setupSoloAdmin();
  setupShuffler();
  if(adminEditing) openEditor(adminEditing);
}

function setupShuffler(){
  const go = $("#shf-go"); if(!go) return;
  const parseLocks = ()=>{
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const known = {}; DATA.players.amateur.forEach(p=>known[norm(p.name)]=p.name);
    const lines = ($("#shf-locks").value||"").split("\n").map(l=>l.trim()).filter(Boolean);
    const groups=[], unknown=[];
    lines.forEach(l=>{
      const names = l.split(",").map(s=>s.trim()).filter(Boolean);
      names.forEach(n=>{ if(!known[norm(n)]) unknown.push(n); });
      if(names.length) groups.push(names);
    });
    $("#shf-lockmsg").innerHTML = unknown.length
      ? `<span style="color:var(--accent2,#ff6b6b)">Not found in amateur pool: ${unknown.map(esc).join(", ")}</span>`
      : (groups.length? `${groups.length} locked group(s).` : "");
    return groups;
  };
  $("#shf-locks").oninput = parseLocks;
  go.onclick = ()=>{
    const groups = parseLocks();
    lastShuffle = generateTeams(DATA.players.amateur, groups, $("#shf-country").checked);
    renderShuffleResult(lastShuffle);
    const noAwp = lastShuffle.filter(t=>t.missingAwp).length, noIGL = lastShuffle.filter(t=>t.missingIGL).length;
    $("#shf-msg").innerHTML = `${lastShuffle.length} teams generated.` +
      (noAwp?` <span style="color:var(--accent2,#ff6b6b)">${noAwp} without an Awper</span>`:"") +
      (noIGL?` <span style="color:var(--accent2,#ff6b6b)">${noIGL} without an IGL</span>`:"");
  };
  $("#shf-copy").onclick = ()=>{
    if(!lastShuffle){ $("#shf-msg").textContent="Shuffle first."; return; }
    const txt = lastShuffle.map(t=>`Team ${t.n}${t.country?" ("+t.country+")":""}\n`+
      t.players.map(p=>`  ${p.role}: ${p.name}`).join("\n")).join("\n\n");
    navigator.clipboard.writeText(txt).then(()=>{ $("#shf-msg").textContent="Copied to clipboard."; },
      ()=>{ $("#shf-msg").textContent="Copy failed."; });
  };
}

function renderShuffleResult(teams){
  const out = $("#shf-out"); if(!out) return;
  const roleClass = r => r.startsWith("IGL")?"shf-igl": r==="Awper"?"shf-awp": r==="Fill"?"shf-fill":"shf-rif";
  out.innerHTML = `<div class="shf-grid">${teams.map(t=>`
    <div class="shf-team">
      <div class="shf-th">Team ${t.n} ${t.country?`<span class="th-flag">${flag(isoForCountry(t.country))}</span><span class="muted" style="font-size:11px">${esc(t.country)}</span>`:''}
        ${t.missingAwp?'<span class="shf-warn" title="No Awper">no AWP</span>':''}${t.missingIGL?'<span class="shf-warn" title="No IGL">no IGL</span>':''}</div>
      ${t.players.map(p=>`<div class="shf-row">
        <span class="shf-role ${roleClass(p.role)}"${p.role==="IGL*"?' title="Promoted from Rifler — no natural IGL on this team"':''}>${esc(p.role)}</span>
        <a href="#/player/${p.slug}" class="shf-name">${flag(p.iso)}${esc(p.name)}</a>
        <span class="shf-rat">${p.rating>=0?p.rating.toFixed(2):'—'}</span>
      </div>`).join("")}
    </div>`).join("")}</div>`;
}
function isoForCountry(c){ const m={USA:"us",Singapore:"sg",Malaysia:"my",Japan:"jp",Philippines:"ph",Australia:"au","Hong Kong":"hk",Canada:"ca",Brazil:"br",Taiwan:"tw",Indonesia:"id",Thailand:"th",Korea:"kr","South Korea":"kr",China:"cn",Vietnam:"vn"}; return m[c]||""; }

// ---- amateur team shuffler (scratch tool; client-side only) ----
const SHF_REGION = {
  sg:"SEA",my:"SEA",ph:"SEA",id:"SEA",th:"SEA",vn:"SEA",
  jp:"East Asia",kr:"East Asia",tw:"East Asia",hk:"East Asia",cn:"East Asia",
  au:"Oceania",nz:"Oceania", us:"North America",ca:"North America", br:"South America",
  gb:"Europe",fr:"Europe",de:"Europe",nl:"Europe",be:"Europe",at:"Europe",pl:"Europe",fi:"Europe",it:"Europe",is:"Europe",se:"Europe",ua:"Europe",
  kz:"Central Asia",
};
const shfRegion = iso => SHF_REGION[iso] || "";
function shfShuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
let lastShuffle = null;

function generateTeams(players, lockedGroups, groupByCountry=true){
  const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const byKey = {}; players.forEach(p=>{ byKey[norm(p.name)] = p; });
  const meta = p => {
    const role = (p.role||"").toLowerCase();
    const vssmb = norm(p.name)==="vssmb";
    return { p, name:p.name, rating:(p.rating==null?-1:p.rating), iso:p.iso||"", country:p.nat||"",
             region:shfRegion(p.iso), isAwp:/awp/.test(role)||vssmb, isIGL:/igl/.test(role)||vssmb,
             baseRole:p.role||"Rifler" };
  };
  const all = players.map(meta);
  const placed = new Set();               // norm names already on a team
  const N = all.length, nTeams = Math.max(1, Math.ceil(N/5));
  const teams = Array.from({length:nTeams}, ()=>({members:[]}));
  const has = (t,fn)=> t.members.some(fn);
  const dominantCountry = t => { const c={}; t.members.forEach(m=>{ if(m.country) c[m.country]=(c[m.country]||0)+1; }); return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||""; };
  const scoreFor = (t,m)=>{ if(!groupByCountry) return 0; const dc=dominantCountry(t); if(dc && m.country===dc) return 3; const drs=t.members.map(x=>x.region); if(m.region && drs.includes(m.region)) return 1; return 0; };
  const take = (pool,t)=>{ // best country match, random among ties
    let best=null,bs=-1; const order=shfShuffle(pool);
    for(const m of order){ const s=scoreFor(t,m); if(s>bs){ bs=s; best=m; } }
    return best;
  };
  const put = (t,m)=>{ t.members.push(m); placed.add(norm(m.name)); };

  // 1) locked groups seed teams
  let ti=0;
  lockedGroups.forEach(names=>{
    if(ti>=nTeams) return;
    const t=teams[ti++];
    names.forEach(nm=>{ const m=all.find(x=>norm(x.name)===norm(nm)); if(m && !placed.has(norm(nm)) && t.members.length<5) put(t,m); });
  });

  const freeOf = pred => all.filter(m=>!placed.has(norm(m.name)) && pred(m));
  // 2) one Awper per team (scarcer first); VSSMB satisfies both
  teams.forEach(t=>{ if(t.members.length>=5||has(t,m=>m.isAwp)) return; const pool=freeOf(m=>m.isAwp); if(!pool.length) return; put(t, take(pool,t)); });
  // 3) one IGL per team
  teams.forEach(t=>{ if(t.members.length>=5||has(t,m=>m.isIGL)) return; const pool=freeOf(m=>m.isIGL); if(!pool.length) return; put(t, take(pool,t)); });
  // 4) fill remaining slots, round-robin, country/region weighted
  let guard=0;
  while(freeOf(()=>true).length && teams.some(t=>t.members.length<5) && guard++<N+5){
    teams.forEach(t=>{ if(t.members.length>=5) return; const pool=freeOf(()=>true); if(!pool.length) return; put(t, take(pool,t)); });
  }
  // 5) assign display roles + flags
  return teams.filter(t=>t.members.length).map((t,i)=>{
    const hadIGL = t.members.some(m=>m.isIGL);
    const igls = t.members.filter(m=>m.isIGL).sort((a,b)=>b.rating-a.rating);
    let iglPick = igls[0]||null, promoted=false;
    if(!iglPick){
      // no natural IGL on the team — promote the highest-rated Rifler (fall back to any non-Awper)
      const nonAwp = t.members.filter(m=>!m.isAwp).sort((a,b)=>b.rating-a.rating);
      const riflers = nonAwp.filter(m=>/rifl/i.test(m.baseRole));
      iglPick = riflers[0] || nonAwp[0] || t.members.slice().sort((a,b)=>b.rating-a.rating)[0] || null;
      promoted = !!iglPick;
    }
    const rows = t.members.map(m=>{
      let role;
      if(iglPick && m===iglPick) role = m.isAwp ? "IGL · Awp" : (promoted ? "IGL*" : "IGL");
      else if(m.isAwp) role="Awper";
      else if(/fill/i.test(m.baseRole)) role="Fill";
      else role="Rifler";
      return { name:m.name, slug:m.p.slug, role, rating:m.rating, iso:m.iso, country:m.country };
    }).sort((a,b)=> (a.role.startsWith("IGL")?0: a.role==="Awper"?1: a.role==="Fill"?3:2) - (b.role.startsWith("IGL")?0: b.role==="Awper"?1: b.role==="Fill"?3:2));
    return { n:i+1, players:rows, country:dominantCountry(t),
             missingAwp: !t.members.some(m=>m.isAwp), missingIGL: !iglPick };
  });
}

function setupSoloAdmin(){
  const wrap = $("#sq-players"); if(!wrap) return;
  const addRow = (name="")=>{
    const row = document.createElement("div");
    row.className = "sq-prow";
    row.style.cssText = "display:flex;gap:4px;margin-bottom:4px";
    row.innerHTML = `
      <input class="adm-in sq-name" placeholder="Player" value="${esc(name)}" style="flex:2;min-width:0">
      <input class="adm-in sq-k" type="number" min="0" placeholder="K" style="width:44px" title="Kills">
      <input class="adm-in sq-d" type="number" min="0" placeholder="D" style="width:44px" title="Deaths">
      <input class="adm-in sq-a" type="number" min="0" placeholder="A" style="width:44px" title="Assists">
      <input class="adm-in sq-mvp" type="number" min="0" placeholder="M" style="width:44px" title="MVPs">
      <label style="display:flex;align-items:center;gap:2px;font-size:11px" title="Won?"><input type="checkbox" class="sq-won">W</label>
      <button class="sq-rm" title="Remove" style="background:none;border:none;color:var(--muted);cursor:pointer">✕</button>`;
    row.querySelector(".sq-rm").onclick = ()=>row.remove();
    wrap.appendChild(row);
  };
  wrap.innerHTML = ""; addRow(); addRow();
  $("#sq-addrow").onclick = ()=>addRow();
  $("#sq-save").onclick = async ()=>{
    const players = [...wrap.querySelectorAll(".sq-prow")].map(r=>({
      name: r.querySelector(".sq-name").value.trim(),
      k: +r.querySelector(".sq-k").value||0, d: +r.querySelector(".sq-d").value||0,
      a: +r.querySelector(".sq-a").value||0, mvp: +r.querySelector(".sq-mvp").value||0,
      won: r.querySelector(".sq-won").checked,
    })).filter(p=>p.name);
    const msg = $("#sq-msg");
    if(!players.length){ msg.textContent = "Add at least one player."; return; }
    msg.textContent = "Saving…";
    const r = await apiPost("/api/solo/add",{map:$("#sq-map").value.trim(), date:$("#sq-date").value, players});
    if(r.ok){ msg.style.color="var(--good)"; msg.textContent="Saved "+players.length+" players."; $("#sq-map").value=""; wrap.innerHTML=""; addRow(); addRow(); await reloadData(); loadSoloList(); }
    else { msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent = "Error: "+(r.msg||r.error||"failed"); }
  };
  loadSoloList();
}

async function loadSoloList(){
  const box = $("#sq-list"); if(!box) return;
  let games = [];
  try{ const r = await (await fetch("/api/solo/list")).json(); games = r.games||[]; }catch(e){}
  if(!games.length){ box.innerHTML = '<p class="muted">No solo games recorded yet.</p>'; return; }
  box.innerHTML = games.slice().reverse().map(g=>{
    const w = g.players.filter(p=>p.won).map(p=>esc(p.name)).join(", ");
    const l = g.players.filter(p=>!p.won).map(p=>esc(p.name)).join(", ");
    return `<div class="adm-trow">
      <span class="muted" style="font-size:11px;min-width:70px">${esc(g.map||"—")}${g.date?" · "+esc(g.date):""}</span>
      <span style="flex:1;font-size:12px"><span class="ae-win">${w||"—"}</span> <span class="muted">def.</span> ${l||"—"}</span>
      <button class="adm-del" data-solodel="${g.id}" title="Delete">✕</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-solodel]").forEach(b=>b.onclick=async ()=>{
    if(!confirm("Delete this solo game?")) return;
    await apiPost("/api/solo/delete",{id:+b.dataset.solodel}); await reloadData(); loadSoloList();
  });
}

async function openEditor(slug){
  adminEditing = slug;
  const ed = $("#adm-editor"); if(!ed) return;
  ed.innerHTML = `<div class="loading">Loading…</div>`;
  const r = await (await fetch("/api/manual/"+slug)).json();
  if(!r.ok){ ed.innerHTML = '<p class="muted">Could not load.</p>'; return; }
  const man = r.manual, resolved = r.resolved || {};
  const reload = async ()=>{ await reloadData(); openEditor(slug); };

  const matchRow = (sid, m, rr)=>{
    const a=rr?rr.a:null, b=rr?rr.b:null, w=rr?rr.w:0, both=a&&b, canDel=(m.a!==undefined);
    const tn=(x,win)=>`<span class="ae-team ${win?'ae-win':''}">${x?esc(x):'<span class=muted>TBD</span>'}</span>`;
    return `<div class="ae-match" data-mid="${m.id}" data-sid="${sid}">
      <div class="ae-side">${tn(a,w===1)}<input class="ae-sc ae-a" type="number" min="0" value="${m.sa!=null?m.sa:''}" ${both?'':'disabled'}></div>
      <div class="ae-side">${tn(b,w===2)}<input class="ae-sc ae-b" type="number" min="0" value="${m.sb!=null?m.sb:''}" ${both?'':'disabled'}></div>
      ${canDel?`<button class="ae-delm" data-sid="${sid}" data-mid="${m.id}" title="remove match">✕</button>`:''}</div>`;
  };
  const stagesHtml = man.stages.map(st=>{
    const res = resolved[st.id] || {};
    const byRound={}; st.matches.forEach(m=>{(byRound[m.round]=byRound[m.round]||[]).push(m);});
    const rk=Object.keys(byRound).sort((a,b)=>a-b);
    const rt=(rn)=>`<input class="ae-rt-in" data-sid="${st.id}" data-round="${rn}" value="${esc((st.roundTitles&&st.roundTitles[rn])||('Round '+rn))}">`;
    let body;
    if(st.format==="single_elim"){
      body=`<div class="ae-bracket">${rk.map(rn=>`<div class="ae-col">${rt(rn)}${byRound[rn].map(m=>matchRow(st.id,m,res[m.id])).join("")}</div>`).join("")}</div>`;
    } else {
      body=rk.map(rn=>`<div class="ae-rrround">${rt(rn)}${byRound[rn].map(m=>matchRow(st.id,m,res[m.id])).join("")}</div>`).join("")
        || '<p class="muted" style="font-size:12px">No matches yet.</p>';
      if(st.format==="swiss"){
        const opts=(st.teams.length?st.teams:_adminTeams).map(t=>`<option>${esc(t)}</option>`).join("");
        body+=`<div class="ae-addmatch"><input class="am-round" type="number" min="1" value="1" title="round">
          <select class="am-a"><option value="">team A</option>${opts}</select>
          <select class="am-b"><option value="">team B</option>${opts}</select>
          <button class="am-add" data-sid="${st.id}">+ match</button></div>`;
      }
    }
    return `<div class="ae-stage">
      <div class="ae-stage-head">
        <input class="ae-sname" data-sid="${st.id}" value="${esc(st.name)}">
        <span class="muted" style="font-size:12px;text-transform:capitalize">${st.format.replace("_"," ")}</span>
        <label class="muted" style="font-size:12px">Bo <input class="ae-bo" data-sid="${st.id}" type="number" min="1" value="${st.bestOf||1}"></label>
        ${st.format!=="swiss"?`<button class="ae-reseed" data-sid="${st.id}">edit teams</button>`:''}
        <button class="ae-delstage" data-sid="${st.id}" title="delete stage">✕ stage</button>
      </div>
      <div class="ae-reseed-box" id="rs-${st.id}" style="display:none">
        <textarea class="ae-seedtext" rows="4">${esc(st.teams.join("\n"))}</textarea>
        <button class="ae-reseed-go" data-sid="${st.id}">apply (regenerates, clears scores)</button></div>
      ${body}</div>`;
  }).join("");

  ed.innerHTML = `
    <div class="ae-head"><strong style="font-family:Rajdhani;font-size:18px">${esc(man.name)}</strong>
      ${r.champion?`<span class="ae-champ">🏆 ${esc(r.champion)}</span>`:'<span class="muted">in progress</span>'}
      <a href="#/tournament/${esc(slug)}" class="muted" style="margin-left:auto;font-size:12px">open event page →</a></div>
    ${stagesHtml || '<p class="muted">No stages yet — add one below.</p>'}
    <div class="ae-addstage">
      <div class="ib-title" style="margin-bottom:10px">Add Stage</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><label class="adm-l">Stage name</label><input id="as-name" class="adm-in" placeholder="Playoffs / Group A / Swiss Stage"></div>
        <div><label class="adm-l">Format</label><select id="as-fmt" class="adm-in">
          <option value="single_elim">Single Elim (bracket)</option>
          <option value="round_robin">Round Robin</option>
          <option value="swiss">Swiss (add matches by hand)</option></select></div>
        <div><label class="adm-l">Best of</label><input id="as-bo" class="adm-in" type="number" min="1" value="1" style="width:70px"></div>
      </div>
      <label class="adm-l">Teams — one per line (seed order for a bracket)</label>
      <textarea id="as-teams" class="adm-in" rows="5" placeholder="Aimpunch&#10;Cosmos&#10;…"></textarea>
      <button id="as-add" class="adm-btn" style="max-width:200px">Add stage</button>
    </div>`;

  // ---- wiring ----
  ed.querySelectorAll(".ae-match").forEach(mn=>mn.querySelectorAll(".ae-sc").forEach(i=>i.addEventListener("change", async ()=>{
    const sa=mn.querySelector(".ae-a").value, sb=mn.querySelector(".ae-b").value;
    await apiPost("/api/score",{slug, sid:+mn.dataset.sid, matchId:+mn.dataset.mid, sa:sa===''?null:+sa, sb:sb===''?null:+sb}); reload();
  })));
  ed.querySelectorAll(".ae-rt-in").forEach(i=>i.addEventListener("change", async ()=>{
    await apiPost("/api/round/rename",{slug, sid:+i.dataset.sid, round:i.dataset.round, title:i.value}); reload(); }));
  ed.querySelectorAll(".ae-sname").forEach(i=>i.addEventListener("change", async ()=>{
    await apiPost("/api/stage/rename",{slug, sid:+i.dataset.sid, name:i.value}); reload(); }));
  ed.querySelectorAll(".ae-bo").forEach(i=>i.addEventListener("change", async ()=>{
    await apiPost("/api/stage/bestof",{slug, sid:+i.dataset.sid, bestOf:+i.value||1}); reload(); }));
  ed.querySelectorAll(".ae-reseed").forEach(b=>b.onclick=()=>{ const box=$("#rs-"+b.dataset.sid); box.style.display=box.style.display==="none"?"block":"none"; });
  ed.querySelectorAll(".ae-reseed-go").forEach(b=>b.onclick=async ()=>{
    const teams=$("#rs-"+b.dataset.sid).querySelector(".ae-seedtext").value.split("\n").map(s=>s.trim()).filter(Boolean);
    await apiPost("/api/stage/reseed",{slug, sid:+b.dataset.sid, teams}); reload(); });
  ed.querySelectorAll(".ae-delstage").forEach(b=>b.onclick=async ()=>{ if(confirm("Delete this stage?")){ await apiPost("/api/stage/delete",{slug, sid:+b.dataset.sid}); reload(); } });
  ed.querySelectorAll(".ae-delm").forEach(b=>b.onclick=async ()=>{ await apiPost("/api/match/delete",{slug, sid:+b.dataset.sid, matchId:+b.dataset.mid}); reload(); });
  ed.querySelectorAll(".am-add").forEach(b=>b.onclick=async ()=>{
    const box=b.closest(".ae-addmatch"); const a=box.querySelector(".am-a").value, bb=box.querySelector(".am-b").value, rn=box.querySelector(".am-round").value;
    if(!a||!bb||a===bb){ alert("Pick two different teams."); return; }
    await apiPost("/api/match/add",{slug, sid:+b.dataset.sid, round:+rn||1, a, b:bb}); reload(); });
  $("#as-add").onclick=async ()=>{
    const name=$("#as-name").value.trim(), fmt=$("#as-fmt").value;
    const teams=$("#as-teams").value.split("\n").map(s=>s.trim()).filter(Boolean);
    if(fmt!=="swiss" && teams.length<2){ alert("Add at least 2 teams for this format."); return; }
    await apiPost("/api/stage/add",{slug, name, format:fmt, teams, bestOf:+$("#as-bo").value||1}); reload(); };
}

const TIER_CLASS = {major:"et-major", s:"et-s", a:"et-a"};
function tierBadgeEvent(tr){ return `<span class="event-tier ${TIER_CLASS[tr.tier]}">${esc(tr.tierLabel.toUpperCase())}</span>`; }
function fmtDate(iso){ if(!iso) return ""; const [y,m,d]=iso.split("-"); const mo=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]; return `${mo} ${+d}, ${y}`; }
function champLabel(tr){ return /elimination/.test(tr.type) ? "Champion" : "1st Place"; }
function nameOrTeam(name, teamSlug){ return teamSlug ? `<a href="#/team/${teamSlug}" style="color:var(--link)">${esc(name)}</a>` : esc(name||"—"); }
function nameOrTeamCrest(name, teamSlug){
  if(!name) return '—';
  const t = teamSlug ? teamBySlug(teamSlug) : null;
  return `<span class="team-inline">${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}${teamSlug?`<a href="#/team/${teamSlug}">${esc(name)}</a>`:esc(name)}</span>`;
}

let tourneyFilter = "all";
function renderTournaments(){
  const all = DATA.tournaments||[];
  const list = tourneyFilter==="all" ? all : all.filter(t=>t.tier===tourneyFilter);
  const counts = {all:all.length, major:all.filter(t=>t.tier==="major").length, s:all.filter(t=>t.tier==="s").length, a:all.filter(t=>t.tier==="a").length};
  const rows = list.map(tr=>`<tr>
      <td class="mono">${fmtDate(tr.date)}</td>
      <td>${tierBadgeEvent(tr)}</td>
      <td class="name-cell"><a href="#/tournament/${tr.slug}">${esc(tr.name)}</a></td>
      <td>${tr.format}</td>
      <td class="mono">${tr.participantCount}</td>
      <td>${nameOrTeamCrest(tr.champion, tr.championTeam)}</td>
    </tr>`).join("");
  const tab=(k,l)=>`<button data-tf="${k}" class="${k===tourneyFilter?'active':''}">${l} <span style="opacity:.7">${counts[k]}</span></button>`;
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Tournaments</h2>
    <div class="tabs">${tab("all","All")}${tab("major","Majors")}${tab("s","S-Tier")}${tab("a","A-Tier")}</div>
    <div class="tablewrap"><table class="data">
      <thead><tr><th class="no-sort">Date</th><th class="no-sort">Tier</th><th class="no-sort">Event</th>
        <th class="no-sort">Format</th><th class="no-sort">Teams</th><th class="no-sort">Winner</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin-top:12px">Bracket data imported from Challonge. Individual/1v1/duos skill tournaments and the Bot 2v2 (Inferno) event are excluded.</p>`;
  app.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{tourneyFilter=b.dataset.tf;renderTournaments();});
}

function renderTournament(slug){
  const tr = (DATA.tournaments||[]).find(t=>t.slug===slug);
  if(!tr){ app.innerHTML = notFound("Tournament"); return; }
  const champT = tr.championTeam ? teamBySlug(tr.championTeam) : null;

  // index this event's attending rosters for hover popups (by team name + slug)
  const attByKey = {}, attBySlug = {};
  (tr.attending||[]).forEach(row=>{
    const i = rosterIdx(row);
    attByKey[normKey(row.team)] = i;
    if(row.teamSlug) attBySlug[row.teamSlug] = i;
  });
  const rAttr = (name, teamSlug)=>{
    let i = (teamSlug && attBySlug[teamSlug]!=null) ? attBySlug[teamSlug] : attByKey[normKey(name||"")];
    return i!=null ? ` data-roster="${i}"` : "";
  };
  const crest = (name, teamSlug)=>{
    if(!name) return '—';
    const t = teamSlug ? teamBySlug(teamSlug) : null;
    const inner = teamSlug ? `<a href="#/team/${teamSlug}">${esc(name)}</a>` : esc(name);
    return `<span class="team-inline"${rAttr(name, teamSlug)}>${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}${inner}</span>`;
  };
  const bteamName = (name, teamSlug)=>{
    if(!name) return '<span class="muted">TBD</span>';
    const inner = teamSlug ? `<a href="#/team/${teamSlug}" style="color:inherit">${esc(name)}</a>` : esc(name);
    return `<span${rAttr(name, teamSlug)}>${inner}</span>`;
  };

  const standRows = tr.standings.map(s=>`<tr>
      <td class="rankcol">${s.rank}</td>
      <td class="name-cell">${crest(s.name, s.teamSlug)}</td>
      <td class="mono">${s.w}-${s.l}</td>
    </tr>`).join("");

  const isElim = /elimination/.test(tr.type);

  // --- tree bracket (single/double elim) ---
  const treeTeam = (name, teamSlug, score, win)=>{
    const t = teamSlug ? teamBySlug(teamSlug) : null;
    const logo = t&&t.logo ? `<img class="bt-logo" src="${esc(t.logo)}" alt="">` : '';
    const nm = name ? (teamSlug ? `<a href="#/team/${teamSlug}">${esc(name)}</a>` : esc(name)) : '<span class="muted">TBD</span>';
    const sc = score!=null ? score : '';
    return `<div class="bkt-team ${win?'win':''}"${rAttr(name, teamSlug)}>${logo}<span class="bt-name">${nm}</span><span class="bt-score">${sc}</span></div>`;
  };
  const mref = (m, pfx)=> (m.i!=null ? ` data-match="${pfx}${m.i}"` : '');
  const treeMatch = (m, pfx="")=>`<div class="bkt-match"${mref(m,pfx)}>${treeTeam(m.a,m.aTeam,m.sa,m.w===1)}${treeTeam(m.b,m.bTeam,m.sb,m.w===2)}</div>`;
  const isByeMatch = m => m.a==="(bye)" || m.b==="(bye)";
  // a 3rd-place decider floats on its own — pulled out of the main tree
  const thirdPlaceBox = (rounds, pfx="")=>{
    const tps = (rounds||[]).flatMap(rd=>rd.matches.filter(m=>m.tp));
    if(!tps.length) return '';
    return `<div class="bkt-third">
      <div class="bkt-third-title">Third Place Match</div>
      ${tps.map(m=>`<div class="bkt-third-match">${treeMatch(m,pfx)}</div>`).join("")}</div>`;
  };
  const treeSection = (title, rounds, pfx="")=>{
    if(!rounds.length) return '';
    // drop first-round byes: a seeded team with a bye is shown waiting in the next round,
    // so the real opening matches line up 1:1 with the round they feed into.
    const cols = rounds.map(rd=>{
        const matches = rd.matches.filter(m=>!isByeMatch(m) && !m.tp);
        if(!matches.length) return '';
        return `<div class="bkt-round">
        <div class="bkt-round-title">${esc(rd.title)}</div>
        <div class="bkt-round-matches">${matches.map(m=>treeMatch(m,pfx)).join("")}</div>
      </div>`;
      }).join("");
    return `${title?`<div class="bkt-section-title">${title}</div>`:''}
      <div class="bkt-wrap"><div class="bkt"><svg class="bkt-svg"></svg>${cols}</div></div>`;
  };
  const listRounds = (rounds, pfx="")=>`<div class="bracket">${rounds.map(rd=>{
      const ms = rd.matches.map(m=>`<div class="bmatch"${mref(m,pfx)}>
          <div class="bteam ${m.w===1?'bw':''}">${bteamName(m.a, m.aTeam)}<span class="bscore">${m.sa!=null?m.sa:''}</span></div>
          <div class="bteam ${m.w===2?'bw':''}">${bteamName(m.b, m.bTeam)}<span class="bscore">${m.sb!=null?m.sb:''}</span></div>
        </div>`).join("");
      return `<div class="bround"><div class="brtitle">${esc(rd.title)}</div>${ms}</div>`;
    }).join("")}</div>`;
  const stageStandings = st => st.standings.length ? `<div class="tablewrap" style="max-width:460px;margin-bottom:12px"><table class="data">
      <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th><th class="no-sort">W</th><th class="no-sort">L</th></tr></thead>
      <tbody>${st.standings.map(s=>`<tr><td class="rankcol">${s.rank}</td><td class="name-cell">${nameOrTeamCrest(s.name,s.teamSlug)}</td>
        <td class="mono">${s.w}</td><td class="mono">${s.l}</td></tr>`).join("")}</tbody></table></div>` : '';
  const fmtLabel = f => ({single_elim:"Single Elimination",round_robin:"Round Robin",swiss:"Swiss"}[f]||f);

  let bracketBlock;
  if(tr.stages && tr.stages.length){
    bracketBlock = tr.stages.map(st=>{
      const pfx = st.id + "-";
      const head = `<h2 class="section-title" style="margin-top:20px"><span class="accent-bar"></span>${esc(st.name)}
        <span class="muted" style="font-size:11px">${fmtLabel(st.format)}${st.bestOf>1?' · Bo'+st.bestOf:''}</span></h2>`;
      if(st.format==="single_elim") return head + treeSection("", st.rounds, pfx) + thirdPlaceBox(st.rounds, pfx);
      return head + stageStandings(st) + listRounds(st.rounds, pfx);
    }).join("");
  } else if(isElim){
    const pos = tr.bracket.filter(r=>r.round>0), neg = tr.bracket.filter(r=>r.round<0);
    bracketBlock = neg.length
      ? treeSection("Upper Bracket", pos) + treeSection("Lower Bracket", neg)
      : treeSection("", pos);
  } else {
    bracketBlock = listRounds(tr.bracket);
  }

  // teams-attending logo wall
  const wall = (tr.attending||[]).map(row=>{
    const t = row.teamSlug ? teamBySlug(row.teamSlug) : null;
    const logo = t&&t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span class="aw-noimg">${initials(row.team)}</span>`;
    const inner = `${logo}<span class="aw-name">${esc(row.team)}</span>`;
    return row.teamSlug
      ? `<a class="aw-tile" href="#/team/${row.teamSlug}"${rAttr(row.team,row.teamSlug)}>${inner}</a>`
      : `<span class="aw-tile"${rAttr(row.team,row.teamSlug)}>${inner}</span>`;
  }).join("");
  const wallSection = (tr.attending&&tr.attending.length)
    ? `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Teams Attending
         <span class="muted" style="font-size:11px">(${tr.attending.length}) · hover for roster</span></h2>
       <div class="attend-wall">${wall}</div>` : '';

  const fs = tr.finalStandings || [];
  const fsMedal = r => r===1?'🥇':r===2?'🥈':r===3?'🥉':'';
  const fsResultCls = res => res==='Champion'?'fs-champ':res==='Runner-up'?'fs-ru':res==='3rd Place'?'fs-3rd':res==='Group Stage'?'fs-grp':'';
  const fsRow = s => `<tr>
      <td class="rankcol fs-rank">${(s.rank<=3?fsMedal(s.rank)+' ':'')}${s.rank}</td>
      <td class="name-cell">${crest(s.name, s.teamSlug)}</td>
      <td><span class="fs-result ${fsResultCls(s.result)}">${esc(s.result)}</span></td></tr>`;
  const fsPlayoff = fs.filter(s=>s.result!=='Group Stage');
  const fsGroup = fs.filter(s=>s.result==='Group Stage');
  const finalStandingsSection = fs.length ? `
    <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Final Standings</h2>
    <div class="tablewrap fs-wrap"><table class="data fs-table"><tbody>${fsPlayoff.map(fsRow).join("")}</tbody></table></div>
    ${fsGroup.length?`<details class="fs-details"><summary>Group stage — ${fsGroup.length} teams that didn't advance</summary>
       <div class="tablewrap fs-wrap"><table class="data fs-table"><tbody>${fsGroup.map(fsRow).join("")}</tbody></table></div></details>`:''}` : '';

  app.innerHTML = `
    <div class="crumb"><a href="#/tournaments">Tournaments</a><span class="sep">/</span>${esc(tr.name)}</div>
    <div class="profile-head">
      <div class="ph-main">
        <h1>${esc(tr.name)} ${tierBadgeEvent(tr)}</h1>
        <div class="ph-sub">${fmtDate(tr.date)} · ${tr.format} · ${tr.participantCount} teams</div>
        <div style="margin-top:12px;font-size:15px">${champLabel(tr)}:
          <strong style="font-size:18px;font-family:'Rajdhani'">${crest(tr.champion, tr.championTeam)}</strong></div>
      </div>
      ${champT&&champT.logo?`<img class="crest" src="${esc(champT.logo)}" alt="">`:''}
    </div>
    ${tr.stages ? '' : `<div class="profile-grid">
      <div class="infobox">
        <div class="ib-title">Final Standings</div>
        <div class="tablewrap" style="border:0;border-radius:0"><table class="data">
          <tbody>${standRows}</tbody></table></div>
      </div>
      <div>${wallSection || (tr.manual?'':'<div class="muted">No roster data.</div>')}</div>
    </div>
    <h2 class="section-title" style="margin-top:24px"><span class="accent-bar"></span>${isElim?'Bracket':'Match Results'}</h2>`}
    ${tr.stages ? finalStandingsSection : ''}
    ${tr.stages ? wallSection : ''}
    ${bracketBlock}`;

  // draw bracket connector lines once laid out
  requestAnimationFrame(()=>document.querySelectorAll(".bkt").forEach(drawConnectors));
  // click a match to open its match page (but let team-name links work)
  app.querySelectorAll("[data-match]").forEach(el=>el.addEventListener("click", e=>{
    if(e.target.closest("a")) return;
    location.hash = `#/match/${slug}/${el.dataset.match}`;
  }));
}

function drawConnectors(bkt){
  const svg = bkt.querySelector(".bkt-svg");
  if(!svg) return;
  const rounds = [...bkt.querySelectorAll(".bkt-round-matches")];
  const brect = bkt.getBoundingClientRect();
  const px = el=>{ const r=el.getBoundingClientRect(); return {x1:r.left-brect.left, x2:r.right-brect.left, y:r.top-brect.top+r.height/2}; };
  let paths = "";
  for(let c=0;c<rounds.length-1;c++){
    const cur = [...rounds[c].querySelectorAll(".bkt-match")];
    const nxt = [...rounds[c+1].querySelectorAll(".bkt-match")];
    if(!nxt.length) continue;
    const oneToOne = nxt.length === cur.length; // losers-bracket carry rounds
    cur.forEach((m,i)=>{
      const target = nxt[oneToOne ? i : Math.floor(i/2)];
      if(!target) return;
      const a = px(m), b = px(target);
      const midX = (a.x2 + b.x1) / 2;
      paths += `<path d="M${a.x2} ${a.y} H${midX} V${b.y} H${b.x1}" fill="none" stroke="var(--border2)" stroke-width="2"/>`;
    });
  }
  svg.style.width = bkt.scrollWidth + "px";
  svg.style.height = bkt.scrollHeight + "px";
  svg.innerHTML = paths;
}
let _bktResize;
window.addEventListener("resize", ()=>{ clearTimeout(_bktResize); _bktResize = setTimeout(()=>document.querySelectorAll(".bkt").forEach(drawConnectors), 150); });

// ---------- generic sortable table ----------
function sortableTable(rows, cols, sortKey){
  const state = {key:sortKey, dir: sortKey==="rank"||sortKey==="#"?1:-1};
  const id = "t"+Math.random().toString(36).slice(2,7);
  const html = `<div id="${id}">${tableHtml(sortData([...rows],cols,state), cols, state)}</div>`;
  setTimeout(()=>{ const el=document.getElementById(id); if(el) wireSort(el, rows, cols, state, s=>{Object.assign(state,s); el.innerHTML=tableHtml(sortData([...rows],cols,state),cols,state); wireSortAgain(el,rows,cols,state);}); },0);
  return html;
}
function wireSortAgain(el,rows,cols,state){ wireSort(el,rows,cols,state,s=>{Object.assign(state,s); el.innerHTML=tableHtml(sortData([...rows],cols,state),cols,state); wireSortAgain(el,rows,cols,state);}); }
function colVal(col, row, i){ const f=col[3]||col[1]; let v=f(row,i); return v; }
function sortData(rows, cols, state){
  const ci = cols.findIndex(c=>c[0]===state.key);
  if(ci<0) return rows;
  const col = cols[ci];
  const acc = col[3] || col[1];  // fall back to the column's value fn, never the whole row
  rows.sort((a,b)=>{
    let va=acc(a), vb=acc(b);
    if(typeof va==="string"||typeof vb==="string"){ va=String(va).toLowerCase(); vb=String(vb).toLowerCase(); return va<vb?-1*state.dir:va>vb?1*state.dir:0; }
    return (va-vb)*state.dir;
  });
  return rows;
}
function tableHtml(rows, cols, state){
  const head = cols.map(c=>{
    const sortable = c[0]!=="#";
    const active = state && state.key===c[0];
    const arrow = active ? (state.dir===1?"▲":"▼") : "";
    return `<th class="${sortable?'':'no-sort'} ${c[2]||''}" data-key="${esc(c[0])}">${esc(c[0])} <span class="arrow">${arrow}</span></th>`;
  }).join("");
  const body = rows.map((r,i)=>"<tr>"+cols.map(c=>`<td class="${c[2]||''}">${c[1](r,i)}</td>`).join("")+"</tr>").join("");
  return `<div class="tablewrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function wireSort(container, rows, cols, state, cb){
  container.querySelectorAll("th").forEach(th=>{
    if(th.classList.contains("no-sort")) return;
    th.onclick=()=>{ const key=th.dataset.key; const dir = state.key===key ? -state.dir : (typeof (cols.find(c=>c[0]===key)[3]||cols.find(c=>c[0]===key)[1])(rows[0],0)==="string"?1:-1); cb({key,dir}); };
  });
}

function notFound(what){ return `<div class="notice" style="margin-top:40px"><h2>${what} not found</h2>
  <p>It may have been renamed. <a href="#/" style="color:var(--link)">Return home</a>.</p></div>`; }

// ---------- search ----------
function setupSearch(){
  const input = $("#search"), box = $("#search-results");
  const index = [
    ...DATA.teams.map(t=>({name:t.name, type:"Team", href:`#/team/${t.slug}`, logo:t.logo})),
    ...allPlayers().map(p=>({name:p.name, type:p.pool==="pro"?"Pro":p.pool==="amateur"?"Amateur":"Solo", href:`#/player/${p.slug}`, sub:p.team})),
    ...(DATA.tournaments||[]).map(t=>({name:t.name, type:"Event", href:`#/tournament/${t.slug}`, sub:t.year})),
  ];
  const seen=new Set(); const uniq=index.filter(x=>{const k=x.href;if(seen.has(k))return false;seen.add(k);return true;});
  function run(){
    const q = input.value.trim().toLowerCase();
    if(q.length<2){ box.classList.remove("show"); return; }
    const hits = uniq.filter(x=>x.name.toLowerCase().includes(q)).slice(0,8);
    if(!hits.length){ box.innerHTML=`<a class="muted" style="pointer-events:none">No matches</a>`; box.classList.add("show"); return; }
    box.innerHTML = hits.map(h=>`<a href="${h.href}">${h.logo?`<img src="${esc(h.logo)}" style="height:20px;width:20px;object-fit:contain">`:''}
      <span>${esc(h.name)}${h.sub?` <span class="muted" style="font-size:11px">${esc(h.sub)}</span>`:''}</span>
      <span class="sr-type">${h.type}</span></a>`).join("");
    box.classList.add("show");
  }
  input.addEventListener("input", run);
  input.addEventListener("focus", run);
  document.addEventListener("click", e=>{ if(!e.target.closest(".search")) box.classList.remove("show"); });
  box.addEventListener("click", ()=>{ box.classList.remove("show"); input.value=""; });
}

// ---------- boot ----------
async function loadData(tries){          // the local server can reset the big data.json; retry transient failures
  tries = tries || 5;
  for(let i=0;i<tries;i++){
    try{ const r = await fetch("data.json?x="+Date.now()); if(!r.ok) throw new Error("HTTP "+r.status); return await r.json(); }
    catch(e){ if(i===tries-1) throw e; await new Promise(x=>setTimeout(x, 300*(i+1))); }
  }
}
function setupNav(){
  const btn = $("#navtoggle"), menu = $("#navcollapse");
  if(!btn || !menu) return;
  const close = ()=>{ menu.classList.remove("open"); btn.setAttribute("aria-expanded","false"); };
  btn.addEventListener("click", ()=>{
    const open = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  menu.addEventListener("click", e=>{ if(e.target.closest("a")) close(); });   // close after picking a link
  window.addEventListener("hashchange", close);                                 // and on any route change
}
loadData().then(async d=>{
  DATA = d;
  try{ _adminOn = ((await (await fetch("/api/state")).json()).admin === true); }catch(e){ _adminOn = false; }
  setupSearch();
  setupRosterPop();
  setupNav();
  window.addEventListener("hashchange", router);
  router();
}).catch(e=>{ app.innerHTML = `<div class="notice"><h2>Couldn't load data</h2><p>${esc(e.message)}</p>
  <p class="muted">If you opened index.html directly, run a local server instead (browsers block fetch on file://).</p></div>`; });

})();
