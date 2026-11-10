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
function pointsBadge(pts){ if(pts==null) return '<span class="muted">—</span>'; return `<span class="rating-badge">${pts}</span>`; }
function levelChip(lvl){ if(!lvl) return '<span class="muted">—</span>'; return `<span class="lvl-chip lvl-${lvl}" title="Level ${lvl}">${lvl}</span>`; }
function levelColor(lvl){ return lvl>=10?'#ff4655':lvl>=8?'#ff8c42':lvl>=5?'#ffce54':lvl>=3?'#3ddc84':'#c7ccd6'; }
// The solo-queue league is open to the WHOLE league: every player appears — with their
// solo-queue record if they have one (folded soloStats, or the solo-only players), or a
// blank/unranked row if they haven't played a solo game yet.
let _soloLeague=null;
function soloLeague(){
  if(_soloLeague) return _soloLeague;
  const out=[], seen=new Set();
  const blank=p=>({name:p.name, iso:p.iso, nat:p.nat, team:p.team, role:p.role, subRole:p.subRole, slug:p.slug, pool:"solo",
    kills:0, assists:0, deaths:0, mvp:0, wins:0, losses:0, maps:0, kdr:0, winrate:0, ratingPoints:null, level:null, rating:null});
  (DATA.players.solo||[]).forEach(p=>{ const k=normKey(p.name); if(seen.has(k)) return; seen.add(k); out.push(p); });
  ["pro","amateur"].forEach(pk=>(DATA.players[pk]||[]).forEach(p=>{
    if(p.shadowAmateur) return;                 // shadow is redundant with the amateur entry
    const k=normKey(p.name); if(seen.has(k)) return; seen.add(k);
    out.push(p.soloStats ? {...p.soloStats, name:p.name, iso:p.iso, nat:p.nat, team:p.team, role:p.role, subRole:p.subRole, slug:p.slug, pool:"solo"}
                         : blank(p));
  }));
  return _soloLeague=out;
}
function teamLogo(t){ return t && t.logo ? `<img src="${esc(t.logo)}" alt="">` : ''; }
function teamCell(name){ const t=teamByName(name); if(!t) return `<span class="team-inline"><span class="muted">${esc(name||"—")}</span></span>`;
  return `<a class="team-inline" href="#/team/${t.slug}">${teamLogo(t)}<span>${esc(t.name)}</span></a>`; }
function rankDeltaBadge(t, since){
  const d = t.rankDelta||0; if(!d) return '';
  const up = d>0, n = Math.abs(d);
  return ` <span class="rank-delta ${up?'up':'down'}" title="${up?'Up':'Down'} ${n} place${n>1?'s':''} since ${since||'the last event'}">${up?'▲':'▼'}${n}</span>`;
}
// title: the hover label (defaults to the country code)
function flag(iso, title){
  if(!iso) return '';
  if(iso==="neutral") return `<span class="flag flag-neutral" title="${esc(title||"Land of Make Believe")}"></span>`;
  return `<img class="flag" src="https://flagcdn.com/20x15/${iso}.png" alt="${esc(iso)}" title="${esc(title||iso.toUpperCase())}" loading="lazy">`;
}
function playerLink(p){
  if(p && p.human) return `${flag(p.iso)}<a href="#/human/${p.slug}">${esc(p.name)}</a>${humanBadge(p)}`;
  return `${flag(p.iso)}<a href="#/player/${p.slug}">${esc(p.name)}</a>`;
}
// Human players (Solo Queue only, DATA.soloHumans): an (ADMIN) or (HUMAN) tag after the name.
function humanBadge(p){
  const admin = p.kind==="admin";
  return `<span class="human-badge${admin?' admin':''}" title="${admin?'League admin':'Human player'}: a person playing alongside the BPL bots">${admin?'ADMIN':'HUMAN'}</span>`;
}
// Rifler sub-roles (build/subroles.py): IGLs are support, AWPers have none.
const SUBROLE_NAME = {entry:"Entry", lurker:"Lurker", anchor:"Anchor", support:"Support"};
const subRoleName = p => SUBROLE_NAME[p.subRole] || '';
// "Rifler · Entry", "IGL · Support", "Awper"
const roleText = p => [p.role, subRoleName(p)].filter(Boolean).join(' · ');
// The leaderboard's short form: a rifler's sub-role, otherwise the role.
const roleShort = p => (p.subRole && !/igl/i.test(p.role||'') ? subRoleName(p) : p.role) || '';
let showHumans = false;
try { showHumans = localStorage.getItem("bpl_show_humans")==="1"; } catch(e) {}
// Advanced stats, recorded by the BPL Bots plugin (from October 2026, so only on maps since then).
// A scoreboard line carries the totals (XS_KEYS, build/parse.py); players get p.adv = {maps, rounds,
// adr, kast, hs, fk, fd, tk, udr, multi:[2k,3k,4k,5k], clutch:[1v1..1v5]}.
const XS_KEYS = ["dmg","ud","hs","fk","fd","tk","k2","k3","k4","k5","c1","c2","c3","c4","c5","kast","rnd"];
let playersView = "basic";            // the leaderboard's Basic / Advanced columns
try { if (localStorage.getItem("bpl_players_view")==="adv") playersView = "adv"; } catch(e) {}
const total = a=>a.reduce((t,x)=>t+x,0);
// A stat grid of someone's advanced stats, or '' when they have none yet.
function advGridHtml(a, stat){
  if(!a || !a.maps) return '';
  const multi = ["2k","3k","4k","5k"].map((l,i)=>a.multi[i]?`${a.multi[i]}× ${l}`:'').filter(Boolean).join(' · ') || 'none yet';
  const clutch = a.clutch.map((n,i)=>n?`${n}× 1v${i+1}`:'').filter(Boolean).join(' · ') || 'none yet';
  return `<div class="adv-head">Advanced <span class="muted">· ${a.maps} map${a.maps===1?'':'s'}, ${a.rounds} rounds recorded with the BPL Bots plugin</span></div>
    <div class="statgrid">
      ${stat(a.adr.toFixed(1),"ADR",true)}
      ${stat(a.kast.toFixed(1)+'%',"KAST")}
      ${stat(a.hs.toFixed(0)+'%',"Headshot kills")}
      ${stat(`${a.fk}–${a.fd}`,"Opening kills–deaths")}
      ${stat(a.tk,"Trade kills")}
      ${stat(a.udr.toFixed(1),"Utility dmg / round")}
      ${stat(total(a.multi.slice(1)),"3k+ rounds")}
      ${stat(total(a.clutch),"Clutches won")}
    </div>
    <div class="adv-detail muted"><span>Multi-kills: ${multi}</span><span>Clutches: ${clutch}</span></div>`;
}
// National teams (BPL Nations Cup) use their country flag as the team badge.
const NATION_ISO = {singapore:'sg',malaysia:'my',philippines:'ph',australia:'au',usa:'us','united states':'us',
  japan:'jp',taiwan:'tw',canada:'ca',netherlands:'nl','united kingdom':'gb',uk:'gb',indonesia:'id',
  germany:'de',korea:'kr','south korea':'kr',thailand:'th',vietnam:'vn','land of make believe':'neutral'};
function nationIso(teamName){
  const m = /^team\s+(.+)$/i.exec((teamName||'').trim());
  return m ? (NATION_ISO[m[1].trim().toLowerCase()]||null) : null;
}
function nationCrest(name, h){  // country flag badge for a "Team <Country>" name, else null
  const iso = nationIso(name); if(!iso) return null;
  h = h||16; const w = Math.round(h*4/3);   // uniform 4:3 box for every flag (object-fit:cover)
  return iso==='neutral'
    ? `<span class="nat-crest flag-neutral" style="height:${h}px;width:${w}px"></span>`
    : `<img class="nat-crest" src="https://flagcdn.com/h40/${iso}.png" style="height:${h}px;width:${w}px" alt="" loading="lazy">`;
}

// ---------- roster hover popups ----------
let PAGE_ROSTERS = [];
function rosterIdx(row){ PAGE_ROSTERS.push(row); return PAGE_ROSTERS.length - 1; }
// map-score hover: for Bo3/Bo5 matches that have been played, hovering a team in
// the bracket shows the per-map score breakdown (from that team's perspective)
// instead of the roster.
let PAGE_MAPSCORES = [];
function mapScoreEntry(m, side){   // returns a PAGE_MAPSCORES index, or null to fall back to roster
  // key off the number of recorded maps, not the bo field (some series are stored as bo=1)
  const maps = m && m.stats && m.stats.maps;
  if(!maps || maps.length < 2) return null;
  const mine = (mp)=> side==='a' ? mp.scoreA : mp.scoreB;
  const theirs = (mp)=> side==='a' ? mp.scoreB : mp.scoreA;
  const list = maps.map((mp,i)=>({ map: mp.map||'', my: mine(mp), opp: theirs(mp) }));
  PAGE_MAPSCORES.push({ team: side==='a'?m.a:m.b, opp: side==='a'?m.b:m.a, maps:list });
  return PAGE_MAPSCORES.length - 1;
}
function mapScorePopHTML(e){
  const head = `<div class="rp-head">${esc(e.team)}<span class="ms-vs"> vs ${esc(e.opp)}</span></div>`;
  const rows = e.maps.map((mp,i)=>{
    const won = mp.my>mp.opp, tie = mp.my===mp.opp;
    return `<div class="ms-row"><span class="ms-map">${mp.map?esc(mp.map):'Map '+(i+1)}</span>`+
      `<span class="ms-sc"><b class="${tie?'':won?'ms-w':'ms-l'}">${mp.my}</b><span class="ms-dash">–</span><span class="${tie?'':won?'ms-l':'ms-w'}">${mp.opp}</span></span></div>`;
  }).join("");
  return head + rows;
}
let _proSlugs = null;
function proSlugs(){  // slugs of players currently on a pro team roster
  if(!_proSlugs){ _proSlugs = new Set(); (DATA.teams||[]).forEach(t=>(t.roster||[]).forEach(p=>_proSlugs.add(p.slug))); }
  return _proSlugs;
}
function rosterPopHTML(row){
  const t = row.teamSlug ? teamBySlug(row.teamSlug) : null;
  const teamName = row.teamSlug ? `<a href="#/team/${row.teamSlug}">${esc(row.team)}</a>` : `<strong>${esc(row.team)}</strong>`;
  const head = `<div class="rp-head">${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}${teamName}<span class="rp-close" title="Close">×</span></div>`;
  if(row.tbc)
    return head + `<div class="rp-row rp-tbc">TBC — the #${row.tbc.place} team of the <a href="#/tournament/${esc(row.tbc.slug)}">${esc(row.tbc.name)}</a></div>`;
  if(!(row.players||[]).length)
    return head + `<div class="rp-row rp-tbc">TBC — qualifier not yet decided</div>`;
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
    let html = null;
    if(el.dataset.mapscore!=null){ const e = PAGE_MAPSCORES[+el.dataset.mapscore]; if(e) html = mapScorePopHTML(e); }
    else if(el.dataset.roster!=null){ const row = PAGE_ROSTERS[+el.dataset.roster]; if(row) html = rosterPopHTML(row); }
    if(html==null) return;
    pop.innerHTML = html; pop.style.display="block";
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth || 220;
    let left = r.left + window.scrollX;
    if(left + w > window.scrollX + window.innerWidth - 10) left = window.scrollX + window.innerWidth - w - 10;
    pop.style.left = Math.max(6, left) + "px";
    pop.style.top = (window.scrollY + r.bottom + 6) + "px";
  };
  document.addEventListener("mouseover", e=>{
    if(_pinned) return;                       // don't swap the popup while pinned
    const el = e.target.closest("[data-roster],[data-mapscore]");
    if(el){ show(el); } else if(e.target.closest("#roster-pop")){ clearTimeout(hideT); }
  });
  document.addEventListener("mouseout", e=>{
    if(_pinned) return;
    if(e.target.closest("[data-roster],[data-mapscore]") || e.target.closest("#roster-pop")) hide();
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
  "players": renderPlayers, "player": renderPlayer, "human": renderHuman,
  "tournaments": renderTournaments, "tournament": renderTournament,
  "rankings": renderRankings,
  "results": renderResults, "scrims": renderScrims, "records": renderRecords, "compare": renderCompare,
  "transfers": renderTransfers, "matches": renderMatches, "awards": renderAwards, "maps": renderMaps, "heatmaps": renderHeatmaps,
  "compareteams": renderTeamCompare, "stats": renderStats,
  "admin": renderAdmin, "match": renderMatch, "predict": renderPredict, "prophets": renderProphets, "fantasy": renderFantasy, "rivalries": renderRivalries, "dle": renderDle,
  "news": renderNews, "article": renderArticle,
};
function parseHash(){
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(x=>x!=="");
  return { route: parts[0]||"home", arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function router(){
  const {route, arg} = parseHash();
  const fn = routes[route] || renderHome;
  document.body.dataset.route = route;   // per-page layout tweaks (e.g. the wider player leaderboard)
  window.scrollTo(0,0);
  PAGE_ROSTERS = []; PAGE_MAPSCORES = [];
  fn(arg);
  liveMarkUpdate();   // LIVE bars on matches being played right now
  renderPromo();   // re-roll the socials promo on each page for even exposure
  document.querySelectorAll(".mainnav a").forEach(a=>{
    const map={team:"teams",player:"players",human:"players",tournament:"tournaments",article:"news",heatmaps:"maps"};
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
  const proQ     = pro.filter(p=>p.maps>=10);   // stat leaders: min 10 maps played
  const byRating = [...pro].sort((a,b)=>b.rating-a.rating).slice(0,5);
  const byKills  = [...proQ].sort((a,b)=>b.kills-a.kills).slice(0,5);
  const byKdr    = [...proQ].sort((a,b)=>b.kdr-a.kdr).slice(0,5);
  const byMvp    = [...proQ].sort((a,b)=>b.mvp-a.mvp).slice(0,5);

  app.innerHTML = `
    ${(DATA.articles&&DATA.articles.length)?`
    <div class="home-news">
      <h2 class="section-title"><span class="accent-bar"></span>Latest News
        <a href="#/news" class="muted" style="margin-left:auto;font-size:12px">All news →</a></h2>
      <div class="news-list">${DATA.articles.slice(0,3).map(newsCard).join('')}</div>
    </div>`:''}
    ${storylinesHtml()}
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
        ${(()=>{ const st = dleStatus(); return `<a class="dle-card${st.done?' done':''}" href="#/dle"><span class="dle-card-ico">🎯</span>
          <span class="dle-card-body"><b>BPL-dle #${st.num}</b><span class="muted">Guess today's mystery player · ${esc(st.text)}</span></span><span class="dle-card-go">${st.done?'Practice →':'Play →'}</span></a>`; })()}
        ${(DATA.tournaments&&DATA.tournaments.length)?`
        <h2 class="section-title"><span class="accent-bar"></span>Latest Results</h2>
        <div class="leader-card" style="margin-bottom:18px">
          ${DATA.tournaments.slice(0,6).map(tr=>`<a class="leader-row lr-result" href="#/tournament/${tr.slug}" style="align-items:center">
            <span class="event-tier ${TIER_CLASS[tr.tier]}">${esc(tr.tierLabel[0]==='M'?'MAJ':tr.tierLabel[0]==='S'?'S':'A')}</span>
            <span class="lr-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tr.name)}</span>
            ${tr.champion?`<span class="lr-val" style="font-size:12px;white-space:nowrap;flex:0 0 auto">🏆 ${esc(tr.champion)}</span>`:`<span class="lr-val muted" style="font-size:11px;white-space:nowrap;flex:0 0 auto">${LIVE.seen[tr.slug]?'<span class="live-dot">●</span> live':'ongoing'}</span>`}</a>`).join("")}
          <div style="margin-top:8px"><a href="#/tournaments" class="muted" style="font-size:12px">All tournaments →</a></div>
        </div>`:''}
        <h2 class="section-title"><span class="accent-bar"></span>Stat Leaders <span class="muted" style="font-size:11px">(pro)</span></h2>
        <div class="leaders">
          ${leader("Rating Points", byRating, p=>p.ratingPoints)}
          ${leader("Total Kills", byKills, p=>p.kills)}
          ${leader("K/D Ratio", byKdr, p=>p.kdr.toFixed(2))}
          ${leader("MVPs", byMvp, p=>p.mvp)}
        </div>
      </div>
    </div>`;
}

// ---- Storylines (build/storylines.py: what just happened, recomputed every build) ----
const STORY_ICON = {live:"●", record:"★", champion:"🏆", promotion:"⬆", transfer:"⇄", top:"♛",
  upset:"⚡", climbers:"▲", streak:"🔥", milestone:"◆"};
function storylinesHtml(){
  const cards = DATA.storylines||[]; if(!cards.length) return '';
  const now = Date.now()/1000;
  const card = c=>{
    const fresh = c.ts && (now-c.ts) < 7*86400;
    const body = c.items
      ? `<div class="story-items">${c.items.map(i=>`<a class="si-row" href="${esc(i.link)}"><span>${esc(i.name)}</span><b>${esc(i.val)}</b></a>`).join("")}</div>`
      : `<div class="story-text">${esc(c.text||"")}</div>`;
    return `<div class="story story-${esc(c.kind)}">
      <div class="story-hd"><span class="story-label"><span class="story-ic">${STORY_ICON[c.kind]||"•"}</span>${esc(c.label)}</span>${fresh?'<span class="story-new">NEW</span>':''}</div>
      <a class="story-title" href="${esc(c.link||'#/')}">${esc(c.title)}</a>${body}</div>`;
  };
  return `<div class="home-stories">
    <h2 class="section-title"><span class="accent-bar"></span>Storylines <span class="muted" style="font-size:11px">what's happening in the league right now</span></h2>
    <div class="story-grid">${cards.map(card).join("")}</div></div>`;
}

// ---- News / Articles ----
function fmtArticleDate(d){ if(!d) return ''; const dt=new Date(d+'T00:00:00'); return isNaN(dt)?d:dt.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}); }
function articleBodyHtml(body){
  const e = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline = s => e(s)
    .replace(/\[([^\]]+)\]\((#[^)\s]+|https?:\/\/[^)\s]+)\)/g,(m,t,h)=>`<a href="${h}">${t}</a>`)  // [text](#/… or https://…)
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>');
  return (body||'').split(/\n\s*\n/).filter(p=>p.trim()).map(p=>`<p>${inline(p.trim()).replace(/\n/g,'<br>')}</p>`).join('');
}
function stripMd(s){ return String(s||"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*/g,""); }
function newsCard(a){
  const snip = stripMd(a.snippet || a.body || "");
  return `<a class="news-card" href="#/article/${esc(a.slug)}">
    <div class="news-date">${fmtArticleDate(a.date)}</div>
    <div class="news-title">${esc(a.title)}</div>
    ${snip?`<div class="news-snip">${esc(snip.length>180?snip.slice(0,180).trimEnd()+"…":snip)}</div>`:''}
    ${a.author?`<div class="news-author">${esc(a.author)}</div>`:''}</a>`;
}
// "Top 20 Players of the Year" countdown series: slugs top-20-players-<year>-<rank>-<name>, #20 published first
const T20_RE = /^top-20-players-(\d{4})-(\d{2})-/;
function t20Series(year){
  return (DATA.articles||[]).map(a=>({a, m:T20_RE.exec(a.slug)})).filter(x=>x.m && x.m[1]===String(year))
    .map(x=>({a:x.a, rank:+x.m[2]})).sort((p,q)=>q.rank-p.rank);        // #20 ... #1, the reading order
}
function t20Name(a){ return a.title.replace(/^Top 20 Players of \d{4}: #\d+ /, ''); }
function renderNews(){
  const arts = DATA.articles||[];
  const regular = arts.filter(a=>!T20_RE.test(a.slug));
  const years = [...new Set(arts.map(a=>(T20_RE.exec(a.slug)||[])[1]).filter(Boolean))].sort((a,b)=>b-a);
  const t20 = years.length ? `<h2 class="section-title" style="margin-top:28px"><span class="accent-bar"></span>Top 20 Players of the Year
      <span class="muted" style="font-size:11px">a countdown, one player a day</span></h2>
    <div class="t20-years">${years.map(y=>{ const s=t20Series(y), one=s.find(x=>x.rank===1), first=s[0];
      return `<div class="t20-card"><div class="t20-y">${y}</div>
        <div class="t20-1"><span class="muted">#1</span> ${one?esc(t20Name(one.a)):'<span class="muted">coming soon</span>'}</div>
        <div class="t20-links">${first?`<a href="#/article/${esc(first.a.slug)}">Start at #${first.rank} →</a>`:''}${one?`<a href="#/article/${esc(one.a.slug)}">Full list</a>`:''}</div></div>`; }).join('')}</div>` : '';
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>News</h2>`+
    (regular.length ? `<div class="news-list">${regular.map(newsCard).join('')}</div>` : (years.length?'':'<p class="muted">No articles yet.</p>'))+t20;
}
function t20NavHtml(a){
  const m = T20_RE.exec(a.slug); if(!m) return '';
  const s = t20Series(m[1]), i = s.findIndex(x=>x.a===a), prev = s[i-1], next = s[i+1];
  return `<div class="t20-nav"><div class="t20-nav-t">Top 20 Players of ${m[1]}</div>
    <div class="t20-chips">${s.map(x=>`<a class="${x.a===a?'on':''}" href="#/article/${esc(x.a.slug)}" title="${esc('#'+x.rank+' '+t20Name(x.a))}">${x.rank}</a>`).join('')}</div>
    <div class="t20-pn">${prev?`<a href="#/article/${esc(prev.a.slug)}">← #${prev.rank} ${esc(t20Name(prev.a))}</a>`:'<span></span>'}
      ${next?`<a href="#/article/${esc(next.a.slug)}">#${next.rank} ${esc(t20Name(next.a))} →</a>`:''}</div></div>`;
}
function renderArticle(slug){
  const a = (DATA.articles||[]).find(x=>x.slug===slug);
  if(!a){ app.innerHTML = notFound('Article'); return; }
  const idx = (DATA.articles||[]).indexOf(a);
  const others = (DATA.articles||[]).filter((_,i)=>i!==idx).slice(0,3);
  app.innerHTML = `
    <div class="crumb"><a href="#/news">News</a><span class="sep">/</span>${esc(a.title)}</div>
    <article class="article">
      <div class="article-date">${fmtArticleDate(a.date)}${a.author?' · '+esc(a.author):''}</div>
      <h1 class="article-title">${esc(a.title)}</h1>
      <div class="article-body">${articleBodyHtml(a.body)}</div>
      ${t20NavHtml(a)}
    </article>
    ${others.length?`<h2 class="section-title" style="margin-top:26px"><span class="accent-bar"></span>More news</h2>
      <div class="news-list">${others.map(newsCard).join('')}</div>`:''}`;
}

function renderTeams(arg){
  teamsRegion = REGION_TABS.some(r=>r.code===arg) ? arg : "";
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
    ["Earnings", t=>t.earnings?fmtUSDc(t.earnings):'—', "mono", t=>t.earnings||0],
    ["Squad value", t=>t.squadValue?fmtUSDc(t.squadValue):'—', "mono", t=>t.squadValue||0],
  ];
  const proTeams = DATA.teams.filter(t=>!t.provisional);
  const region = REGION_TABS.find(r=>r.code===teamsRegion);
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Team Ranking · ${region?esc(region.label):`${proTeams.length} pro teams`}
      <a href="#/rivalries" class="muted" style="margin-left:auto;font-size:12px">⚔ Rivalries</a>
      <a href="#/compareteams" class="muted" style="margin-left:14px;font-size:12px">⇄ Compare teams</a></h2>
    <div class="tabs region-tabs">
      <a href="#/teams" class="${region?'':'active'}">World</a>
      ${REGION_TABS.map(r=>{ const n=regionTeams(r.code).length;
        return (n || r.always) ? `<a href="#/teams/${r.code}" class="${r===region?'active':''}" title="${esc(r.label)}">${r.short} <span style="opacity:.7">${n}</span></a>` : ''; }).join("")}
    </div>
    ${region ? regionRankingHtml(region) : sortableTable(proTeams, cols, "rank")}`;
}

// ---- region rankings (#/teams/<code>): the region's pro teams in BPL ranking order, then its amateur teams
// (no team page, no BPL points) by line-up strength. A team is International when no region has a majority.
const REGION_TABS = [
  {code:"na", short:"NA", label:"North America", always:true}, {code:"sa", short:"SA", label:"South America", always:true},
  {code:"eu", short:"EU", label:"Europe", always:true}, {code:"ea", short:"EA", label:"East Asia", always:true},
  {code:"sea", short:"SEA", label:"SEA", always:true}, {code:"oce", short:"OCE", label:"Oceania", always:true},
  {code:"ca", short:"CA", label:"Central Asia"}, {code:"int", short:"INT", label:"International", always:true},
  {code:"other", short:"Other", label:"Other"},
];
let teamsRegion = "";
function regionTeams(code){
  const r = REGION_TABS.find(x=>x.code===code); if(!r) return [];
  const want = code==="other" ? x=>!x.region || x.region==="Other" : x=>x.region===r.label;
  const pros = DATA.teams.filter(t=>!t.provisional && t.rank && want(t)).sort((a,b)=>a.rank-b.rank).map(t=>({kind:"pro", t}));
  const rest = DATA.teams.filter(t=>t.provisional && want(t)).map(t=>({kind:"prov", t, avg:lineupAvg((t.roster||[]).map(x=>playerBySlug(x.slug)))}))
    .concat((DATA.amateurTeams||[]).filter(want).map(a=>({kind:"am", a, avg:a.avgRP})))
    .sort((x,y)=>(y.avg||0)-(x.avg||0));
  return pros.concat(rest);
}
function lineupAvg(ps){ const v=ps.filter(p=>p&&p.ratingPoints!=null).map(p=>p.ratingPoints); return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null; }
function regionRankingHtml(region){
  const rows = regionTeams(region.code);
  if(!rows.length) return `<p class="muted">No teams from ${esc(region.label)} yet.</p>`;
  // each flag shows the player on hover ("Name · Country") and links to their profile
  const pflag = p=>{ const full = playerBySlug(p.slug)||p;
    return `<a href="#/player/${esc(p.slug)}">${flag(p.iso||'neutral', p.name+(full.nat?' · '+full.nat:''))}</a>`; };
  const flags = ps=>ps.filter(Boolean).map(pflag).join("");
  const nPro = rows.filter(r=>r.kind==="pro").length;
  const body = rows.map((r,i)=>{
    if(r.kind==="am"){ const a=r.a;
      return `<tr class="rr-am"><td class="rankcol">${i+1}</td>
        <td class="name-cell">${a.iso?flag(a.iso):''}<b>${esc(a.name)}</b> <span class="rr-tag">AMATEUR</span></td>
        <td class="muted">—</td><td class="muted">—</td><td class="mono">${a.avgRP!=null?a.avgRP:'—'}</td>
        <td class="rr-flags">${flags(a.players)}</td>
        <td class="muted" style="font-size:12px">${a.lastEvent?`<a href="#/tournament/${a.lastEvent.slug}">${esc(a.lastEvent.name)}</a>`:'—'}</td></tr>`; }
    const t=r.t, ps=(t.roster||[]).map(x=>playerBySlug(x.slug));
    return `<tr${r.kind==="prov"?' class="rr-am"':''}><td class="rankcol">${i+1}</td>
      <td class="name-cell"><span class="tm-rank">${teamCell(t.name)}${t.star?' <span class="star" title="Major winner">★</span>':''}${r.kind==="prov"?' <span class="rr-tag">PROVISIONAL</span>':''}</span></td>
      <td class="mono">${t.rank?'#'+t.rank:'—'}</td><td class="mono" style="color:var(--accent);font-weight:700">${t.rank?t.rank_points:'—'}</td>
      <td class="mono">${lineupAvg(ps)??'—'}</td><td class="rr-flags">${flags(ps)}</td>
      <td class="muted" style="font-size:12px">${t.events_played?`${t.events_played} event${t.events_played===1?'':'s'}`:'—'}</td></tr>`;
  }).join("");
  return `<p class="muted rr-note">${nPro} pro team${nPro===1?'':'s'} in BPL ranking order, then ${rows.length-nPro} amateur team${rows.length-nPro===1?'':'s'} by line-up strength (average Rating Points of the current players).
      ${region.code==="int"?' International: no single region has a majority of the team\'s players.':''}</p>
    <div class="tablewrap"><table class="data region-rank"><thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th>
      <th class="no-sort" title="BPL world ranking">World</th><th class="no-sort">Points</th><th class="no-sort" title="Average Rating Points of the current players">Avg RP</th>
      <th class="no-sort">Players</th><th class="no-sort">Events</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Achievements / lineup / H2H shared helpers ----------
const MEDAL_ICO = {g:'🥇', s:'🥈', b:'🥉'};
function medalOf(e){
  if(e.isChampion || e.placement===1) return 'g';
  if(e.placement===2) return 's';
  if(e.placement===3) return 'b';
  return null;
}
// Trophy cabinet for a team, built from its event placements.
function teamCabinetHtml(t){
  const meds = (t.events||[]).map(e=>({e, m:medalOf(e)})).filter(x=>x.m);
  if(!meds.length) return '';
  meds.sort((a,b)=>(b.e.date||'').localeCompare(a.e.date||''));
  const g=meds.filter(x=>x.m==='g').length, s=meds.filter(x=>x.m==='s').length, b=meds.filter(x=>x.m==='b').length;
  return `<div class="infobox cabinet">
    <div class="ib-title">Podium Finishes</div>
    <div class="medal-tally">
      ${g?`<span class="mt">🥇 ${g}</span>`:''}${s?`<span class="mt">🥈 ${s}</span>`:''}${b?`<span class="mt">🥉 ${b}</span>`:''}
    </div>
    <div class="cab-list">${meds.map(x=>`<a class="cab-row" href="#/tournament/${x.e.slug}">
      <span class="cab-m">${MEDAL_ICO[x.m]}</span>
      <span class="cab-body"><span class="cab-ev">${esc(x.e.name)}</span>
      <span class="cab-sub"><span class="event-tier ${TIER_CLASS[x.e.tier]}">${esc(x.e.tierLabel.toUpperCase())}</span> ${fmtDate(x.e.date)}</span></span></a>`).join("")}</div>
  </div>`;
}
// A player's podium finishes: golds from vetted titles, silver/bronze inferred
// from the placements of teams they were rostered on in the matching years.
function playerMedals(p){
  const golds = (p.titles||[]).map(tt=>({m:'g', ev:tt.event, slug:tt.slug, tier:tt.tier,
    tierLabel:tt.tierLabel, year:String(tt.year), team:tt.team, sort:String(tt.year)+'-99'}));
  const goldKeys = new Set(golds.map(x=>x.slug));
  const seen = new Set(), others = [];
  // server-awarded podiums for ad-hoc teams without a page (e.g. Nations Cup national teams)
  (p.podiums||[]).forEach(pd=>{
    if(goldKeys.has(pd.slug) || seen.has(pd.slug)) return;
    seen.add(pd.slug);
    others.push({m:pd.m, ev:pd.event, slug:pd.slug, tier:pd.tier, tierLabel:pd.tierLabel, year:String(pd.year), team:pd.team, sort:String(pd.year)+'-98'});
  });
  (p.teamHistory||[]).forEach(th=>{
    if(!th.teamSlug) return;
    const tm = teamBySlug(th.teamSlug); if(!tm) return;
    const yrs = new Set((th.years||[]).map(String));
    (tm.events||[]).forEach(e=>{
      const m = medalOf(e); if(!m || m==='g') return;
      const ey = String((e.date||'').slice(0,4));
      if(!yrs.has(ey) || goldKeys.has(e.slug) || seen.has(e.slug)) return;
      seen.add(e.slug);
      others.push({m, ev:e.name, slug:e.slug, tier:e.tier, tierLabel:e.tierLabel, year:ey, team:tm.name, sort:e.date||ey});
    });
  });
  const all = golds.concat(others).sort((a,b)=>(b.sort||'').localeCompare(a.sort||''));
  return {all, g:golds.length, s:others.filter(x=>x.m==='s').length, b:others.filter(x=>x.m==='b').length};
}
// Lineup history: horizontal per-player tenure bars across years, Liquipedia-style.
function lineupTimelineHtml(t){
  const rows = [];
  // years the player spent on a DIFFERENT team (so a gap between two stints here isn't filled in)
  const otherYears = slug => {
    const ph = playerBySlug(slug); const s = new Set();
    if(ph) (ph.teamHistory||[]).forEach(h=>{
      if(h.teamSlug!==t.slug && normKey(h.team||'')!==normKey(t.name)) (h.years||[]).forEach(y=>s.add(Number(y)));
    });
    return s;
  };
  (t.roster||[]).forEach(r=>{
    const ph = playerBySlug(r.slug);
    const th = ph && (ph.teamHistory||[]).find(h=>h.teamSlug===t.slug);
    let yrs = th ? th.years.map(Number) : [];
    if(!yrs.length) yrs = [new Date().getFullYear()];
    rows.push({slug:r.slug, name:r.name, iso:r.iso, role:r.role, years:new Set(yrs), other:otherYears(r.slug), current:true});
  });
  // humans on the team (t.humans, data/solo_humans.json "team"): current, from the year they joined
  (t.humans||[]).forEach(hm=>{
    const jy = Number(String(hm.joined||'').slice(0,4)) || new Date().getFullYear();
    rows.push({slug:hm.slug, human:true, kind:hm.kind, name:hm.name, iso:hm.iso, role:hm.role, years:new Set([jy]), other:new Set(), current:true});
  });
  (t.formerPlayers||[]).forEach(f=>{
    if(f.human){   // a human who left (solo_humans.json "left"): their profile, a free agent now
      rows.push({slug:f.slug, human:true, kind:f.kind, name:f.name, iso:f.iso, role:f.role||'', years:new Set((f.years||[]).map(Number)), other:new Set(), current:false, nowTeam:'Free agent'});
      return;
    }
    rows.push({slug:f.slug, name:f.name, iso:f.iso, role:'', years:new Set((f.years||[]).map(Number)), other:otherYears(f.slug), current:false, nowTeam:f.nowTeam, banned:f.status==='banned', replacedBy:f.replacedBy});
  });
  const withYears = rows.filter(r=>r.years.size);
  if(withYears.length<2) return '';
  const cy = new Date().getFullYear();
  // The recorded years are event-participation years, but a roster persists
  // between events unless it changes — so draw each player's tenure as a solid
  // bar from their first recorded year to their last (or to the present, if
  // they're still on the roster), filling the years the team simply sat out.
  withYears.forEach(r=>{
    const ys=[...r.years];
    r.lo=Math.min(...ys);
    r.hi=r.current?Math.max(cy,...ys):Math.max(...ys);
  });
  const y0 = Math.min(...withYears.map(r=>r.lo)), y1 = Math.max(...withYears.map(r=>r.hi));
  const cols = []; for(let y=y0;y<=y1;y++) cols.push(y);
  // active players first, then most-recent tenure
  withYears.sort((a,b)=> (b.current-a.current) || (b.hi-a.hi) || (a.lo-b.lo));
  const head = `<div class="lt-row lt-head"><div class="lt-name"></div><div class="lt-cells">${cols.map(y=>`<span class="lt-yr">${String(y).slice(2)}</span>`).join("")}</div></div>`;
  const body = withYears.map(r=>{
    const cells = cols.map(y=>{
      // on for recorded years; a gap year is filled only if the player wasn't on another team then
      const on = r.years.has(y) || (y>=r.lo && y<=r.hi && !r.other.has(y));
      const cls = on ? (r.current?'on cur':'on') : 'off';
      return `<span class="lt-cell ${cls}"></span>`;
    }).join("");
    const nm = r.human ? `<a href="#/human/${esc(r.slug)}">${flag(r.iso)}${esc(r.name)}</a>${humanBadge(r)}`
      : r.slug ? `<a href="#/player/${r.slug}">${flag(r.iso)}${esc(r.name)}</a>` : `${flag(r.iso)}${esc(r.name)}`;
    const ttl = esc(r.name)+(r.current?' · current':(r.banned?' · banned'+(r.replacedBy?', replaced by '+r.replacedBy:''):(r.nowTeam?' · now '+esc(r.nowTeam):'')));
    const tag = r.current?'<span class="lt-badge">now</span>':(r.banned?'<span class="lt-badge ban">banned</span>':'');
    return `<div class="lt-row"><div class="lt-name" title="${ttl}">${nm}${tag}</div><div class="lt-cells">${cells}</div></div>`;
  }).join("");
  return `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Lineup History</h2>
    <div class="lineup-tl">${head}${body}</div>`;
}
// Every played match between two teams (scans group stages + bracket), newest first.
function teamMeetings(slugA, slugB){
  const out = [];
  (DATA.tournaments||[]).forEach(tr=>{
    const scan=(matches,pfx)=>matches.forEach(m=>{
      if(!(m.w===1||m.w===2) || !m.aTeam || !m.bTeam) return;
      if(!((m.aTeam===slugA&&m.bTeam===slugB)||(m.aTeam===slugB&&m.bTeam===slugA))) return;
      const aIsA = m.aTeam===slugA;
      out.push({date:tr.date||'', event:tr.name, eventSlug:tr.slug, ref:(m.i!=null?pfx+m.i:null),
        aScore:(aIsA?m.sa:m.sb), bScore:(aIsA?m.sb:m.sa),
        winner:((m.w===1?m.aTeam:m.bTeam)===slugA?'a':'b')});
    });
    if(tr.stages&&tr.stages.length) tr.stages.forEach(st=>st.rounds.forEach(rd=>scan(rd.matches, st.id+"-")));
    else (tr.bracket||[]).forEach(rd=>scan(rd.matches, ""));
  });
  out.sort((x,y)=>(y.date||'').localeCompare(x.date||''));
  return out;
}

function renderTeam(slug){
  const t = teamBySlug(slug);
  if(!t){ app.innerHTML = notFound("Team"); return; }
  const roster = t.roster||[];
  const rosterHtml = roster.map(p=>`<a class="pcard-mini" href="#/player/${p.slug}">
      <div class="avatar">${initials(p.name)}</div>
      <div><div class="pm-name">${flag(p.iso)}${esc(p.name)}</div>
      <div class="pm-sub">${esc(roleText(p)||'—')} ${p.ratingPoints!=null?'· '+p.ratingPoints+' pts · Lvl '+p.level:''}</div></div>
    </a>`).join("") + (t.humans||[]).map(hm=>{
      // a human on the team (data/solo_humans.json): their own profile, their Pro block's points
      const h = (DATA.soloHumans||[]).find(x=>x.slug===hm.slug) || hm, pr = h.pro || {};
      return `<a class="pcard-mini" href="#/human/${esc(hm.slug)}">
      <div class="avatar">${initials(hm.name)}</div>
      <div><div class="pm-name">${flag(hm.iso)}${esc(hm.name)}${humanBadge(hm)}</div>
      <div class="pm-sub">${esc(hm.role||'—')} ${pr.ratingPoints!=null?'· '+pr.ratingPoints+' pts · Lvl '+pr.level:'· plays as the human'}</div></div>
    </a>`; }).join("");

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
    <div class="profile-head${t.color?' tc':''}"${t.color?` style="--tc:${esc(t.color)};--tct:${esc(t.colorText||t.color)}"`:''}>
      ${t.logo?`<img class="ph-mark" src="${esc(t.logo)}" alt="" aria-hidden="true">`:''}
      ${t.logo?`<img class="crest" src="${esc(t.logo)}" alt="">`:''}
      <div class="ph-main">
        <h1>${t.originIso?`<span class="th-flag" title="${esc(t.originCountry||'')}">${flag(t.originIso)}</span>`:''}${esc(t.name)} ${t.star?'<span class="star" title="Major winner">★</span>':''} ${t.tag?`<span class="tag">${esc(t.tag)}</span>`:''}${t.provisional?' <span class="prov-badge" title="Has a profile but is not a pro team yet">PROVISIONAL</span>':''}</h1>
        <div class="ph-sub">${t.region?`<span class="th-region">${esc(t.region)}</span>`:''}${t.provisional?' · <span class="muted">Not a pro team yet — profile only</span>':(t.origin?(' · Earned pro status: '+esc(t.origin)):'')}${t.notes?` · <span class="muted">${esc(t.notes)}</span>`:''}</div>
      </div>
      ${t.provisional
        ? `<div class="ph-rank"><div class="big" style="font-size:15px;color:var(--muted)">Unranked</div><div class="lbl">Not yet pro</div></div>`
        : `<div class="ph-rank"${peakAttr(t.peak)}><div class="big">#${t.rank}</div><div class="lbl">BPL Rank</div></div>`}
      <div class="ph-rank"><div class="big">${t.rank_points}</div><div class="lbl">Points</div></div>
    </div>
    ${_adminOn?`<div class="tc-edit"><span class="muted">Header colour</span><input type="color" id="tc-pick" value="${esc(t.color||'#ff6a3d')}">
      <button id="tc-save" class="loadmore">Save</button>${t.colorSource==='admin'?'<button id="tc-reset" class="loadmore">Use logo colour</button>':''}
      <span class="muted" style="font-size:11px">${t.colorSource==='admin'?'set by you':t.colorSource==='logo'?'taken from the logo':'logo has no clear colour'}</span><span id="tc-msg" class="muted" style="font-size:11px"></span></div>`:''}
    ${t.bio?`<div class="player-bio">${esc(t.bio)}</div>`:''}

    <div class="profile-grid">
      <div class="profile-side">
      <div class="infobox">
        <div class="ib-title">Team Info</div>
        <div class="ib-row"><span class="k">Tag</span><span class="v">${esc(t.tag||'—')}</span></div>
        <div class="ib-row"><span class="k">${t.provisional?'Status':'BPL Rank'}</span><span class="v"${t.provisional?'':peakAttr(t.peak)}>${t.provisional?`Provisional · ${t.rank_points} pts`:`#${t.rank} · ${t.rank_points} pts`}</span></div>
        ${t.teamElo?`<div class="ib-row" title="Results Elo from every completed match (1500 = average). It adds or removes ranking points on top of event placements."><span class="k">Results form</span><span class="v">${t.teamElo} Elo <span style="color:${t.eloPart>=0?'var(--good)':'var(--accent2)'}">(${t.eloPart>=0?'+':''}${t.eloPart} pts)</span></span></div>`:''}
        <div class="ib-row"><span class="k">Region</span><span class="v">${t.region?esc(t.region):'—'}</span></div>
        <div class="ib-row"><span class="k">Country</span><span class="v">${t.originIso?`${flag(t.originIso)} ${esc(t.originCountry||'')}`:'—'}</span></div>
        <div class="ib-row"><span class="k">Origin</span><span class="v">${esc(t.origin||'—')}</span></div>
        <div class="ib-row"><span class="k">Map record</span><span class="v">${t.map_wins}-${t.map_losses}-${t.map_ties}</span></div>
        <div class="ib-row"><span class="k">Win rate</span><span class="v">${pct(t.wlr)}</span></div>
        <div class="ib-row"><span class="k">Events played</span><span class="v">${t.events_played}</span></div>
        <div class="ib-row"><span class="k">Podiums</span><span class="v">${t.podiums} (${t.major_podiums} major)</span></div>
        <div class="ib-row"><span class="k">Trophies</span><span class="v">${trophies.length?esc(trophies.join(' · ')):'—'}</span></div>
        ${t.earnings?`<div class="ib-row" title="Prize money won under this team's name, before it is split between the players"><span class="k">Earnings</span><span class="v">${fmtUSD(t.earnings)}</span></div>`:''}
        ${t.budget!=null&&(t.budget||t.feesIn||t.feesOut)?`<div class="ib-row" title="${esc(`Prize money ${fmtUSD(t.earnings||0)} - fees paid ${fmtUSD(t.feesOut||0)} + fees received ${fmtUSD(t.feesIn||0)}`)}"><span class="k">Budget</span><span class="v" style="${t.budget<0?'color:var(--accent2)':''}">${fmtUSD(t.budget)}</span></div>`:''}
        ${(()=>{ const r=rivalsOf(t.slug)[0]; if(!r) return ''; const me=r.x===t.slug, o=me?r.y:r.x, w=me?r.xw:r.yw, l=me?r.yw:r.xw;
          return `<div class="ib-row" title="Their biggest rivalry: most meetings, finals and close series"><span class="k">Biggest rival</span><span class="v"><a href="#/rivalries" style="color:var(--link)">${esc((teamBySlug(o)||{}).name||o)}</a> <span class="muted" style="font-size:11px">${w}-${l}</span></span></div>`; })()}
        ${t.squadValue?`<div class="ib-row" title="Combined market value of the current roster"><span class="k">Squad value</span><span class="v">${fmtUSD(t.squadValue)}</span></div>`:''}
      </div>
      ${teamCabinetHtml(t)}
      </div>
      <div>
        ${(()=>{ const tt = teamTrophies(t); return tt.length ? `<h2 class="section-title" style="margin-top:0"><span class="accent-bar"></span>Trophy Cabinet
          <span class="muted" style="font-size:11px">${trophyTally(tt)}</span></h2>${trophyShelfHtml(tt)}` : ''; })()}
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
        ${t.provisional?'':historyChartHtml("t-"+t.slug, teamHistorySeries(t), {title:"Ranking History", ptsLabel:"BPL points", time:true,
          note:"BPL points and rank after every completed event · filled dots = events they played"})}
        <h2 class="section-title"><span class="accent-bar"></span>Roster</h2>
        <div class="roster">${rosterHtml||'<p class="muted">No roster on record.</p>'}</div>
        ${(t.formerPlayers&&t.formerPlayers.length)?`
        <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Former Players
          <span class="muted" style="font-size:11px">(${t.formerPlayers.length})</span></h2>
        <div class="roster">${t.formerPlayers.map(f=>{
          const yrs = f.years&&f.years.length ? (f.years.length>1?`${f.years[0]}–${f.years[f.years.length-1]}`:f.years[0]) : '';
          const banned = f.status==='banned';
          const sub = banned
            ? `${yrs?esc(yrs)+' · ':''}<span class="fp-ban">Banned</span>${f.replacedBy?' · replaced by '+esc(f.replacedBy):''}`
            : f.human ? `${f.joined&&f.left?esc(fmtDate(f.joined))+' – '+esc(fmtDate(f.left)):(yrs?esc(yrs):'')} · now: Free agent`
            : `${yrs?esc(yrs)+' · ':''}now: ${f.nowTeam?esc(f.nowTeam):'Teamless'}`;
          const inner = `<div class="avatar">${initials(f.name)}</div>
            <div><div class="pm-name">${flag(f.iso)}${esc(f.name)}${f.human?humanBadge(f):''}</div>
            <div class="pm-sub">${sub}</div></div>`;
          if(f.human) return `<a class="pcard-mini former" href="#/human/${esc(f.slug)}">${inner}</a>`;
          return f.slug ? `<a class="pcard-mini former" href="#/player/${f.slug}">${inner}</a>`
                        : `<div class="pcard-mini former noprofile">${inner}</div>`;
        }).join("")}</div>`:''}
        ${lineupTimelineHtml(t)}
        ${(t.events&&t.events.length)?(()=>{
          const pb={}, pbd={}; (t.points_breakdown||[]).forEach(b=>{ pb[b.slug]=(pb[b.slug]||0)+b.points; pbd[b.slug]=b; });
          const mult=b=>{ if(!b||b.field==null) return ''; const tags=[];
            if(Math.abs(b.field-1)>=0.005) tags.push(`<span class="pts-mult ${b.field>1?'up':'down'}" title="Field strength: how strong the teams they beat were">×${b.field.toFixed(2)}</span>`);
            if(b.core<1) tags.push(`<span class="pts-mult down" title="Core rule: fewer than 3 of the players who earned this are still on the team">core ×${b.core}</span>`);
            return tags.join(''); };
          const tip=b=>b&&b.base!=null?` title="${b.base} placement pts × ${b.field} field × ${b.core} core"`:'';
          return `
        <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Tournament Results <span class="muted" style="font-size:11px">(${t.events.length})</span></h2>
        <div class="tablewrap"><table class="data">
          <thead><tr><th class="no-sort">Date</th><th class="no-sort">Tier</th><th class="no-sort">Event</th><th class="no-sort">Placement</th><th class="no-sort" title="Ranking points earned">Pts</th></tr></thead>
          <tbody>${t.events.map(e=>`<tr>
            <td class="mono">${fmtDate(e.date)}</td>
            <td><span class="event-tier ${TIER_CLASS[e.tier]}">${esc(e.tierLabel.toUpperCase())}</span></td>
            <td class="name-cell"><a href="#/tournament/${e.slug}">${esc(e.name)}</a></td>
            <td>${e.isChampion?'<span class="star">★</span> <strong>Champion</strong>':(e.placementLabel?esc(e.placementLabel):'#'+e.placement)}</td>
            <td class="mono" style="color:var(--accent)"${tip(pbd[e.slug])}>${pb[e.slug]!=null?'+'+Math.round(pb[e.slug]):'—'}${mult(pbd[e.slug])}</td>
          </tr>`).join("")}</tbody></table></div>
        ${t.teamElo?`<div class="muted" style="font-size:11px;margin-top:6px">Ranking points = placements (decaying over 2 years) × field strength × core rule, plus results form: ${t.eloPart>=0?'+':''}${t.eloPart} pts from a ${t.teamElo} results Elo.</div>`:''}`;})():''}
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
  if(_adminOn && $("#tc-save")){
    const send = async color=>{ $("#tc-msg").textContent = "Saving…";
      const r = await apiPost("/api/teamcolor", {team: t.slug, color});
      if(r.ok){ await reloadData(); renderTeam(t.slug); } else $("#tc-msg").textContent = "Error: "+(r.error||"failed"); };
    $("#tc-pick").oninput = e=>{ const h = $(".profile-head"); h.classList.add("tc"); h.style.setProperty("--tc", e.target.value); h.style.setProperty("--tct", e.target.value); };
    $("#tc-save").onclick = ()=>send($("#tc-pick").value);
    const rs = $("#tc-reset"); if(rs) rs.onclick = ()=>send(null);
  }
}

let playersPool = "pro", playersSort = {key:"Rating Points", dir:-1}, playersCountry = "";
function poolList(pk){ return pk==="solo" ? soloLeague() : (DATA.players[pk]||[]); }
// Countries in a pool, most players first: [{iso, nat, n}]
function countryList(list){
  const by = {};
  list.forEach(p=>{ if(!p.iso) return; const c = by[p.iso] || (by[p.iso] = {iso:p.iso, nat:p.nat||p.iso.toUpperCase(), n:0}); c.n++; });
  return Object.values(by).sort((a,b)=>b.n-a.n || a.nat.localeCompare(b.nat));
}
// #/players/<iso> shows one country's players, ranked among themselves.
function renderPlayers(arg){
  if(arg !== undefined) playersCountry = /^[a-z]{2,8}$/.test(arg||'') ? arg : '';
  const pool = playersPool;
  // Solo Queue shows the bots; humans (DATA.soloHumans) only when switched on, with no rank number
  // of their own so the bots' places don't move. Pro: the humans on a team (or with tournament
  // maps), with their Pro block (build/solo_humans.py attach_pro).
  const humans = pool==="solo" ? (DATA.soloHumans||[]) : proHumans();
  const all = humans.length && showHumans ? [...poolList(pool), ...humans] : poolList(pool);
  const countries = countryList(all);
  const country = countries.find(c=>c.iso===playersCountry);
  const players = playersCountry ? all.filter(p=>p.iso===playersCountry) : all;
  const cols = [
    ["#", (p,i)=>p.human?'<span class="muted" title="Humans aren\'t ranked against the bots">—</span>':(p._rk||i+1), "rankcol"],
    ["Player", p=>`<span class="tm-rank">${playerLink(p)}${p.provisional?'<span class="prov-badge" title="Provisional — under 5 maps played">PROV</span>':''}${playersSort.key==="Rating Points"?rankDeltaBadge(p, pool==="solo"?"their last solo game":"their last match"):''}</span>`, "name-cell", p=>p.name],
    ["Team", p=>teamCell(p.team), "", p=>p.team],
    ["Role", p=>roleShort(p)?`<span class="pill role-pill" title="${esc(roleText(p))}">${esc(roleShort(p))}</span>`:'—', "", p=>roleShort(p)],
    ["Rating Points", p=>pointsBadge(p.ratingPoints), "mono", p=>p.ratingPoints==null?-1:p.ratingPoints],
    ["Lvl", p=>levelChip(p.level), "", p=>p.level||0],
    ...(playersView==="adv" ? (()=>{
      const a = (p,f,none)=>p.adv&&p.adv.maps?f(p.adv):none;
      return [
        ["ADR", p=>a(p,x=>x.adr.toFixed(1),'—'), "mono", p=>a(p,x=>x.adr,-1)],
        ["KAST", p=>a(p,x=>x.kast.toFixed(0)+'%','—'), "mono", p=>a(p,x=>x.kast,-1)],
        ["HS%", p=>a(p,x=>x.hs.toFixed(0)+'%','—'), "mono", p=>a(p,x=>x.hs,-1)],
        ["Opening K–D", p=>a(p,x=>`${x.fk}–${x.fd}`,'—'), "mono", p=>a(p,x=>x.fk-x.fd,-1e9)],
        ["Trades", p=>a(p,x=>x.tk,'—'), "mono", p=>a(p,x=>x.tk,-1)],
        ["3k+", p=>a(p,x=>total(x.multi.slice(1)),'—'), "mono", p=>a(p,x=>total(x.multi.slice(1)),-1)],
        ["Clutches", p=>a(p,x=>total(x.clutch),'—'), "mono", p=>a(p,x=>total(x.clutch),-1)],
        ["Rec. maps", p=>a(p,x=>x.maps,'—'), "mono", p=>a(p,x=>x.maps,0)],
      ]; })() : [
    ["K", p=>p.kills, "mono"],
    ["D", p=>p.deaths, "mono"],
    ["KDR", p=>p.maps?p.kdr.toFixed(2):'—', "mono", p=>p.kdr],
    ["MVP", p=>p.mvp, "mono"],
    ["Maps", p=>p.maps, "mono"],
    ["Win%", p=>p.maps?pct(p.winrate):'—', "mono", p=>p.winrate],
    ...(pool==="pro"?[["Value", p=>p.marketValue?fmtUSDc(p.marketValue):'—', "mono", p=>p.marketValue||0],
                      ["Earnings", p=>p.earnings?fmtUSDc(p.earnings):'—', "mono", p=>p.earnings||0]]:[]),
    ]),
  ];
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Player Leaderboard
      <a href="#/compare" class="muted" style="margin-left:auto;font-size:12px">⇄ Compare players</a></h2>
    <div class="pl-filters">
      <div class="tabs">
        ${["pro","solo"].map(k=>`<button data-pool="${k}" class="${k===pool?'active':''}">${
          k==="pro"?"Pro":"Solo Queue"} <span style="opacity:.7">${poolList(k).length}</span></button>`).join("")}
      </div>
      <select id="pl-country" class="pl-country" aria-label="Country">
        <option value="">🌐 All countries (${countries.length})</option>
        ${countries.map(c=>`<option value="${esc(c.iso)}"${c.iso===playersCountry?' selected':''}>${esc(c.nat)} · ${c.n}</option>`).join("")}
        ${playersCountry && !country ? `<option value="${esc(playersCountry)}" selected>${esc(playersCountry.toUpperCase())} · 0</option>` : ''}
      </select>
      <div class="tabs pl-view" title="Advanced: ADR, KAST and the rest, from maps recorded with the BPL Bots plugin">
        <button data-view="basic" class="${playersView==="basic"?'active':''}">Basic</button><button data-view="adv" class="${playersView==="adv"?'active':''}">Advanced</button>
      </div>
      ${humans.length ? `<label class="pl-humans" title="${pool==="solo"?'People who play Solo Queue against the BPL bots':'People who play for BPL teams alongside the bots'}"><input type="checkbox" id="pl-humans"${showHumans?' checked':''}> Show humans &amp; admins <span class="muted">${humans.length}</span></label>` : ''}
    </div>
    ${playersCountry ? (()=>{
      const ranked = players.filter(p=>p.ratingPoints!=null).sort((a,b)=>b.ratingPoints-a.ratingPoints);
      const top = ranked[0];
      const avg = ranked.length ? Math.round(ranked.reduce((t,p)=>t+p.ratingPoints,0)/ranked.length) : null;
      const name = country ? country.nat : playersCountry.toUpperCase();
      return `<div class="country-head">${flag(playersCountry)}<b>${esc(name)}</b>
        <span class="muted">${players.length} player${players.length===1?'':'s'}${top?` · best: ${playerLink(top)} (${top.ratingPoints} pts)`:''}${avg!=null?` · average ${avg} pts`:''}</span>
        <a href="#/players" class="muted country-clear">✕ All countries</a></div>`; })() : ''}
    ${pool==="solo"?'<p class="muted" style="font-size:12px;margin:-4px 0 12px">Whole league · under 5 maps stay provisional (unranked) at the bottom.</p>':''}
    ${playersView==="adv"?'<p class="muted" style="font-size:12px;margin:-4px 0 12px">Advanced stats only exist for maps played with the BPL Bots plugin since October 2026. “Rec. maps” is how many each player has.</p>':''}
    ${players.length ? '<div id="ptable"></div>' : `<p class="muted">No ${pool==="solo"?"solo queue":"pro"} players from ${esc(country?country.nat:playersCountry.toUpperCase())}.</p>`}`;
  app.querySelectorAll("[data-pool]").forEach(b=>b.onclick=()=>{playersPool=b.dataset.pool;playersSort={key:playersView==="adv"?"ADR":"Rating Points",dir:-1};renderPlayers();});
  app.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{
    playersView=b.dataset.view; playersSort={key:playersView==="adv"?"ADR":"Rating Points",dir:-1};
    try { localStorage.setItem("bpl_players_view", playersView); } catch(e) {}
    renderPlayers(); });
  $("#pl-country").onchange = e=>{ location.hash = e.target.value ? "#/players/"+e.target.value : "#/players"; };
  const ht = $("#pl-humans");
  if(ht) ht.onchange = ()=>{ showHumans = ht.checked; try { localStorage.setItem("bpl_show_humans", showHumans?"1":"0"); } catch(e) {} renderPlayers(); };
  if(players.length) drawPlayerTable(players, cols);
}
// Humans as rows of the Pro table: their Pro block over the profile (team, role, no market value).
function proHumans(){
  return (DATA.soloHumans||[]).filter(h=>h.pro && (h.teamSlug || h.pro.maps)).map(h=>({
    ...h, ...h.pro, games: undefined, pool: "pro", human: true, provisional: false,
    team: h.teamSlug ? h.team : null, role: h.role || null, earnings: h.earnings || 0 }));
}
function drawPlayerTable(players, cols){
  const sorted = sortData([...players], cols, playersSort);
  let rk = 0;
  sorted.forEach(p=>{ if(!p.human) p._rk = ++rk; });   // the rank column counts the bots only
  $("#ptable").innerHTML = tableHtml(sorted, cols, playersSort);
  wireSort($("#ptable"), players, cols, playersSort, (s)=>{playersSort=s;drawPlayerTable(players,cols);});
}

// current position on the Pro leaderboard — derived live from the same pool the
// Players/Rankings tabs use, so it stays in sync whenever ratings update.
function proRankOf(p){
  if(!p || p.pool!=="pro" || p.ratingPoints==null) return null;
  const ranked=(DATA.players.pro||[]).filter(x=>x.ratingPoints!=null)
    .sort((a,b)=>b.ratingPoints-a.ratingPoints);          // stable: ties keep tab order
  const i=ranked.findIndex(x=>x.slug===p.slug);
  return i<0?null:{rank:i+1, total:ranked.length};
}
// BPL generation: the year of a player's first tournament. 2020 players are the Founders, 2021 the
// 1st Generation, 2022 the 2nd and so on; no tournament yet counts as joining this year (build/extras.py).
function genLabel(g){ return g===0 ? 'Founder' : `${placeOrd(g)} Generation`; }
function genTip(p){
  return p.joinedNoEvent ? `Hasn't played a BPL tournament yet, so counted as joining in ${p.joined}`
    : `Joined the BPL in ${p.joined}${p.debutEvent?` · first tournament: ${p.debutEvent.name}`:''}`;
}
function genBadge(p){
  if(p.generation==null) return '';
  return `<span class="gen-badge${p.generation===0?' founder':''}" title="${esc(genTip(p))}">${p.generation===0?'★ ':''}${genLabel(p.generation)}</span>`;
}
// #/human/<slug>: a human player's Solo Queue profile (they have no tournament career).
function renderHuman(slug){
  const p = (DATA.soloHumans||[]).find(h=>h.slug===slug);
  if(!p){ app.innerHTML = notFound("Player"); return; }
  const stat = (v,l,acc)=>`<div class="stat${acc?' accent':''}"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;
  const bots = soloLeague().filter(b=>b.ratingPoints!=null).length;
  const place = p.placeAmongBots ? `Would sit <b>#${p.placeAmongBots}</b> of ${bots} on the bots' Solo Queue board`
    : p.maps ? `Provisional: ${p.maps} of 5 maps played before a rating` : 'No Solo Queue games yet';
  const gains = DATA.soloGameStats||{};
  const games = (p.games||[]).map(g=>{
    const gs = (gains[String(g.id)]||{})[normKey(p.name)];
    const gain = gs && gs.gain!=null ? `<span style="color:var(${gs.gain>=0?'--good':'--accent2'})">${gs.gain>=0?'+':''}${gs.gain}</span>` : '<span class="muted">—</span>';
    return `<tr><td class="muted">${esc(g.date||'')}</td><td>${esc(g.map||'—')}</td>
      <td><span class="form-dot ${g.won?'w':'l'}">${g.won?'W':'L'}</span></td>
      <td class="mono">${g.k}-${g.d}-${g.a}</td><td class="mono">${g.mvp}</td><td class="mono">${gain}</td></tr>`;
  }).join("");
  // Pro: a human on a team (build/solo_humans.py attach_pro): their tournament maps, rated like the bots
  const pr = p.pro;
  const teamLink = p.teamSlug ? `<a href="#/team/${esc(p.teamSlug)}" style="color:var(--link)">${esc(p.team)}</a>` : '';
  // left their team (solo_humans.json "left"): a free agent, with the old team linked
  const ft = !p.teamSlug && p.formerTeam;
  const ftLink = ft ? `<a href="#/team/${esc(ft.slug)}" style="color:var(--link)">${esc(ft.name)}</a>` : '';
  const ftNote = ft ? `Free agent · formerly ${ftLink}${ft.role?' ('+esc(ft.role)+')':''}` : '';
  const sc = g=>g.score && g.score[0]!=null ? ` <span class="mono muted">${g.score[0]}-${g.score[1]}</span>` : '';
  const proHtml = !pr ? '' : `
    <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Pro
      <span class="muted" style="font-size:11px">${teamLink?`${teamLink}${p.role?' · '+esc(p.role):''} · `:ft?'Free agent · ':''}${pr.ratingPoints!=null?pr.ratingPoints+' pts · ':''}${pr.maps?`${pr.maps} tournament map${pr.maps===1?'':'s'}`:'no tournament maps yet'}</span></h2>
    ${pr.maps ? `<div class="statgrid">
      ${stat(pr.kills,"Kills")}${stat(pr.deaths,"Deaths")}${stat(pr.kdr.toFixed(2),"K/D Ratio",true)}${stat(pr.mvp,"MVPs")}
      ${stat(pr.assists,"Assists")}${stat((pr.kills/pr.maps).toFixed(1),"Kills / Map")}${stat(pr.wins+'-'+pr.losses,"Record")}${stat(pct(pr.winrate),"Win Rate")}
    </div>${advGridHtml(pr.adv, stat)}`
    : `<p class="muted" style="font-size:13px;margin:0">${teamLink?`On ${teamLink}'s line-up${p.joined?` since ${esc(fmtDate(p.joined))}`:''}. `:''}Their tournament maps show up here once the BPL Bots app sends them.</p>`}
    ${p.earnings?`<div class="muted" style="font-size:12px;margin-top:8px">Prize money: <b style="color:var(--text)">${fmtUSD(p.earnings)}</b>${(p.prizeHistory||[]).map(x=>` · ${esc(x.event)} (${placeOrd(x.place)}): ${fmtUSD(x.amount)}`).join('')}</div>`:''}
    ${pr.games && pr.games.length ? `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Recent tournament maps</h2>
    <div class="tablewrap"><table class="data"><thead><tr><th class="no-sort">Event</th><th class="no-sort">Opponent</th><th class="no-sort">Map</th><th class="no-sort">Result</th><th class="no-sort">K-D-A</th><th class="no-sort">MVP</th></tr></thead><tbody>
    ${pr.games.map(g=>`<tr><td><a href="#/match/${esc(g.slug)}/${esc(g.ref)}">${esc(g.event)}</a></td><td>${esc(g.opp||'')}</td><td>${esc(g.map||'—')}</td>
      <td>${g.won==null?'<span class="muted">—</span>':`<span class="form-dot ${g.won?'w':'l'}">${g.won?'W':'L'}</span>${sc(g)}`}</td>
      <td class="mono">${g.k}-${g.d}-${g.a}</td><td class="mono">${g.mvp}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  app.innerHTML = `
    <div class="crumb"><a href="#/players">Players</a><span class="sep">/</span>${esc(p.name)}</div>
    <div class="profile-head">
      <div class="avatar" style="width:88px;height:88px;border-radius:14px;font-size:34px">${initials(p.name)}</div>
      <div class="ph-main">
        <h1>${flag(p.iso)}${esc(p.name)}${humanBadge(p)}</h1>
        <div class="ph-sub">${p.kind==="admin"?'League admin':'Human player'} · ${teamLink?`${teamLink}${p.role?' · '+esc(p.role):''}`:ftNote||'Solo Queue only'}${p.ingame&&p.ingame.length?` · plays as “${esc(p.ingame.join('”, “'))}”`:''}</div>
        <div style="margin-top:10px">${p.level?`${levelChip(p.level)}<span class="levelchip" style="margin-left:8px">Level ${p.level}</span>`:'<span class="muted">Unranked</span>'}${p.provisional?'<span class="prov-badge" style="margin-left:8px">PROV</span>':''}</div>
      </div>
    </div>
    ${proHtml}
    <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Solo Queue
      <span class="muted" style="font-size:11px">${p.ratingPoints!=null?p.ratingPoints+' pts · ':''}${place}</span></h2>
    <div class="statgrid">
      ${stat(p.kills,"Kills")}
      ${stat(p.deaths,"Deaths")}
      ${stat(p.maps?p.kdr.toFixed(2):'—',"K/D Ratio",true)}
      ${stat(p.mvp,"MVPs")}
      ${stat(p.assists,"Assists")}
      ${stat((p.kills/Math.max(1,p.maps)).toFixed(1),"Kills / Map")}
      ${stat(p.wins+'-'+p.losses,"Record")}
      ${stat(p.maps?pct(p.winrate):'—',"Win Rate")}
    </div>
    ${advGridHtml(p.adv, stat)}
    ${p.playsWith?`<div class="hm-with" title="The teammate they've shared the most Solo Queue games with">🤝 <span class="muted">Most played with</span>
      ${p.playsWith.human?playerLink(p.playsWith):`<a href="#/player/${esc(p.playsWith.slug)}">${flag(p.playsWith.iso)}${esc(p.playsWith.name)}</a>`}
      <span class="muted">· ${p.playsWith.games} solo game${p.playsWith.games===1?'':'s'} together</span></div>`:''}
    <p class="muted" style="font-size:12px;margin:10px 0 0">Humans are rated on the same scale as the bots, but kept off the bots' rankings, awards and records.</p>
    <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Recent Solo Queue games</h2>
    ${games ? `<div class="tablewrap"><table class="data"><thead><tr><th class="no-sort">Date</th><th class="no-sort">Map</th><th class="no-sort">Result</th><th class="no-sort">K-D-A</th><th class="no-sort">MVP</th><th class="no-sort" title="How the game moved their rating points">Pts</th></tr></thead><tbody>${games}</tbody></table></div>`
      : '<p class="muted">No games recorded yet.</p>'}`;
}

function renderPlayer(slug){
  const p = playerBySlug(slug);
  // a human on a team line-up (roster popups, career teams) links here with their h- profile slug
  if(!p && (DATA.soloHumans||[]).some(h=>h.slug===slug)){ renderHuman(slug); return; }
  if(!p){ app.innerHTML = notFound("Player"); return; }
  const t = teamByName(p.team);
  const pr = proRankOf(p);
  const stat = (v,l,acc)=>`<div class="stat${acc?' accent':''}"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;
  const poolName = p.pool==="pro"?"Pro Circuit":p.pool==="amateur"?"Amateur":"Solo Queue";
  app.innerHTML = `
    <div class="crumb"><a href="#/players">Players</a><span class="sep">/</span>${esc(p.name)}</div>
    <div class="profile-head">
      <div class="avatar" style="width:88px;height:88px;border-radius:14px;font-size:34px">${initials(p.name)}</div>
      <div class="ph-main">
        <h1>${flag(p.iso)}${esc(p.name)}</h1>
        <div class="ph-sub">${p.nat?esc(p.nat)+' · ':''}${p.role?esc(roleText(p))+' · ':''}${t?`<a href="#/team/${t.slug}" style="color:var(--link)">${esc(t.name)}</a>`:esc(p.team||'Teamless')} · ${poolName}</div>
        <div style="margin-top:10px">${p.level?`${levelChip(p.level)}<span class="levelchip" style="margin-left:8px">Level ${p.level}</span>`:'<span class="muted">Unranked</span>'}${genBadge(p)}</div>
      </div>
      ${pr?`<div class="ph-rank"${peakAttr(p.peak)}><div class="big">#${pr.rank}</div><div class="lbl">Pro Rank</div></div>`:''}
      <div class="ph-rank"><div class="big">${p.ratingPoints!=null?p.ratingPoints:'—'}</div><div class="lbl">Rating Points</div></div>
    </div>
    ${p.bio?`<div class="player-bio">${esc(p.bio)}</div>`:''}
    <div class="profile-grid">
      <div class="profile-side">
      <div class="infobox">
        <div class="ib-title">Player Info</div>
        ${p.aka&&p.aka.length?`<div class="ib-row"><span class="k">Also known as</span><span class="v" style="font-size:12px">${p.aka.map(esc).join(', ')}</span></div>`:''}
        <div class="ib-row"><span class="k">Team</span><span class="v">${t?`<a href="#/team/${t.slug}" style="color:var(--link)">${esc(t.name)}</a>`:esc(p.team||'—')}</span></div>
        <div class="ib-row"><span class="k">Role</span><span class="v">${esc(p.role||'—')}</span></div>
        ${p.subRole?`<div class="ib-row" title="Their job on the team; the BPL bots play it in game"><span class="k">Sub-role</span><span class="v">${esc(subRoleName(p))}</span></div>`:''}
        <div class="ib-row"><span class="k">Pool</span><span class="v">${poolName}</span></div>
        ${p.joined?`<div class="ib-row" title="${esc(genTip(p))}"><span class="k">Joined BPL</span><span class="v">${p.joined} · ${genLabel(p.generation)}</span></div>`:''}
        ${p.debutEvent?`<div class="ib-row"><span class="k">Debut event</span><span class="v" style="font-size:12px"><a href="#/tournament/${esc(p.debutEvent.slug)}" style="color:var(--link)">${esc(p.debutEvent.name)}</a></span></div>`
          :p.joinedNoEvent?`<div class="ib-row"><span class="k">Debut event</span><span class="v muted" style="font-size:12px">None yet</span></div>`:''}
        <div class="ib-row"><span class="k">Rating Points</span><span class="v">${p.ratingPoints!=null?p.ratingPoints:'—'}</span></div>
        ${pr?`<div class="ib-row"><span class="k">Pro Rank</span><span class="v"${peakAttr(p.peak)}>#${pr.rank} <span class="muted" style="font-size:11px">of ${pr.total}</span></span></div>`:''}
        <div class="ib-row"><span class="k">Level</span><span class="v">${p.level||'—'} / 10</span></div>
        <div class="ib-row"><span class="k">Record</span><span class="v">${p.wins}-${p.losses} (${pct(p.winrate)})</span></div>
        <div class="ib-row"><span class="k">Maps</span><span class="v">${p.maps}</span></div>
        ${p.marketValue?`<div class="ib-row" title="${esc(valueTip(p))}"><span class="k">Market value</span><span class="v">${fmtUSD(p.marketValue)}</span></div>`:''}
        ${p.earnings?`<div class="ib-row"><span class="k">Earnings</span><span class="v">${fmtUSD(p.earnings)}</span></div>`:''}
        ${p.playsWith?`<div class="ib-row"><span class="k">Plays with</span><span class="v"><a href="#/player/${p.playsWith.slug}" style="color:var(--link)">${flag(p.playsWith.iso)}${esc(p.playsWith.name)}</a> <span class="muted" style="font-size:11px">· ${p.playsWith.games} solo game${p.playsWith.games===1?'':'s'}</span></span></div>`:''}
      </div>
      ${((p.awards&&p.awards.length)||(p.mvpAwards&&p.mvpAwards.length))?`<div class="infobox prize-box"><div class="ib-title">Awards</div>
        <div class="aw-shelf">${[...(p.awards||[]), ...(p.mvpAwards||[]).map(m=>({...m, mvpOf:true}))].sort((a,b)=>String(b.year).slice(0,4).localeCompare(String(a.year).slice(0,4)) || (a.rank?2:a.mvpOf?1:0)-(b.rank?2:b.mvpOf?1:0) || (a.rank||0)-(b.rank||0)).map(a=>{
          if(a.mvpOf) return `<a class="aw-chip" href="#/tournament/${esc(a.slug)}" title="${esc(`Event MVP of ${a.event} · open the event`)}">⭐ <span>MVP <span class="muted">· ${esc(a.event)}</span></span></a>`;
          if(a.rank) return `<a class="aw-chip t20" href="${esc(a.link||'#/news')}" title="${esc(`${placeOrd(a.rank)} best player of ${a.year} in the BPL Top 20 Players of the Year · read the article`)}">🏅 <b>#${a.rank}</b> Top 20 Players of ${esc(String(a.year))}</a>`;
          const ic=a.award==='Player of the Year'?'🏆':a.award==='Rookie of the Year'?'🌱':a.award==='Most Improved Player'?'📈':'⭐';
          const yr=String(a.year).includes('-')?(()=>{const [y,m]=String(a.year).split('-'); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]+' '+y;})():a.year;
          return `<a class="aw-chip" href="#/awards">${ic} ${esc(a.award)} <span class="muted">${esc(String(yr))}</span></a>`; }).join("")}</div></div>`:''}
      ${(p.prizeHistory&&p.prizeHistory.length)?`<div class="infobox prize-box"><div class="ib-title">Prize Money <span class="muted" style="font-size:11px;font-weight:400">${fmtUSD(p.earnings)} · ${p.prizeHistory.length} event${p.prizeHistory.length===1?'':'s'}</span></div>
        <div class="pz-list">${p.prizeHistory.map(h=>`<a class="pz-row" href="#/tournament/${esc(h.slug)}" title="${esc(`${h.event}: ${placeOrd(h.place)} with ${h.team}, ${fmtUSD(h.amount)}`)}"><span class="pz-ev">${esc(h.event)}<span class="muted"> · ${placeOrd(h.place)} with ${esc(h.team)}</span></span><span class="pz-amt">${fmtUSD(h.amount)}</span></a>`).join("")}</div></div>`:''}
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
        ${advGridHtml(p.adv, stat)}
        ${p.soloStats?(()=>{const s=p.soloStats;return `
        <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Solo Queue
          <span class="muted" style="font-size:11px">${s.level?'Level '+s.level:''}${s.ratingPoints!=null?' · '+s.ratingPoints+' pts':''}${s.soloRank?' · #'+s.soloRank+' of '+s.soloTotal:''}</span></h2>
        <div class="statgrid">
          ${stat(s.kills,"Kills")}
          ${stat(s.deaths,"Deaths")}
          ${stat(s.kdr.toFixed(2),"K/D Ratio",true)}
          ${stat(s.mvp,"MVPs")}
          ${stat(s.assists,"Assists")}
          ${stat((s.kills/Math.max(1,s.maps)).toFixed(1),"Kills / Map")}
          ${stat(s.wins+'-'+s.losses,"Record")}
          ${stat(pct(s.winrate),"Win Rate")}
        </div>
        ${advGridHtml(s.adv, stat)}`;})():''}
        ${(()=>{ const log=playerFormLog(p.slug); if(!log.length) return '';
          const last=log.slice(-10); const w=last.filter(x=>x.won===true).length, l=last.filter(x=>x.won===false).length;
          const avg=last.reduce((a,x)=>a+x.rtg,0)/last.length;
          return `<h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Recent Form
            <span class="muted" style="font-size:11px">last ${last.length} map${last.length===1?'':'s'} · ${w}-${l} · ${avg.toFixed(2)} avg RTG</span></h2>
            <div class="form-row">${formDots(log)}${formSpark(log)}</div>`; })()}
        ${historyChartHtml("p-"+p.slug, playerHistorySeries(p), {title:"Rating History", ptsLabel:"Rating points",
          note:"after every recorded match · hover for details, click a point to open the event"})}
        ${(()=>{ const ms=playerMapStats(playerFormLog(p.slug)); if(!ms) return '';
          const wr=m=>`${Math.round(m.wr*100)}% <span class="pmap-rec">${m.w}-${m.l}</span>`;
          const bg=m=> VETO_IMG[m.map] ? `<div class="pmap-bg" style="background-image:url('assets/maps/${VETO_IMG[m.map]}')"></div>` : '';
          const card=(cls,ico,label,m,detail)=> m?`<div class="pmap ${cls}">${bg(m)}
            <div class="pmap-b"><span class="pmap-l">${ico} ${label}</span><span class="pmap-m">${esc(m.map)}</span>
            <span class="pmap-d">${detail(m)}</span></div></div>`:'';
          const cards=[
            card('fav','⭐','Favorite Map',ms.favorite,m=>`${m.played} map${m.played===1?'':'s'} played`),
            card('best','🟢','Best Map',ms.best,wr),
            (ms.worst&&ms.best&&ms.worst.map!==ms.best.map)?card('worst','🔴','Worst Map',ms.worst,wr):''
          ].join('');
          return `<h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Maps</h2>
            <div class="pmap-cards">${cards}</div>`; })()}
        ${(()=>{
          const med = playerMedals(p);
          if(!med.all.length) return '';      // (event MVPs sit with the other awards, in the Awards box)
          const tally=[];
          if(med.g) tally.push(`🥇 ${med.g}`);
          if(med.s) tally.push(`🥈 ${med.s}`);
          if(med.b) tally.push(`🥉 ${med.b}`);
          const medHtml = med.all.map(x=>`<a class="honor" href="#/tournament/${x.slug}">
             <span class="honor-ico">${MEDAL_ICO[x.m]}</span>
             <span class="honor-body"><span class="honor-ev">${esc(x.ev)}</span>
             <span class="honor-sub"><span class="event-tier ${TIER_CLASS[x.tier]}">${esc(x.tierLabel.toUpperCase())}</span> ${x.year} · ${esc(x.team)}</span></span></a>`).join("");
          const tt = playerTrophies(p);
          return `${tt.length?`<h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Trophy Cabinet
            <span class="muted" style="font-size:11px">${trophyTally(tt)}</span></h2>${trophyShelfHtml(tt, true)}`:''}
            <h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>Achievements
            <span class="muted" style="font-size:11px">${tally.join(' · ')}</span></h2>
            <div class="honors">${medHtml}</div>`;
        })()}
      </div>
    </div>`;
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
  const proQ = pro.filter(p=>p.maps>=10);   // rate boards (K/D, Win%) need a real sample
  const topQ = (key,n=10)=>[...proQ].sort((a,b)=>b[key]-a[key]).slice(0,n);
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Team Points Ladder</h2>
    <div class="tablewrap"><table class="data">
      <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th><th class="no-sort">Points</th>
        <th class="no-sort">Majors</th><th class="no-sort">S-Tier</th><th class="no-sort">Events</th></tr></thead>
      <tbody>${DATA.teams.filter(t=>!t.provisional).map(t=>`<tr><td class="rankcol">${t.rank}</td><td class="name-cell"><span class="tm-rank">${teamCell(t.name)}${rankDeltaBadge(t)}</span></td>
        <td class="mono" style="color:var(--accent);font-weight:700">${t.rank_points}</td>
        <td class="mono">${t.major_wins||'–'}</td><td class="mono">${t.s_tier_wins||'–'}</td><td class="mono">${t.events_played}</td></tr>`).join("")}</tbody></table></div>
    <h2 class="section-title" style="margin-top:26px"><span class="accent-bar"></span>Player Leaderboards <span class="muted" style="font-size:11px">(pro)</span></h2>
    <div class="grid" style="grid-template-columns:repeat(2,1fr)">
      ${board("Rating Points", top("rating"), p=>p.ratingPoints, true)}
      ${board("Total Kills", top("kills"), p=>p.kills)}
      ${board(`K/D Ratio <span class="muted" style="font-size:10px;font-weight:400">min 10 maps</span>`, topQ("kdr"), p=>p.kdr.toFixed(2))}
      ${board("MVPs", top("mvp"), p=>p.mvp)}
      ${board("Assists", top("assists"), p=>p.assists)}
      ${board(`Win Rate <span class="muted" style="font-size:10px;font-weight:400">min 10 maps</span>`, topQ("winrate"), p=>pct(p.winrate))}
    </div>`;
}

// ---------- Results feed ----------
let _allMatches = null, _allMapScores = null;
// every played map's round score: the per-map scoreboards where recorded (so each map of a Bo3
// counts), else the match score when it IS a round score (a Bo1: 13+ total rounds, not "2-1")
function allMapScores(){
  if(_allMapScores) return _allMapScores;
  const out = [];
  (DATA.tournaments||[]).forEach(tr=>{
    const ms = (tr.stages&&tr.stages.length) ? tr.stages.flatMap(st=>st.rounds.flatMap(rd=>rd.matches))
                                             : (tr.bracket||[]).flatMap(rd=>rd.matches);
    ms.forEach(m=>{
      if(m.w!==1 && m.w!==2) return;
      if(m.a==="(bye)" || m.b==="(bye)") return;
      const scored = ((m.stats&&m.stats.maps)||[]).filter(mp=>mp.scoreA!=null&&mp.scoreB!=null&&mp.scoreA!==""&&mp.scoreB!=="");
      const base = {a:m.a, b:m.b, eventSlug:tr.slug, date:tr.date, ts:m.ts};
      if(scored.length) scored.forEach(mp=>out.push({...base, sa:+mp.scoreA, sb:+mp.scoreB, map:mp.map||""}));
      else if(m.sa!=null && m.sb!=null && m.sa+m.sb>=13) out.push({...base, sa:m.sa, sb:m.sb, map:""});
    });
  });
  // same order as allMatches() (newest first), so ties resolve exactly as the records always have
  out.sort((x,y)=> x.date<y.date?1 : x.date>y.date?-1 : (y.ts||0)-(x.ts||0));
  _allMapScores = out; return out;
}
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

// ---------- Scrims (#/scrims): practice games picked as scrims in the BPL Bots app ----------
// They're in site/scrims.json (bpl-bots lib/scrim.js), apart from data.json, and only this page reads
// them, so they never reach a player's or team's stats, the rankings or the records.
let _scrims = [], _scrimOpen = null, scrimQ = "", scrimsShown = 50, _scrimPeople = null;
function renderScrims(){
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Scrims</h2><p class="muted">Loading…</p>`;
  fetch("scrims.json", {cache:"no-cache"}).then(r=>r.ok?r.json():[]).catch(()=>[]).then(list=>{
    if(parseHash().route!=="scrims") return;
    _scrims = (Array.isArray(list)?list:[]).slice().sort((a,b)=>(b.time||0)-(a.time||0));
    drawScrims();
  });
}
// Names to profiles, so the scoreboard links them the way a match page does.
function scrimWithPeople(s){
  if(!_scrimPeople){
    _scrimPeople = {};
    ["pro","amateur","solo"].forEach(k=>(DATA.players[k]||[]).forEach(p=>{ _scrimPeople[normKey(p.name)] = {slug:p.slug, iso:p.iso}; }));
    (DATA.soloHumans||[]).forEach(h=>{
      const me = {slug:null, hslug:h.slug, human:true, kind:h.kind, iso:h.iso};
      _scrimPeople[normKey(h.name)] = me;
      (h.ingame||[]).forEach(n=>{ if(!_scrimPeople[normKey(n)]) _scrimPeople[normKey(n)] = me; });
    });
  }
  return {...s, maps:s.maps.map(m=>({...m, players:m.players.map(p=>({...p, ...(_scrimPeople[normKey(p.name)]||{})}))}))};
}
function drawScrims(){
  const q = scrimQ.toLowerCase();
  const list = q ? _scrims.filter(s=>s.a.toLowerCase().includes(q)||s.b.toLowerCase().includes(q)) : _scrims;
  const shown = list.slice(0, scrimsShown);
  const teamHtml = (name, win)=>{
    const t = teamByName(name);
    return `<span class="team-inline ${win?'rwin':''}">${t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:''}<span>${t?`<a href="#/team/${t.slug}">${esc(name)}</a>`:esc(name)}</span></span>`;
  };
  const rows = shown.map(s=>{
    // a single map shows its rounds, a series its maps won
    const single = (s.bestOf||1)<2 && s.maps.length===1;
    const sa = single ? s.maps[0].scoreA : s.maps.filter(m=>m.scoreA>m.scoreB).length;
    const sb = single ? s.maps[0].scoreB : s.maps.filter(m=>m.scoreB>m.scoreA).length;
    const open = s.id===_scrimOpen;
    return `<tr class="scrim-row${open?' open':''}" data-scrim="${esc(s.id)}">
      <td class="mono muted">${fmtDate(s.date)}</td>
      <td class="muted scrim-bo">Bo${s.bestOf||1}</td>
      <td style="text-align:right">${teamHtml(s.a, sa>sb)}</td>
      <td class="mono rscore">${sa} <span class="muted">:</span> ${sb}</td>
      <td>${teamHtml(s.b, sb>sa)}</td>
      <td class="muted scrim-maps">${s.maps.map(m=>`${esc(m.map)} ${m.scoreA}–${m.scoreB}`).join(" · ")}</td>
      <td class="scrim-chev"><button aria-expanded="${open}" aria-label="${open?'Hide':'Show'} the scoreboard">${open?'▾':'▸'}</button></td>
    </tr>${open?`<tr class="scrim-detail"><td colspan="7"><div id="sb-container"></div></td></tr>`:''}`;
  }).join("");
  const nMaps = list.reduce((n,s)=>n+s.maps.length,0);
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Scrims <span class="muted" style="font-size:11px">(${list.length} scrim${list.length===1?'':'s'} · ${nMaps} map${nMaps===1?'':'s'})</span></h2>
    <div class="tabs" style="align-items:center">
      <span class="muted" style="font-size:13px">Practice games. They don't count towards any player or team stats, the rankings or the records.</span>
      <input id="scrims-q" class="rq" type="text" placeholder="Filter by team…" value="${esc(scrimQ)}">
    </div>
    ${rows?`<div class="tablewrap"><table class="data results-table"><tbody>${rows}</tbody></table></div>`
      :`<p class="muted">${_scrims.length?'No scrims for that team.':'No scrims yet. Pick Scrim in the BPL match menu of the BPL Bots app and the game shows up here.'}</p>`}
    ${shown.length<list.length?`<div style="text-align:center;margin-top:14px"><button id="scrims-more" class="loadmore">Load more (${list.length-shown.length} left)</button></div>`:''}`;
  app.querySelectorAll(".scrim-row").forEach(r=>r.onclick=e=>{
    if(e.target.closest("a")) return;
    _scrimOpen = _scrimOpen===r.dataset.scrim ? null : r.dataset.scrim;
    drawScrims();
  });
  const qi=$("#scrims-q"); if(qi) qi.oninput=()=>{scrimQ=qi.value.trim();scrimsShown=50;drawScrims();const e=$("#scrims-q");if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}};
  const mb=$("#scrims-more"); if(mb) mb.onclick=()=>{scrimsShown+=50;drawScrims();};
  const openS = shown.find(s=>s.id===_scrimOpen);
  if(openS){   // the match page's scoreboard: map tabs, ADR, rating
    const ta = teamByName(openS.a), tb = teamByName(openS.b);
    _sbMatch = {a:openS.a, b:openS.b, aTeam:ta?ta.slug:null, bTeam:tb?tb.slug:null, stats:{maps:scrimWithPeople(openS).maps}};
    _sbTab = openS.maps.length>1 ? 'all' : 0;
    renderScoreboard();
  }
}

// ---------- Records / Hall of Fame ----------
// overtime periods a map's final round score implies (mirrors build/parse.py): reaching 12-12
// forces OT (MR3, first to 4), so the loser needs >=12 and the winner's rounds past 13 come in
// blocks of 3 (tied OTs) plus the deciding 4.
function otPeriods(a,b){
  if(a==null||b==null) return 0;
  const hi=Math.max(a,b), lo=Math.min(a,b);
  if(lo<12||hi===lo) return 0;
  return Math.max(1, Math.round((hi-13)/3));
}
// longest run of consecutive map wins by any single player, in real recorded order (by ts)
function playerLongestStreak(){
  const byslug={};
  (DATA.tournaments||[]).forEach(tr=>{
    const scan=matches=>matches.forEach(m=>{ if(!m.stats||!m.stats.maps) return;
      m.stats.maps.forEach(mp=>{ if(mp.scoreA===mp.scoreB) return;
        const tot=(mp.scoreA||0)+(mp.scoreB||0); if(!tot) return;
        (mp.players||[]).forEach(pl=>{ if(!pl.slug) return;
          const onA=normKey(pl.team)===normKey(m.a);
          const won=onA?mp.scoreA>mp.scoreB:mp.scoreB>mp.scoreA;
          (byslug[pl.slug]=byslug[pl.slug]||[]).push({ts:m.ts||0, name:pl.name, won});
        });
      });
    });
    if(tr.stages&&tr.stages.length) tr.stages.forEach(st=>st.rounds.forEach(rd=>scan(rd.matches)));
    else (tr.bracket||[]).forEach(rd=>scan(rd.matches));
  });
  let best=null; const all=[];
  Object.entries(byslug).forEach(([slug,lst])=>{
    lst.sort((a,b)=>a.ts-b.ts);
    let cur=0, mx=0;
    lst.forEach(x=>{ cur=x.won?cur+1:0; if(cur>mx) mx=cur; });
    all.push({slug, name:lst[0].name, len:mx});
    if(!best||mx>best.len) best={slug, name:lst[0].name, len:mx};
  });
  if(best) best.all=all;
  return best;
}
// The rest of the Records tab, worked out from every recorded match in one pass. recBest keeps the highest
// value seen and everyone level with it; events are read oldest first, so a card's holder is the first to get there.
function recBest(){
  const b={val:null, rows:[], who:new Set(), all:[]};   // all: every entry, for the card's top 10
  b.add=(v,row,who)=>{ if(v==null||!isFinite(v)) return;
    b.all.push({v,row,who});
    if(b.val==null||v>b.val){ b.val=v; b.rows=[row]; b.who=new Set([who]); }
    else if(v===b.val&&!b.who.has(who)){ b.who.add(who); b.rows.push(row); } };
  return b;
}
function extendedRecords(){
  const bests={}, best=k=>bests[k]||(bests[k]=recBest());
  const pos=(k,v,row,who)=>{ if(v>0) best(k).add(v,row,who); };
  const players=new Map(allPlayers().map(p=>[p.slug,p]));
  const mapCount={}, overtime={}, veto={ban:{},pick:{},decider:{}}, titleYears={}, evCount={}, byMap={};
  const bump=(o,k)=>{ if(k) o[k]=(o[k]||0)+1; };
  [...(DATA.tournaments||[])].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).forEach(tr=>{
    const ev={event:tr.name, eventSlug:tr.slug};
    const ms=((tr.stages&&tr.stages.length) ? tr.stages.flatMap(st=>st.rounds.flatMap(rd=>rd.matches.map(m=>({m,ref:`${st.id}-${m.i}`}))))
      : (tr.bracket||[]).flatMap(rd=>rd.matches.map(m=>({m,ref:m.i!=null?`${m.i}`:null})))).sort((x,y)=>(x.m.ts||0)-(y.m.ts||0));
    const champ=normKey(tr.champion), evK={};
    let mw=0, ml=0, played=0;
    ms.forEach(({m,ref})=>{
      const at={...ev, ref};
      if((m.w===1||m.w===2)&&m.a!=="(bye)"&&m.b!=="(bye)"){
        played++;
        const pa=m.odds!=null?m.odds:m.tE;               // the same pre-match chance as the Best Upset award
        if(pa!=null){ const c=m.w===1?pa:1-pa, [w,l,sw,sl]=m.w===1?[m.a,m.b,m.sa,m.sb]:[m.b,m.a,m.sb,m.sa];
          best('upset').add(-c,{...at,name:`${w} over ${l}`,chance:c,score:sw!=null?`${sw}–${sl}`:''},`${tr.slug}|${ref}`); }
        const onA=normKey(m.a)===champ, onB=normKey(m.b)===champ;
        if(champ&&(onA||onB)&&!m.tp&&!m.pl&&m.sa!=null&&m.sb!=null){   // a series score, or one map's rounds
          const series=Math.max(m.sa,m.sb)<=5, [x,y]=onA?[m.sa,m.sb]:[m.sb,m.sa];
          mw+=series?x:(x>y?1:0); ml+=series?y:(y>x?1:0); }
      }
      (((m.stats&&m.stats.veto&&m.stats.veto.steps))||[]).forEach(s=>{ if(veto[s.action]) bump(veto[s.action],s.map); });
      if(m.elo) Object.entries(m.elo).forEach(([slug,path])=>{
        const p=players.get(slug), vals=(path||[]).filter(v=>v!=null); if(!p||vals.length<2) return;
        const row={...at,name:p.name,slug}, d=vals[vals.length-1]-vals[0];
        pos('gain',d,row,slug); pos('drop',-d,row,slug); pos('peak',Math.max(...vals),row,slug);
      });
      const tot={}; let seriesRounds=0, seriesMaps=0, matchK=0;
      ((m.stats&&m.stats.maps)||[]).forEach(mp=>{
        const rounds=(mp.scoreA||0)+(mp.scoreB||0); if(!rounds) return;
        seriesRounds+=rounds; seriesMaps++;
        bump(mapCount,mp.map);
        if(otPeriods(mp.scoreA,mp.scoreB)) bump(overtime,mp.map);
        pos('mapOT',otPeriods(mp.scoreA,mp.scoreB),{...at,name:mp.map||'Map',score:`${mp.scoreA}-${mp.scoreB}`},`${tr.slug}|${ref}|${seriesMaps}`);
        const M=mp.map?(byMap[mp.map]=byMap[mp.map]||{n:0,k:recBest(),rtg:recBest(),adr:recBest(),pl:{}}):null;
        if(M) M.n++;
        (mp.players||[]).forEach(pl=>{
          const who=pl.slug||pl.hslug||pl.name, id={name:pl.name,slug:pl.slug,hslug:pl.hslug}, row={...id,...at,map:mp.map};
          const onA=normKey(pl.team)===normKey(m.a), lost=mp.scoreA!==mp.scoreB&&(onA?mp.scoreA<mp.scoreB:mp.scoreB<mp.scoreA);
          const rtg=matchRating(pl.k,pl.a,pl.d,pl.score,rounds);
          matchK+=pl.k||0; pos('mapK',pl.k,row,who); pos('mapRtg',rtg,row,who);
          if(M){
            if(pl.k>0) M.k.add(pl.k,row,who);
            if(rtg>0) M.rtg.add(rtg,row,who);
            if(pl.rnd>0) M.adr.add(Math.round(pl.dmg/pl.rnd*10)/10,row,who);
            const c=M.pl[who]=M.pl[who]||{...id,k:0,a:0,d:0,score:0,rounds:0,maps:0};
            c.k+=pl.k||0; c.a+=pl.a||0; c.d+=pl.d||0; c.score+=pl.score||0; c.rounds+=rounds; c.maps++;
          }
          pos('spread',(pl.k||0)-(pl.d||0),row,who); pos('assists',pl.a,row,who); pos('stars',pl.mvp,row,who);
          if(lost) pos('lossK',pl.k,row,who);
          if(pl.rnd>0){
            pos('adr',Math.round(pl.dmg/pl.rnd*10)/10,row,who); pos('hs',pl.hs,row,who); pos('fk',pl.fk,row,who); pos('aces',pl.k5,row,who);
            pos('multi',(pl.k2||0)+(pl.k3||0)+(pl.k4||0)+(pl.k5||0),row,who); pos('clutch',(pl.c1||0)+(pl.c2||0)+(pl.c3||0)+(pl.c4||0)+(pl.c5||0),row,who);
          }
          const s=tot[who]=tot[who]||{...id,k:0,a:0,d:0,score:0};
          s.k+=pl.k||0; s.a+=pl.a||0; s.d+=pl.d||0; s.score+=pl.score||0;
          const e=evK[who]=evK[who]||{...id,k:0}; e.k+=pl.k||0;
        });
      });
      pos('matchK',matchK,{...at,name:`${m.a} vs ${m.b}`,maps:seriesMaps},`${tr.slug}|${ref}`);
      if(seriesMaps>=2){
        pos('seriesRounds',seriesRounds,{...at,name:`${m.a} vs ${m.b}`,maps:seriesMaps},`${tr.slug}|${ref}`);
        Object.entries(tot).forEach(([who,s])=>{ const row={...s,...at,maps:seriesMaps};
          pos('seriesK',s.k,row,who); pos('seriesRtg',matchRating(s.k,s.a,s.d,s.score,seriesRounds),row,who); });
      }
    });
    Object.entries(evK).forEach(([who,x])=>pos('eventK',x.k,{...x,...ev},who));
    if(champ&&mw>=6) best('titleRun').add(mw-1000*ml,{...ev,name:tr.champion,teamSlug:tr.championTeam,mw,ml},tr.slug);
    if(tr.mvp&&tr.mvp.rating!=null&&tr.mvp.maps>=6) best('evRtg').add(tr.mvp.rating,{...ev,name:tr.mvp.name,slug:tr.mvp.slug,maps:tr.mvp.maps},tr.mvp.slug);
    (tr.prizes||[]).forEach(x=>{ if(x.teamSlug) pos('teamPrize',x.amount,{...ev,name:x.name,teamSlug:x.teamSlug},x.teamSlug); });
    pos('pool',tr.prizePool,{...ev,name:tr.name},tr.slug); pos('teamsAt',tr.participantCount,{...ev,name:tr.name},tr.slug); pos('matchesAt',played,{...ev,name:tr.name},tr.slug);
    if(tr.championTeam&&tr.year) bump(titleYears,`${tr.championTeam}|${tr.year}`);
    (tr.attending||[]).forEach(r=>(r.players||[]).forEach(p=>bump(evCount,p.slug)));
  });
  return {best, mapCount, overtime, veto, titleYears, evCount, byMap};
}
const REC_TABS=[["all","All"],["teams","Teams"],["players","Players"],["advanced","Advanced"],["matches","Matches & Feats"],["money","Money"],["maps","Maps & Events"],["bymap","By Map"],["weapons","Weapons"],["solo","Solo Queue"]];
let _recTab='all';
// The top 10 behind each record: a card registers a function that lists its entries, best first, and opens them on a click.
let _recTop=[];
function recTopAttr(title,fn){ _recTop.push({title,fn}); return ` data-top="${_recTop.length-1}" tabindex="0" role="button"`; }
function recTopOpen(i,from){
  const item=_recTop[i]; if(!item) return;
  const old=document.getElementById("rec-ov"); if(old) old.remove();
  const rows=item.fn(), top=rows.slice(0,10); let rank=0;
  const body=top.map((r,j)=>{ if(j===0||r.raw!==top[j-1].raw) rank=j+1;
    return `<tr><td class="rankcol">${rank}</td><td class="name-cell">${r.href?`<a href="${r.href}">${esc(r.name)}</a>`:esc(r.name)}${r.sub?`<div class="rec-pop-sub">${esc(r.sub)}</div>`:''}</td><td class="mono rec-pop-v">${esc(r.val)}</td></tr>`; }).join("");
  const last=top[top.length-1], more=last?rows.slice(10).filter(r=>r.raw===last.raw).length:0;
  app.insertAdjacentHTML("beforeend",`<div id="rec-ov" class="rec-ov"><div class="rec-pop" role="dialog" aria-modal="true" aria-label="${esc(item.title)}">
    <div class="rec-pop-h"><span>${esc(item.title)}</span><button class="rec-pop-x" aria-label="Close">✕</button></div>
    <div class="tablewrap rec-pop-b"><table class="data"><tbody>${body||'<tr><td class="muted">Nothing recorded yet.</td></tr>'}</tbody></table></div>
    ${more?`<div class="rec-pop-f muted">and ${more} more on ${esc(last.val)}</div>`:''}</div></div>`);
  const ov=document.getElementById("rec-ov"); ov._from=from; ov.querySelector(".rec-pop-x").focus();
}
function recTopClose(){ const ov=document.getElementById("rec-ov"); if(!ov) return; const f=ov._from; ov.remove(); if(f&&f.isConnected) f.focus(); }
document.addEventListener("click",e=>{
  if(e.target.closest(".rec-pop-x")||e.target.id==="rec-ov"){ recTopClose(); return; }
  const c=e.target.closest("[data-top]"); if(!c||e.target.closest("a")) return;
  recTopOpen(+c.dataset.top,c);
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape") recTopClose();
  else if((e.key==="Enter"||e.key===" ")&&e.target.matches&&e.target.matches("[data-top]")){ e.preventDefault(); recTopOpen(+e.target.dataset.top,e.target); }
});
// weapon records: site/weapons.json (build/heatmaps.py), kept out of data.json and only fetched here
let _weaponsP=null;
function loadWeapons(){ return _weaponsP=_weaponsP||fetch("weapons.json?x="+encodeURIComponent(DATA.builtAt||"")).then(r=>r.ok?r.json():null).catch(()=>null); }
function renderRecords(){
  _recTop=[];
  const pro = DATA.players.pro.filter(p=>p.rating!=null);
  const qualified = pro.filter(p=>p.maps>=12);
  const teams = DATA.teams;
  // title counts from tournaments
  const titles = {};
  (DATA.tournaments||[]).forEach(tr=>{ if(tr.championTeam) titles[tr.championTeam]=(titles[tr.championTeam]||0)+1; });
  const mostTitles = Object.entries(titles).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([slug,n])=>({slug, name:(teamBySlug(slug)||{}).name||slug, n}));
  // biggest blowout + highest-scoring map: every played map (Bo3 maps included, OT uncapped)
  let blow=null, highScore=null;
  allMapScores().forEach(m=>{ const tot=m.sa+m.sb, marg=Math.abs(m.sa-m.sb);
    if(!blow||marg>blow.marg) blow={marg, m};
    if(!highScore||tot>highScore.tot) highScore={tot, m}; });
  const bestStreak = [...teams].filter(t=>t.streak&&t.streak[0]==="W").sort((a,b)=>parseInt(b.streak.slice(1))-parseInt(a.streak.slice(1)))[0];
  const allTimeStreak = [...teams].filter(t=>t.longestWinStreak).sort((a,b)=>b.longestWinStreak.len-a.longestWinStreak.len)[0];
  const worstStreak = [...teams].filter(t=>t.streak&&t.streak[0]==="L").sort((a,b)=>parseInt(b.streak.slice(1))-parseInt(a.streak.slice(1)))[0];
  const allTimeLoss = [...teams].filter(t=>t.longestLossStreak).sort((a,b)=>b.longestLossStreak.len-a.longestLossStreak.len)[0];

  const maxBy = (arr,key)=>[...arr].sort((a,b)=>b[key]-a[key])[0];
  const topKey=(title,href)=>title+(href&&href.startsWith('#/team/')?' (team)':'');
  const recCard = (title, holder, val, href, sub, list) => { const fn=list||tops[topKey(title,href)];
    return `<div class="rec-card${fn?' rec-click':''}"${fn?recTopAttr(title,fn):''}>
      <div class="rec-title">${title}</div>
      <div class="rec-holder">${href?`<a href="${href}">${esc(holder)}</a>`:esc(holder)}</div>
      <div class="rec-val">${val}</div>${sub?`<div class="rec-sub">${esc(sub)}</div>`:''}</div>`; };
  const pl = p => recCard.bind(null);
  const topRating=maxBy(qualified,'rating'), topKills=maxBy(pro,'kills'), topMvp=maxBy(pro,'mvp'),
        topKdr=maxBy(qualified,'kdr'), topAssist=maxBy(pro,'assists'), topOT=maxBy(pro,'ot');
  const topKpm=[...qualified].sort((a,b)=>(b.kills/b.maps)-(a.kills/a.maps))[0];
  const topWR=maxBy(qualified,'winrate'), topWins=maxBy(pro,'wins'), topPlayerMaps=maxBy(pro,'maps');
  const nTitles=p=>(p.titles||[]).length, nMvp=p=>(p.mvpAwards||[]).length;
  const mostPTitles=[...pro].sort((a,b)=>nTitles(b)-nTitles(a))[0];
  const mostPMvp=[...pro].sort((a,b)=>nMvp(b)-nMvp(a))[0];
  const mostMaps=maxBy(teams,'total_maps'), mostEvents=maxBy(teams,'events_played'),
        mostMajors=maxBy(teams,'major_wins'), mostPodiums=maxBy(teams,'podiums');
  const qTeams=teams.filter(t=>t.total_maps>=40);
  const topTeamWR=maxBy(qTeams.length?qTeams:teams,'wlr'), mostSTier=maxBy(teams,'s_tier_wins'), mostMapWins=maxBy(teams,'map_wins');
  const mostATier=maxBy(teams,'a_tier_wins');
  const finalsCount=t=>(t.events||[]).filter(e=>(e.placement||99)<=2).length;
  const mostFinals=[...teams].sort((a,b)=>finalsCount(b)-finalsCount(a))[0];
  const topMvpRate=[...qualified].sort((a,b)=>(b.mvp/b.maps)-(a.mvp/a.maps))[0];
  const topClimb=[...pro].sort((a,b)=>(b.rankDelta||0)-(a.rankDelta||0))[0];
  const topDeaths=maxBy(pro,'deaths');
  // prize money (build/prizes.py): all-time earnings, players across every pool, teams by their own winnings
  const topEarner = allPlayers().filter(p=>p.earnings).sort((a,b)=>b.earnings-a.earnings)[0];
  const topEarnTeam = teams.filter(t=>t.earnings).sort((a,b)=>b.earnings-a.earnings)[0];
  const topValue = pro.filter(p=>p.marketValue).sort((a,b)=>b.marketValue-a.marketValue)[0];
  const bigFee = (DATA.transfers||[]).filter(t=>t.fee).sort((a,b)=>b.fee-a.fee)[0];
  const payday = allPlayers().flatMap(p=>(p.prizeHistory||[]).map(h=>({p, h}))).sort((a,b)=>b.h.amount-a.h.amount)[0];
  const climbRec=DATA.rankClimbRecord;   // all-time biggest rank climb (persisted, sticks)
  const pStreak=playerLongestStreak();
  const soloAll=soloLeague().filter(p=>p.maps>0);
  const soloRated=[...soloAll].filter(p=>p.ratingPoints!=null).sort((a,b)=>b.ratingPoints-a.ratingPoints);
  const soloQ=soloAll.filter(p=>p.maps>=8);
  const soloTopRtg=soloRated[0];
  const soloTopK=[...soloAll].sort((a,b)=>(b.kills||0)-(a.kills||0))[0];
  const soloBestKD=[...(soloQ.length?soloQ:soloAll)].sort((a,b)=>(b.kdr||0)-(a.kdr||0))[0];
  const soloBestWR=[...(soloQ.length?soloQ:soloAll)].sort((a,b)=>(b.winrate||0)-(a.winrate||0))[0];
  const hof=DATA.hallOfFame||{players:[],teams:[]};
  const hofPCard=e=>{ const p=playerBySlug(e.slug); if(!p) return '';
    return `<div class="hof-card"><div class="hof-head">${flag(p.iso)}<a class="hof-name" href="#/player/${p.slug}">${esc(p.name)}</a></div>`
      +`${e.tagline?`<div class="hof-tag">${esc(e.tagline)}</div>`:''}<div class="hof-blurb">${esc(e.blurb||'')}</div>`
      +`${e.article?`<a class="hof-link" href="#/article/${e.article}">Read the full story →</a>`:''}</div>`; };
  const hofTCard=e=>{ const t=teamBySlug(e.slug); if(!t) return '';
    return `<div class="hof-card"><div class="hof-head">${teamLogo(t)}<a class="hof-name" href="#/team/${t.slug}">${esc(t.name)}</a></div>`
      +`${e.tagline?`<div class="hof-tag">${esc(e.tagline)}</div>`:''}<div class="hof-blurb">${esc(e.blurb||'')}</div>`
      +`${e.article?`<a class="hof-link" href="#/article/${e.article}">Read the full story →</a>`:''}</div>`; };
  const hofHtml=[...(hof.players||[]).map(hofPCard),...(hof.teams||[]).map(hofTCard)].filter(Boolean).join("");
  // ---- the newer records (extendedRecords): a shared record says so under the value
  const X=extendedRecords(), xb=X.best;
  const who=r=>r.slug?`#/player/${r.slug}`:r.hslug?`#/human/${r.hslug}`:r.teamSlug?`#/team/${r.teamSlug}`:(r.ref?`#/match/${r.eventSlug}/${r.ref}`:`#/tournament/${r.eventSlug}`);
  const subOf=(...x)=>x.filter(Boolean).join(' · ');
  const tieNote=b=>b.rows.length<2?'':b.rows.length===2?`tied with ${b.rows[1].name}`:`${b.rows.length-1} others tied`;
  const rowsOf=(arr,val,fmt=v=>v,href=()=>null,name=x=>x.name,sub=()=>'')=>()=>arr.map(x=>({x,v:val(x)})).filter(r=>r.v>0&&isFinite(r.v)).sort((p,q)=>q.v-p.v)
    .map(r=>({name:name(r.x),href:href(r.x),val:String(fmt(r.v,r.x)),raw:r.v,sub:sub(r.x)}));
  const bRows=(b,fmt,sub,unique)=>()=>{ const seen=new Set(); return [...b.all].sort((p,q)=>q.v-p.v).filter(e=>!unique||(!seen.has(e.who)&&seen.add(e.who)))
    .map(e=>({name:e.row.name,href:who(e.row),val:String(fmt(e.v,e.row)),raw:e.v,sub:sub(e.row)})); };
  const bCard=(title,b,fmt=v=>v,sub=r=>subOf(r.map,r.event),unique)=>{ if(!b.rows.length) return ''; const r=b.rows[0];
    return recCard(title, r.name, fmt(b.val,r), who(r), subOf(sub(r),tieNote(b)), bRows(b,fmt,sub,unique)); };
  const feat=(title,k,fmt,sub,unique)=>bCard(title,xb(k),fmt,sub,unique);
  const listCard=(title,base,arr,val,fmt=v=>v,sub=()=>'')=>{ const b=recBest(); arr.forEach(x=>{ const v=val(x); if(v>0) b.add(v,x,x.slug); });
    if(!b.rows.length) return ''; const x=b.rows[0];
    return recCard(title, x.name, fmt(b.val,x), `#/${base}/${x.slug}`, subOf(sub(x),tieNote(b)), rowsOf(arr,val,fmt,y=>`#/${base}/${y.slug}`,y=>y.name,sub)); };
  const tallyCard=(title,o,fmt,name=k=>k,href=()=>null,sub=()=>'',min=1)=>{ const e=Object.entries(o).sort((a,b)=>b[1]-a[1]); if(!e.length||e[0][1]<min) return '';
    const tied=e.filter(x=>x[1]===e[0][1]).length-1;
    return recCard(title, name(e[0][0]), fmt(e[0][1]), href(e[0][0]), subOf(sub(e[0][0]), tied?`${tied} other${tied>1?'s':''} tied`:''),
      rowsOf(e.map(([k,n])=>({k,n})),x=>x.n,v=>fmt(v),x=>href(x.k),x=>name(x.k),x=>sub(x.k))); };
  const pName=s=>(playerBySlug(s)||{}).name||s, tName=s=>(teamBySlug(s)||{}).name||s, pHref=s=>`#/player/${s}`, tHref=s=>`#/team/${s}`;
  const x1=v=>v.toFixed(1), x2=v=>v.toFixed(2), times=v=>v+"×", pc1=v=>v.toFixed(1)+"%";
  // the top 10 behind the original cards (the newer ones build theirs above)
  const T=(val,fmt,arr=teams)=>rowsOf(arr,val,fmt,x=>`#/team/${x.slug}`), P=(val,fmt,arr=pro)=>rowsOf(arr,val,fmt,x=>`#/player/${x.slug}`);
  const num=k=>x=>x[k]||0, usd=v=>fmtUSD(v), pv=v=>pct(v), run=k=>x=>(x[k]||{}).len||0;
  const strk=c=>t=>t.streak&&t.streak[0]===c?parseInt(t.streak.slice(1)):0;
  const ms2=x=>[...x].map(m=>({...m,marg:Math.abs(m.sa-m.sb),tot:m.sa+m.sb})), mapsAll=ms2(allMapScores());
  const tops={
    "Most Event Titles (team)":rowsOf(Object.entries(titles).map(([slug,n])=>({slug,n})),x=>x.n,times,x=>tHref(x.slug),x=>tName(x.slug)),
    "Most Major Titles (team)":T(num('major_wins'),times), "Most Podiums (team)":T(num('podiums')), "Most Events Played (team)":T(num('events_played')),
    "Most Maps Played (team)":T(num('total_maps')), "Highest Win Rate (team)":T(num('wlr'),pv,qTeams.length?qTeams:teams),
    "Most S-Tier Titles (team)":T(num('s_tier_wins'),times), "Most A-Tier Titles (team)":T(num('a_tier_wins'),times),
    "Highest-Earning Team (team)":T(num('earnings'),usd), "Most Finals Reached (team)":T(finalsCount,times), "Most Map Wins (team)":T(num('map_wins')),
    "Longest Win Streak (all-time) (team)":T(run('longestWinStreak'),v=>v+" wins"), "Longest Win Streak (active) (team)":T(strk('W'),v=>'W'+v),
    "Longest Loss Streak (all-time) (team)":T(run('longestLossStreak'),v=>v+" losses"), "Longest Loss Streak (active) (team)":T(strk('L'),v=>'L'+v),
    "Most Rating Points":P(num('ratingPoints'),v=>v,qualified),
    "Highest Earner":P(num('earnings'),usd,allPlayers()),
    "Biggest Single Payday":rowsOf(allPlayers().flatMap(p=>(p.prizeHistory||[]).map(h=>({p,h}))),x=>x.h.amount,usd,x=>`#/player/${x.p.slug}`,x=>x.p.name,x=>x.h.event),
    "Highest Market Value":P(num('marketValue'),usd),
    "Biggest Transfer Fee":rowsOf((DATA.transfers||[]).filter(t=>t.fee),t=>t.fee,usd,t=>`#/player/${t.playerSlug}`,t=>t.player,t=>t.toTeam?`to ${t.toTeam}`:''),
    "Best K/D Ratio":P(num('kdr'),x2,qualified), "Most Total Kills":P(num('kills')), "Most MVPs":P(num('mvp')), "Most Assists":P(num('assists')),
    "Highest Kills / Map":P(p=>p.kills/p.maps,x1,qualified), "Highest Win Rate":P(num('winrate'),pv,qualified), "Most Wins":P(num('wins')),
    "Most Maps Played":P(num('maps')), "Most Titles Won":P(nTitles,times), "Most Event MVPs":P(nMvp,times), "Most OT Games":P(num('ot')),
    "Highest MVP Rate":P(p=>p.mvp/p.maps,v=>v.toFixed(2)+" /map",qualified),
    "Longest Win Streak":pStreak?rowsOf(pStreak.all,x=>x.len,v=>v+" maps",x=>`#/player/${x.slug}`):null,
    "Most Deaths":P(num('deaths')),
    "Biggest Blowout":rowsOf(mapsAll,m=>m.marg,(v,m)=>`${Math.max(m.sa,m.sb)}–${Math.min(m.sa,m.sb)}`,m=>`#/tournament/${m.eventSlug}`,m=>`${m.sa>=m.sb?m.a:m.b} vs ${m.sa>=m.sb?m.b:m.a}`,m=>m.map),
    "Highest-Scoring Map":rowsOf(mapsAll,m=>m.tot,(v,m)=>`${m.sa}–${m.sb}`,m=>`#/tournament/${m.eventSlug}`,m=>`${m.a} vs ${m.b}`,m=>m.map),
    "Top Solo Rating":rowsOf(soloRated,num('ratingPoints'),v=>v+" pts",x=>`#/player/${x.slug}`),
    "Most Solo Kills":rowsOf(soloAll,num('kills'),v=>v,x=>`#/player/${x.slug}`),
    "Best Solo K/D":rowsOf(soloQ.length?soloQ:soloAll,num('kdr'),x2,x=>`#/player/${x.slug}`),
    "Best Solo Win Rate":rowsOf(soloQ.length?soloQ:soloAll,num('winrate'),pv,x=>`#/player/${x.slug}`),
  };
  // teams
  const mapRec=recBest();
  teams.forEach(t=>Object.entries(t.mapStats||{}).forEach(([mp,s])=>{ if(s.g>=10&&s.real!==false) mapRec.add(s.wr,{name:t.name,teamSlug:t.slug,map:mp,w:s.w,l:s.l},t.slug+mp); }));
  const teamCards=[
    tallyCard("Most Titles in a Year",X.titleYears,times,k=>tName(k.split('|')[0]),k=>tHref(k.split('|')[0]),k=>k.split('|')[1]),
    feat("Most Dominant Title Run","titleRun",(v,r)=>`${r.mw}–${r.ml} maps`,r=>r.event),
    listCard("Most Major Playoff Runs","team",teams,t=>t.major_playoffs,times),
    listCard("Most Major Podiums","team",teams,t=>t.major_podiums,times),
    listCard("Most Ranking Points","team",teams,t=>t.rank_points,v=>v+" pts"),
    listCard("Highest Team Elo","team",teams,t=>t.teamElo),
    bCard("Best Record on a Map",mapRec,v=>pct(v),r=>`${r.map} · ${r.w}–${r.l}`),
    listCard("Most Former Players","team",teams,t=>(t.formerPlayers||[]).length),
  ].join("");
  const rivSeen=new Set(), rivP=recBest(), rivO=recBest();
  teams.forEach(t=>(t.h2h||[]).forEach(h=>{ if(!h.opp) return; const k=[t.slug,h.opp].sort().join('|');
    if(!rivSeen.has(k)){ rivSeen.add(k); rivP.add(h.w+h.l,{name:`${t.name} vs ${h.oppName}`,teamSlug:t.slug,
      lead:h.w===h.l?`level at ${h.w}–${h.l}`:`${h.w>h.l?t.name:h.oppName} lead ${Math.max(h.w,h.l)}–${Math.min(h.w,h.l)}`},k); }
    if(h.w>h.l) rivO.add(h.w-h.l,{name:`${t.name} over ${h.oppName}`,teamSlug:t.slug,w:h.w,l:h.l},k); }));
  // players
  const realTeams=p=>(p.teamHistory||[]).filter(h=>!nationIso(h.team)&&!/ Squad \d+$/.test(h.team)).length;
  const playerCards=[
    feat("Highest Rating Points Ever","peak",v=>v+" pts",r=>r.event,true),
    feat("Biggest Rating Gain in a Match","gain",v=>"+"+v,r=>r.event),
    feat("Biggest Rating Drop in a Match","drop",v=>"−"+v,r=>r.event),
    tallyCard("Most Events Played",X.evCount,v=>v,pName,pHref),
    listCard("Most Teams Played For","player",pro,realTeams,v=>v,()=>"not counting national squads"),
    feat("Most Kills at One Event","eventK",v=>v,r=>r.event),
    feat("Best Event MVP Rating","evRtg",x2,r=>`${r.maps} maps · ${r.event}`),
  ].join("");
  const roleTop=(title,f)=>listCard(title,"player",pro.filter(f),p=>p.ratingPoints,v=>v+" pts",p=>p.team||"Free agent");
  const isIgl=p=>/igl/i.test(p.role||''), subIs=s=>p=>p.subRole===s&&!isIgl(p);
  const roleCards=[roleTop("Top AWPer",p=>/awp/i.test(p.role||'')), roleTop("Top IGL",isIgl), roleTop("Top Entry",subIs('entry')),
    roleTop("Top Lurker",subIs('lurker')), roleTop("Top Anchor",subIs('anchor')), roleTop("Top Support",subIs('support'))].join("");
  const potm=DATA.playerOfMonth||[], potmN={}, poyN={}, toyN={}, ya=Object.entries(DATA.yearAwards||{});
  const count=(o,k)=>{ if(k) o[k]=(o[k]||0)+1; };
  potm.forEach(x=>count(potmN,x.slug));
  ya.forEach(([y,a])=>{ if(a.poy) count(poyN,a.poy.slug); if(a.team) count(toyN,a.team.slug); });
  const monthName=m=>{ const [y,mo]=String(m).split('-'); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo-1]} ${y}`; };
  const climbs=ya.filter(([y,a])=>a.improved).map(([y,a])=>({...a.improved,year:y}));
  const awardCards=[
    tallyCard("Most Player of the Year Awards",poyN,times,pName,pHref,undefined,2),   // shown once someone has won twice
    tallyCard("Most Team of the Year Awards",toyN,times,tName,tHref),
    tallyCard("Most Player of the Month Awards",potmN,times,pName,pHref,undefined,2),
    listCard("Best Player of the Month Rating","player",potm,x=>x.rating,x2,x=>`${monthName(x.month)} · ${x.maps} maps`),
    listCard("Biggest One-Year Rise","player",climbs,x=>x.from-x.to,v=>"▲"+v,x=>`#${x.from} to #${x.to} in ${x.year}`),
  ].join("");
  // advanced stats: rates need 12 recorded maps, like the other rate stats
  const advAll=pro.filter(p=>p.adv&&p.adv.maps), advQ=advAll.filter(p=>p.adv.maps>=12);
  const adv=(title,arr,val,fmt,sub)=>listCard(title,"player",arr,val,fmt,sub);
  const advCards=[
    adv("Highest ADR",advQ,p=>p.adv.adr,x1),
    adv("Highest KAST",advQ,p=>p.adv.kast,pc1),
    adv("Highest Headshot %",advQ,p=>p.adv.hs,pc1),
    adv("Best Opening Duel Win Rate",advQ.filter(p=>p.adv.fk+p.adv.fd>=30),p=>p.adv.fk/(p.adv.fk+p.adv.fd),v=>pct(v),p=>`${p.adv.fk}–${p.adv.fd}`),
    adv("Most Opening Kills",advAll,p=>p.adv.fk),
    adv("Best Opening Kill Difference",advAll,p=>p.adv.fk-p.adv.fd,v=>"+"+v,p=>`${p.adv.fk}–${p.adv.fd}`),
    adv("Most Trade Kills",advAll,p=>p.adv.tk),
    adv("Highest Utility Damage / Round",advQ,p=>p.adv.udr,x1),
    adv("Most 3K+ Rounds",advAll,p=>total(p.adv.multi.slice(1))),
    adv("Most 4Ks",advAll,p=>p.adv.multi[2]),
    adv("Most Aces",advAll,p=>p.adv.multi[3]),
    adv("Most Clutches Won",advAll,p=>total(p.adv.clutch)),
    adv("Most 1v3+ Clutches",advAll,p=>total(p.adv.clutch.slice(2))),
  ].join("");
  const moneyCards=[
    feat("Biggest Team Prize","teamPrize",v=>fmtUSD(v),r=>r.event),
    listCard("Biggest Budget","team",teams,t=>t.budget,v=>fmtUSD(v)),
    listCard("Most Valuable Squad","team",teams,t=>t.squadValue,v=>fmtUSD(v)),
    listCard("Biggest Spender on Transfers","team",teams,t=>t.feesOut,v=>fmtUSD(v)),
  ].join("");
  const matchCards=[
    feat("Biggest Upset","upset",(v,r)=>`${Math.round(r.chance*100)}% chance`,r=>subOf(r.score,r.event)),
    feat("Longest Series","seriesRounds",v=>v+" rounds",r=>subOf(`${r.maps} maps`,r.event)),
    feat("Most Kills in a Series","seriesK",v=>v,r=>subOf(`${r.maps} maps`,r.event)),
    feat("Best Series Rating","seriesRtg",x2,r=>subOf(`${r.maps} maps`,r.event)),
    feat("Highest ADR in a Map","adr",x1),
    feat("Biggest +/– in a Map","spread",v=>"+"+v),
    feat("Most Kills in a Lost Map","lossK"),
    feat("Most Assists in a Map","assists"),
    feat("Most Headshots in a Map","hs"),
    feat("Most Opening Kills in a Map","fk"),
    feat("Most MVP Stars in a Map","stars",v=>"★"+v),
    feat("Most Multi-Kill Rounds in a Map","multi"),
    feat("Most Aces in a Map","aces"),
    feat("Most Clutches in a Map","clutch"),
  ].join("");
  const mapCards=[
    tallyCard("Most Played Map",X.mapCount,v=>v+" maps"),
    tallyCard("Most Banned Map",X.veto.ban,v=>v+" bans"),
    tallyCard("Most Picked Map",X.veto.pick,v=>v+" picks"),
    tallyCard("Most Common Decider",X.veto.decider,v=>v+" deciders"),
    tallyCard("Map Most Often in Overtime",X.overtime,v=>v+" times"),
  ].join("");
  const eventCards=[
    feat("Biggest Prize Pool","pool",v=>fmtUSD(v),()=>''),
    feat("Most Teams at an Event","teamsAt",v=>v,()=>''),
    feat("Most Matches at an Event","matchesAt",v=>v,()=>''),
  ].join("");
  const soloCards=[
    listCard("Most Solo Games","player",soloAll,p=>p.maps),
    listCard("Most Solo Wins","player",soloAll,p=>p.wins),
    listCard("Most Solo MVPs","player",soloAll,p=>p.mvp),
  ].join("");
  // one card per map: every line opens its own top 10
  const perMapCards=Object.entries(X.byMap).filter(([m,d])=>d.n>=20).sort((a,b)=>b[1].n-a[1].n).map(([m,d])=>{
    const careers=Object.values(d.pl).filter(c=>c.maps>=5).map(c=>({...c,rtg:matchRating(c.k,c.a,c.d,c.score,c.rounds)}));
    const sides=teams.filter(t=>t.mapStats&&t.mapStats[m]&&t.mapStats[m].g>=5&&t.mapStats[m].real!==false).sort((a,b)=>b.mapStats[m].g-a.mapStats[m].g);
    const line=(label,rows)=>{ const r=rows()[0]; if(!r) return '';
      return `<div class="rec-mline"${recTopAttr(`${m}: ${label}`,rows)}><span class="rec-ml">${label}</span><span class="rec-mn">${r.href?`<a href="${r.href}">${esc(r.name)}</a>`:esc(r.name)}</span><span class="rec-mv">${esc(r.val)}</span></div>`; };
    const game=r=>r.event;
    return `<div class="rec-map">
      <div class="rec-map-h"${VETO_IMG[m]?` style="background-image:linear-gradient(90deg,rgba(8,12,22,.92),rgba(8,12,22,.45)),url('assets/maps/${VETO_IMG[m]}')"`:''}><span>${esc(m)}</span><small>${d.n} maps recorded</small></div>
      ${line("Top Player",rowsOf(careers,c=>c.rtg,x2,who,c=>c.name,c=>`${c.maps} maps on ${m}`))}
      ${line("Top Team",rowsOf(sides,t=>t.mapStats[m].wr,v=>pct(v),t=>`#/team/${t.slug}`,t=>t.name,t=>`${t.mapStats[m].w}–${t.mapStats[m].l}`))}
      ${line("Most Kills in a Game",bRows(d.k,v=>v,game))}
      ${line("Best Game Rating",bRows(d.rtg,x2,game))}
      ${line("Best Game ADR",bRows(d.adr,x1,game))}
    </div>`; }).join("");
  const weaponSection=W=>{
    const by=new Map(allPlayers().map(p=>[normKey(p.name),p])), hum=new Map((DATA.soloHumans||[]).map(h=>[normKey(h.name),h]));
    const link=n=>{ const p=by.get(normKey(n)), h=hum.get(normKey(n)); return p?`#/player/${p.slug}`:h?`#/human/${h.slug}`:null; };
    const tied=rows=>{ const n=rows.filter(r=>r.raw===rows[0].raw).length-1; return !n?'':n===1?`tied with ${rows[1].name}`:`${n} others tied`; };
    const show=(title,rows,sub='')=>rows.length?recCard(title,rows[0].name,esc(rows[0].val),rows[0].href,subOf(sub||rows[0].sub,tied(rows)),()=>rows):'';
    const hsOf=(k,hs)=>`${Math.round(100*hs/k)}% headshots`;
    const group=(title,key,noHs)=>show(title,((W.groups[key]||{}).players||[]).map(([n,k,hs])=>({name:n,href:link(n),val:String(k),raw:k,sub:noHs?'':hsOf(k,hs)})));
    const inMap=(title,key)=>show(title,((W.groups[key]||{}).maps||[]).map(([k,n,mp,ev])=>({name:n,href:link(n),val:String(k),raw:k,sub:`${mp} · ${ev}`})));
    const hsRate=(title,key,min)=>show(title,((W.groups[key]||{}).players||[]).filter(([n,k])=>k>=min).map(([n,k,hs])=>({name:n,href:link(n),raw:hs/k,val:pct(hs/k),sub:`${hs} of ${k} kills`})).sort((a,b)=>b.raw-a.raw));
    const wRows=W.weapons.map(([n,k,hs])=>({name:n,val:k+" kills",raw:k,sub:`${(100*k/W.kills).toFixed(1)}% of all kills`}));
    const hsRows=W.weapons.filter(([n,k])=>k>=100).map(([n,k,hs])=>({name:n,val:pct(hs/k),raw:hs/k,sub:`${hs} of ${k} kills`})).sort((a,b)=>b.raw-a.raw);
    return `<h3 class="rec-group">Weapons <span class="muted" style="font-size:11px">from the ${W.kills.toLocaleString('en-US')} kills on ${W.maps} maps with a recorded kill feed</span></h3>
    <div class="rec-grid">
      ${show("Most Used Weapon",wRows)}${show("Best Headshot Weapon",hsRows)}
      ${group("Most AK-47 Kills","AK-47")}${group("Most M4 Kills","M4")}${group("Most AWP Kills","AWP")}${group("Most Scout Kills","Scout")}
      ${group("Most AUG & SG 553 Kills","AUG & SG")}${group("Most SMG Kills","SMGs")}${group("Most Pistol Kills","Pistols")}${group("Most Desert Eagle Kills","Desert Eagle")}
      ${group("Most Pistol Round Kills","Pistol Rounds")}${group("Most Grenade & Fire Kills","Grenades",true)}${group("Most Knife Kills","Knife",true)}
      ${hsRate("Best AK-47 Headshot %","AK-47",40)}
      ${inMap("Most AK-47 Kills in a Map","AK-47")}${inMap("Most AWP Kills in a Map","AWP")}${inMap("Most Pistol Kills in a Map","Pistols")}
    </div>`; };
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Records &amp; Hall of Fame</h2>
    ${hofHtml?`<h3 class="rec-group">Hall of Fame <span class="muted" style="font-size:11px">inducted legends</span></h3>
    <div class="hof-grid">${hofHtml}</div>`:''}
    <div class="tabs rec-tabs">${REC_TABS.map(([k,l])=>`<button data-rt="${k}">${esc(l)}</button>`).join("")}</div>
    <div class="rec-hint muted">Click a record to see its top 10.</div>
    <section class="rec-sec" data-rg="teams"><h3 class="rec-group">Titles &amp; Teams</h3>
    <div class="rec-grid">
      ${recCard("Most Event Titles", mostTitles[0].name, mostTitles[0].n+"×", `#/team/${mostTitles[0].slug}`)}
      ${recCard("Most Major Titles", mostMajors.name, mostMajors.major_wins+"×", `#/team/${mostMajors.slug}`)}
      ${recCard("Most Podiums", mostPodiums.name, mostPodiums.podiums, `#/team/${mostPodiums.slug}`)}
      ${recCard("Most Events Played", mostEvents.name, mostEvents.events_played, `#/team/${mostEvents.slug}`)}
      ${recCard("Most Maps Played", mostMaps.name, mostMaps.total_maps, `#/team/${mostMaps.slug}`)}
      ${recCard("Highest Win Rate", topTeamWR.name, pct(topTeamWR.wlr), `#/team/${topTeamWR.slug}`)}
      ${mostSTier.s_tier_wins?recCard("Most S-Tier Titles", mostSTier.name, mostSTier.s_tier_wins+"×", `#/team/${mostSTier.slug}`):''}
      ${mostATier&&mostATier.a_tier_wins?recCard("Most A-Tier Titles", mostATier.name, mostATier.a_tier_wins+"×", `#/team/${mostATier.slug}`):''}
      ${topEarnTeam?recCard("Highest-Earning Team", topEarnTeam.name, fmtUSD(topEarnTeam.earnings), `#/team/${topEarnTeam.slug}`):''}
      ${mostFinals&&finalsCount(mostFinals)?recCard("Most Finals Reached", mostFinals.name, finalsCount(mostFinals)+"×", `#/team/${mostFinals.slug}`):''}
      ${recCard("Most Map Wins", mostMapWins.name, mostMapWins.map_wins, `#/team/${mostMapWins.slug}`)}
      ${allTimeStreak?recCard("Longest Win Streak (all-time)", allTimeStreak.name, allTimeStreak.longestWinStreak.len+" wins", `#/team/${allTimeStreak.slug}`):''}
      ${recCard("Longest Win Streak (active)", bestStreak?bestStreak.name:'—', bestStreak?bestStreak.streak:'—', bestStreak?`#/team/${bestStreak.slug}`:null)}
      ${allTimeLoss?recCard("Longest Loss Streak (all-time)", allTimeLoss.name, allTimeLoss.longestLossStreak.len+" losses", `#/team/${allTimeLoss.slug}`):''}
      ${recCard("Longest Loss Streak (active)", worstStreak?worstStreak.name:'—', worstStreak?worstStreak.streak:'—', worstStreak?`#/team/${worstStreak.slug}`:null)}
      ${teamCards}
    </div></section>
    ${rivP.rows.length?`<section class="rec-sec" data-rg="teams"><h3 class="rec-group">Rivalries</h3>
    <div class="rec-grid">
      ${bCard("Most-Played Rivalry",rivP,v=>v+" matches",r=>r.lead)}
      ${bCard("Most One-Sided Rivalry",rivO,(v,r)=>`${r.w}–${r.l}`,()=>'')}
    </div></section>`:''}
    <section class="rec-sec" data-rg="players"><h3 class="rec-group">Players <span class="muted" style="font-size:11px">(pro; rate stats min 12 maps)</span></h3>
    <div class="rec-grid">
      ${recCard("Most Rating Points", topRating.name, topRating.ratingPoints, `#/player/${topRating.slug}`)}
      ${topEarner?recCard("Highest Earner", topEarner.name, fmtUSD(topEarner.earnings), `#/player/${topEarner.slug}`):''}
      ${payday?recCard("Biggest Single Payday", payday.p.name, `${fmtUSD(payday.h.amount)} · ${esc(payday.h.event)}`, `#/player/${payday.p.slug}`):''}
      ${topValue?recCard("Highest Market Value", topValue.name, fmtUSD(topValue.marketValue), `#/player/${topValue.slug}`):''}
      ${bigFee?recCard("Biggest Transfer Fee", bigFee.player, `${fmtUSD(bigFee.fee)} · to ${esc(bigFee.toTeam||'')}`, `#/player/${bigFee.playerSlug}`):''}
      ${recCard("Best K/D Ratio", topKdr.name, topKdr.kdr.toFixed(2), `#/player/${topKdr.slug}`)}
      ${recCard("Most Total Kills", topKills.name, topKills.kills, `#/player/${topKills.slug}`)}
      ${recCard("Most MVPs", topMvp.name, topMvp.mvp, `#/player/${topMvp.slug}`)}
      ${recCard("Most Assists", topAssist.name, topAssist.assists, `#/player/${topAssist.slug}`)}
      ${recCard("Highest Kills / Map", topKpm.name, (topKpm.kills/topKpm.maps).toFixed(1), `#/player/${topKpm.slug}`)}
      ${recCard("Highest Win Rate", topWR.name, pct(topWR.winrate), `#/player/${topWR.slug}`)}
      ${recCard("Most Wins", topWins.name, topWins.wins, `#/player/${topWins.slug}`)}
      ${recCard("Most Maps Played", topPlayerMaps.name, topPlayerMaps.maps, `#/player/${topPlayerMaps.slug}`)}
      ${nTitles(mostPTitles)?recCard("Most Titles Won", mostPTitles.name, nTitles(mostPTitles)+"×", `#/player/${mostPTitles.slug}`):''}
      ${nMvp(mostPMvp)?recCard("Most Event MVPs", mostPMvp.name, nMvp(mostPMvp)+"×", `#/player/${mostPMvp.slug}`):''}
      ${recCard("Most OT Games", topOT.name, topOT.ot, `#/player/${topOT.slug}`)}
      ${recCard("Highest MVP Rate", topMvpRate.name, (topMvpRate.mvp/topMvpRate.maps).toFixed(2)+" /map", `#/player/${topMvpRate.slug}`)}
      ${pStreak&&pStreak.len?recCard("Longest Win Streak", pStreak.name, pStreak.len+" maps", `#/player/${pStreak.slug}`):''}
      ${climbRec&&climbRec.delta>0?recCard("Biggest Rank Climb", climbRec.name, "▲"+climbRec.delta, `#/player/${climbRec.slug}`):''}
      ${recCard("Most Deaths", topDeaths.name, topDeaths.deaths, `#/player/${topDeaths.slug}`)}
      ${playerCards}
    </div></section>
    <section class="rec-sec" data-rg="players"><h3 class="rec-group">Best by Role <span class="muted" style="font-size:11px">by Rating Points</span></h3>
    <div class="rec-grid">${roleCards}</div></section>
    <section class="rec-sec" data-rg="players"><h3 class="rec-group">Awards</h3>
    <div class="rec-grid">${awardCards}</div></section>
    <section class="rec-sec" data-rg="advanced"><h3 class="rec-group">Advanced Stats <span class="muted" style="font-size:11px">recorded since October 2026; rate stats min 12 recorded maps</span></h3>
    <div class="rec-grid">${advCards}</div></section>
    <section class="rec-sec" data-rg="money"><h3 class="rec-group">Money &amp; Market</h3>
    <div class="rec-grid">${moneyCards}</div>
    <div id="earn-box">${earnBoardHtml()}</div></section>
    <section class="rec-sec" data-rg="matches"><h3 class="rec-group">Matches &amp; Single-Map Feats</h3>
    <div class="rec-grid">
      ${blow?recCard("Biggest Blowout", `${esc(blow.m.sa>=blow.m.sb?blow.m.a:blow.m.b)} vs ${esc(blow.m.sa>=blow.m.sb?blow.m.b:blow.m.a)}`,
        `${Math.max(blow.m.sa,blow.m.sb)}–${Math.min(blow.m.sa,blow.m.sb)}${blow.m.map?` · ${esc(blow.m.map)}`:''}`, `#/tournament/${blow.m.eventSlug}`):''}
      ${highScore?recCard("Highest-Scoring Map", `${esc(highScore.m.a)} vs ${esc(highScore.m.b)}`,
        `${highScore.m.sa}–${highScore.m.sb} · ${highScore.tot} rds${highScore.m.map?` · ${esc(highScore.m.map)}`:''}`, `#/tournament/${highScore.m.eventSlug}`):''}
      ${feat("Most Kills in a Map","mapK")}
      ${feat("Best Single-Map Rating","mapRtg",x2)}
      ${feat("Most Overtimes in a Map","mapOT",v=>v+" OT"+(v>1?"s":""),r=>subOf(r.score,r.event))}
      ${feat("Most Kills in a Match","matchK",v=>v,r=>subOf(`${r.maps} map${r.maps===1?'':'s'}`,r.event))}
      ${matchCards}
    </div></section>
    <section class="rec-sec" data-rg="maps"><h3 class="rec-group">Maps &amp; Veto</h3>
    <div class="rec-grid">${mapCards}</div></section>
    <section class="rec-sec" data-rg="maps"><h3 class="rec-group">Events</h3>
    <div class="rec-grid">${eventCards}</div></section>
    <section class="rec-sec" data-rg="bymap"><h3 class="rec-group">Best on Each Map <span class="muted" style="font-size:11px">top player and team need 5 recorded maps there</span></h3>
    <div class="rec-maps">${perMapCards}</div></section>
    <section class="rec-sec" data-rg="weapons"><div id="rec-weapons"></div></section>
    <section class="rec-sec" data-rg="solo"><h3 class="rec-group">Solo Queue <span class="muted" style="font-size:11px">(rate stats min 8 maps)</span></h3>
    <div class="rec-grid">
      ${soloTopRtg?recCard("Top Solo Rating", soloTopRtg.name, soloTopRtg.ratingPoints+" pts", `#/player/${soloTopRtg.slug}`):''}
      ${soloTopK?recCard("Most Solo Kills", soloTopK.name, soloTopK.kills, `#/player/${soloTopK.slug}`):''}
      ${soloBestKD?recCard("Best Solo K/D", soloBestKD.name, (soloBestKD.kdr||0).toFixed(2), `#/player/${soloBestKD.slug}`):''}
      ${soloBestWR?recCard("Best Solo Win Rate", soloBestWR.name, pct(soloBestWR.winrate), `#/player/${soloBestWR.slug}`):''}
      ${soloCards}
    </div></section>
    <section class="rec-sec" data-rg="players">${(()=>{ const inform=inFormPlayers(); if(!inform.length) return '';
      return `<h3 class="rec-group">In-Form Players <span class="muted" style="font-size:11px">best recent match ratings · min 3 recent maps</span></h3>
      <div class="tablewrap" style="max-width:560px"><table class="data"><thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Player</th><th class="no-sort">Recent RTG</th><th class="no-sort">Form</th></tr></thead>
      <tbody>${inform.map((x,i)=>`<tr><td class="rankcol">${i+1}</td><td class="name-cell">${x.p?playerLink(x.p):esc(x.name)}</td>
        <td class="mono" style="color:${rtgColor(x.avg)}"><strong>${x.avg.toFixed(2)}</strong></td>
        <td>${formDots(x.log)}</td></tr>`).join("")}</tbody></table></div>`; })()}</section>`;
  const recShow=()=>{ app.querySelectorAll(".rec-sec").forEach(s=>{ s.hidden=_recTab!=='all'&&s.dataset.rg!==_recTab; });
    app.querySelectorAll(".rec-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.rt===_recTab)); };
  app.querySelectorAll(".rec-tabs button").forEach(b=>b.onclick=()=>{ _recTab=b.dataset.rt; recShow(); });
  recShow();
  const wBox=document.getElementById("rec-weapons");
  loadWeapons().then(W=>{ if(W&&wBox&&wBox.isConnected) wBox.innerHTML=weaponSection(W); });
}
// Top Earners on the Records page: all-time or one year (players from their prize history, teams from event payouts)
let _earnYear = 'all';
function earnBoardHtml(){
  const yr = _earnYear, inYear = d => yr==='all' || String(d||'').startsWith(yr);
  const years = [...new Set((DATA.tournaments||[]).filter(t=>t.prizes&&t.prizes.length).map(t=>(t.date||'').slice(0,4)))].sort((a,b)=>b-a);
  const ps = allPlayers().map(p=>({p, v:(p.prizeHistory||[]).filter(h=>inYear(h.date)).reduce((t,h)=>t+h.amount,0)})).filter(x=>x.v).sort((a,b)=>b.v-a.v).slice(0,10);
  const tsum = {}; (DATA.tournaments||[]).forEach(tr=>{ if(!inYear(tr.date)) return; (tr.prizes||[]).forEach(x=>{ if(x.teamSlug) tsum[x.teamSlug]=(tsum[x.teamSlug]||0)+x.amount; }); });
  const ts = Object.entries(tsum).map(([s,v])=>({t:teamBySlug(s), v})).filter(x=>x.t).sort((a,b)=>b.v-a.v).slice(0,10);
  const tbl=(rows,cell)=>`<div class="tablewrap"><table class="data"><tbody>${rows.map((x,i)=>`<tr><td class="rankcol">${i+1}</td><td class="name-cell">${cell(x)}</td><td class="mono">${fmtUSD(x.v)}</td></tr>`).join("")}</tbody></table></div>`;
  return `<h3 class="rec-group">Top Earners <span class="muted" style="font-size:11px">prize money from events with a prize pool</span></h3>
    ${years.length?`<div class="tabs earn-tabs">${['all',...years].map(y=>`<button data-ey="${y}" class="${y===yr?'active':''}">${y==='all'?'All-time':y}</button>`).join("")}</div>`:''}
    ${ps.length?`<div class="earn-grid"><div><div class="earn-h">Players</div>${tbl(ps,x=>playerLink(x.p))}</div>
      <div><div class="earn-h">Teams</div>${tbl(ts,x=>`<a href="#/team/${x.t.slug}">${esc(x.t.name)}</a>`)}</div></div>`
      :'<p class="muted">Prize money shows up here once events have prize pools.</p>'}`;
}
document.addEventListener("click", e=>{ const b=e.target.closest("[data-ey]"); if(!b) return;
  _earnYear=b.dataset.ey; const box=document.getElementById("earn-box"); if(box) box.innerHTML=earnBoardHtml(); });
// players with the best average RTG over their last few recorded maps
function inFormPlayers(){
  const byslug={};
  (DATA.tournaments||[]).forEach(tr=>{
    const scan=(matches,pfx)=>matches.forEach(m=>{ if(!m.stats||!m.stats.maps) return;
      m.stats.maps.forEach(mp=>{ const tot=(mp.scoreA||0)+(mp.scoreB||0); if(!tot) return;
        (mp.players||[]).forEach(pl=>{ if(!pl.slug) return;
          const onA=normKey(pl.team)===normKey(m.a); const won=mp.scoreA===mp.scoreB?null:(onA?mp.scoreA>mp.scoreB:mp.scoreB>mp.scoreA);
          (byslug[pl.slug]=byslug[pl.slug]||[]).push({date:tr.date||'',rtg:matchRating(pl.k,pl.a,pl.d,pl.score,tot),won,map:mp.map||'',
            event:tr.name,eventSlug:tr.slug,ref:(m.i!=null?pfx+m.i:null),opp:(onA?m.b:m.a)||'',
            score:(onA?`${mp.scoreA}-${mp.scoreB}`:`${mp.scoreB}-${mp.scoreA}`)});
        });
      });
    });
    if(tr.stages&&tr.stages.length) tr.stages.forEach(st=>st.rounds.forEach(rd=>scan(rd.matches,st.id+"-")));
    else (tr.bracket||[]).forEach(rd=>scan(rd.matches,""));
  });
  const out=[];
  Object.entries(byslug).forEach(([slug,log])=>{
    log.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const rec=log.slice(-5); if(rec.length<3) return;
    out.push({slug, p:playerBySlug(slug), name:slug, log, avg:rec.reduce((a,x)=>a+x.rtg,0)/rec.length});
  });
  return out.sort((a,b)=>b.avg-a.avg).slice(0,10);
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
      <td class="mono tf-fee">${t.fee?fmtUSDc(t.fee):'<span class="muted">—</span>'}</td>
    </tr>`;
  }).join("");
  const tab=(k,l,n)=>`<button data-ts="${k}" class="${k===_transferScope?'active':''}">${l} <span style="opacity:.7">${n}</span></button>`;
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Transfers <span class="muted" style="font-size:11px">(${list.length} moves)</span></h2>
    <p class="muted" style="font-size:12px;margin:-6px 0 12px"><span style="color:var(--good)">Green</span> joined · <span style="color:var(--accent2)">red</span> left</p>
    <div class="tabs">${tab("pro","Pro teams",proMoves.length)}${tab("all","All",all.length)}</div>
    <div class="tablewrap"><table class="data results-table"><thead><tr>
      <th class="no-sort">Date</th><th class="no-sort">Player</th><th class="no-sort" style="text-align:right">From</th><th class="no-sort"></th><th class="no-sort">To</th><th class="no-sort">Fee</th>
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
        a:m.a,aTeam:m.aTeam,b:m.b,bTeam:m.bTeam,odds:m.odds,
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
          </span>${oddsChip(u)}
        </div>`).join("")}
      </div>`).join("") : '<p class="muted">No upcoming or live matches. See <a href="#/results">Results</a>.</p>';
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
  const rivHtml=rivalryList().slice(0,5).map(r=>`<tr>
     <td class="name-cell" style="text-align:right">${nameOrTeamCrest(r.xName,r.x)}</td>
     <td class="mono" style="font-weight:700">${r.xw}<span class="muted"> – </span>${r.yw}</td>
     <td class="name-cell">${nameOrTeamCrest(r.yName,r.y)}</td>
     <td class="mono muted" style="font-size:12px">${r.n} meetings${r.finals?` · ${r.finals} final${r.finals===1?'':'s'}`:''}</td></tr>`).join("");
  // event MVPs: the site's pick (build/parse.py), by HLTV-style rating where scoreboards exist
  const mvps=(DATA.tournaments||[]).filter(tr=>tr.mvp).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const mvpHtml = mvps.length ? mvps.map(tr=>`<tr>
      <td class="name-cell"><a href="#/tournament/${tr.slug}">${esc(tr.name)}</a></td>
      <td class="name-cell">${flag(tr.mvp.iso)}<a href="#/player/${tr.mvp.slug}">${esc(tr.mvp.name)}</a> <span class="muted" style="font-size:11px">${esc(tr.mvp.team||'')}</span></td>
      <td class="mono">${tr.mvp.rating!=null?`${tr.mvp.rating.toFixed(2)} rating · ${tr.mvp.maps} maps`:`${tr.mvp.mvpRounds} MVP · ${tr.mvp.kills}K`}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No scoreboards recorded yet.</td></tr>`;
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>Awards</h2>
    ${yearAwardsHtml()}
    ${potmHtml()}
    <h3 class="rec-group" style="margin-top:26px">🏆 Champions Cabinet <span class="muted" style="font-size:11px">(${ts.length} titles)</span></h3>
    ${cabinet}
    <h3 class="rec-group" style="margin-top:26px">Most Decorated Teams</h3>
    <div class="tablewrap"><table class="data"><thead><tr>
      <th class="no-sort">#</th><th class="no-sort">Team</th><th class="no-sort">Titles</th>
      <th class="no-sort">Major</th><th class="no-sort">S</th><th class="no-sort">A</th></tr></thead>
      <tbody>${decHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:26px">Biggest Rivalries <a href="#/rivalries" class="muted" style="font-size:11px;margin-left:6px">all rivalries →</a></h3>
    <div class="tablewrap"><table class="data"><tbody>${rivHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:26px">Event MVPs</h3>
    <div class="tablewrap"><table class="data"><tbody>${mvpHtml}</tbody></table></div>`;
}

// ---------- yearly awards (build/awards.py) ----------
const AWARD_DEFS = [["poy","Player of the Year","🏆"],["rookie","Rookie of the Year","🌱"],["improved","Most Improved","📈"],["team","Team of the Year","🛡"],["upset","Best Upset","⚡"]];
function yearAwardsHtml(){
  const ya = DATA.yearAwards||{}; const years = Object.keys(ya).sort((a,b)=>b-a);
  if(!years.length) return '';
  const pl = x=>{ const p=playerBySlug(x.slug); return `${p?flag(p.iso):''}<a href="#/player/${esc(x.slug)}">${esc(x.name)}</a>`; };
  const card = (k, x)=>{ const d=AWARD_DEFS.find(a=>a[0]===k);
    const body = k==='team' ? `${nameOrTeamCrest(x.name, x.slug)}<span class="ya-sub">${x.pts} placement pts that year</span>`
      : k==='upset' ? `<a href="${x.ref?`#/match/${esc(x.slug)}/${esc(x.ref)}`:`#/tournament/${esc(x.slug)}`}">${esc(x.winner)} beat ${esc(x.loser)}${x.score?' '+esc(x.score):''}</a><span class="ya-sub">${Math.round(x.chance*100)}% chance before the match · ${esc(x.event)}</span>`
      : k==='improved' ? `${pl(x)}<span class="ya-sub">#${x.from} → #${x.to} on the year's player list</span>`
      : k==='rookie' ? `${pl(x)}<span class="ya-sub">first BPL season · #${x.rank} that year</span>`
      : `${pl(x)}<span class="ya-sub">#1 in the <a href="#/news">Top 20 Players of the Year</a></span>`;
    return `<div class="ya-card"><div class="ya-h">${d[2]} ${d[1]}</div><div class="ya-b">${body}</div></div>`; };
  const pending = !ya['2026'] ? `<div class="ya-year"><div class="ya-y">2026</div><p class="muted" style="margin:4px 0 0;font-size:13px">The 2026 awards are handed out after the BPL Conquerors Stage 2026.</p></div>` : '';
  return `<h3 class="rec-group">Yearly Awards</h3>${pending}
    ${years.map(y=>`<div class="ya-year"><div class="ya-y">${y}</div><div class="ya-grid">${AWARD_DEFS.filter(a=>ya[y][a[0]]).map(a=>card(a[0], ya[y][a[0]])).join("")}</div></div>`).join("")}`;
}
function potmHtml(){
  const ms = (DATA.playerOfMonth||[]).slice().reverse(); if(!ms.length) return '';
  const mname = m=>{ const [y,mo]=m.split('-'); return ["January","February","March","April","May","June","July","August","September","October","November","December"][+mo-1]+' '+y; };
  return `<h3 class="rec-group" style="margin-top:22px">Player of the Month <span class="muted" style="font-size:11px">best average rating in a month · min 8 maps</span></h3>
    <div class="tablewrap" style="max-width:640px"><table class="data"><tbody>${ms.map(x=>`<tr><td class="mono muted">${mname(x.month)}</td>
      <td class="name-cell">${flag(x.iso)}<a href="#/player/${esc(x.slug)}">${esc(x.name)}</a> <span class="muted" style="font-size:11px">${esc(x.team||'')}</span></td>
      <td class="mono" style="color:${rtgColor(x.rating)}"><b>${x.rating.toFixed(2)}</b> <span class="muted">· ${x.maps} maps</span></td></tr>`).join("")}</tbody></table></div>`;
}
// ---------- rivalries ----------
let _rivals = null;
function rivalryList(){
  if(_rivals) return _rivals;
  const pairs = {};
  allMatches().forEach(m=>{
    if(!m.aTeam || !m.bTeam || m.aTeam===m.bTeam) return;
    const [x,y]=[m.aTeam,m.bTeam].sort(), k=x+'|'+y;
    const r = pairs[k] || (pairs[k]={x, y, xName:(teamBySlug(x)||{}).name||x, yName:(teamBySlug(y)||{}).name||y, xw:0, yw:0, finals:0, close:0, meets:[]});
    ((m.w===1?m.aTeam:m.bTeam)===x) ? r.xw++ : r.yw++;
    if(/final/i.test(m.round||'') && !/semi|quarter|loser|lower|last chance/i.test(m.round||'')) r.finals++;
    if(m.sa!=null && m.sb!=null){ const hi=Math.max(m.sa,m.sb), d=Math.abs(m.sa-m.sb); if((hi<=5 && d===1) || (hi>5 && d<=3)) r.close++; }
    r.meets.push(m);
  });
  _rivals = Object.values(pairs).filter(r=>r.xw+r.yw>=3).map(r=>{ r.n=r.xw+r.yw;
    r.score = r.n + 3*r.finals + 1.5*r.close + 4*(Math.min(r.xw,r.yw)/Math.max(r.xw,r.yw)); return r; }).sort((a,b)=>b.score-a.score);
  return _rivals;
}
function rivalsOf(slug){ return rivalryList().filter(r=>r.x===slug||r.y===slug); }
function renderRivalries(){
  const list = rivalryList().slice(0,24);
  const crestOf = s=>{ const t=teamBySlug(s); return t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:`<span class="mc-noimg">${initials((t||{}).name||'?')}</span>`; };
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Rivalries
      <span class="muted" style="font-size:11px">the league's biggest match-ups: most meetings, finals, close series and even records</span></h2>
    <div class="riv-grid">${list.map((r,i)=>{ const last=r.meets[0]; const lead = r.xw===r.yw ? 'Dead even' : `${r.xw>r.yw?r.xName:r.yName} lead`;
      return `<div class="riv-card"><div class="riv-n">#${i+1}</div>
        <div class="riv-teams"><a class="riv-t" href="#/team/${r.x}">${crestOf(r.x)}<span>${esc(r.xName)}</span></a>
          <div class="riv-rec"><b class="${r.xw>r.yw?'lead':''}">${r.xw}</b><span>–</span><b class="${r.yw>r.xw?'lead':''}">${r.yw}</b></div>
          <a class="riv-t r" href="#/team/${r.y}"><span>${esc(r.yName)}</span>${crestOf(r.y)}</a></div>
        <div class="riv-meta">${r.n} meetings · ${r.finals} final${r.finals===1?'':'s'} · ${r.close} close series · <b>${esc(lead)}</b></div>
        ${last?`<div class="riv-last muted">Last: ${fmtDate(last.date)} · <a href="#/tournament/${last.eventSlug}">${esc(last.event)}</a> · ${esc(last.a)} ${last.sa??''}-${last.sb??''} ${esc(last.b)}</div>`:''}
        <a class="riv-h2h" href="#/compareteams" data-cmp="${r.x}|${r.y}">Compare the two teams →</a></div>`; }).join("")}</div>`;
  app.querySelectorAll("[data-cmp]").forEach(a=>a.onclick=()=>{ const [x,y]=a.dataset.cmp.split("|"); tcmpA=x; tcmpB=y; });
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
    if(tr.stages&&tr.stages.length) tr.stages.forEach(st=>scan(st.rounds)); else scan(tr.bracket||[]);
  });
  const mapList=Object.values(maps).sort((a,b)=>b.played-a.played);
  const totalMaps=mapList.reduce((s,m)=>s+m.played,0);
  if(!mapList.length){
    app.innerHTML=`<h2 class="section-title"><span class="accent-bar"></span>Maps</h2>
      <div class="notice"><h2>No map data yet</h2></div>`;
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
    <h2 class="section-title"><span class="accent-bar"></span>Maps <span class="muted" style="font-size:11px">(${totalMaps} maps recorded)</span>
      <a href="#/heatmaps" class="hm-link">Kill heatmaps →</a></h2>
    <h3 class="rec-group">Map Pool</h3>
    <div class="rec-grid">${mapCards}</div>
    <h3 class="rec-group" style="margin-top:24px">Team Map Records</h3>
    <div class="tablewrap"><table class="data"><thead><tr>
      <th class="no-sort">Team</th><th class="no-sort">Overall</th><th class="no-sort">By map</th></tr></thead>
      <tbody>${trecHtml}</tbody></table></div>
    <h3 class="rec-group" style="margin-top:24px">Map Results</h3>
    <div class="tablewrap"><table class="data results-table"><tbody>${resHtml}</tbody></table></div>`;
}

// ---------- Kill heatmaps (6 Nov 2026; build/heatmaps.py) ----------
// #/heatmaps/<Map>[/team/<name> | /player/<name>]: where the kills (or the deaths) happen on a map,
// over the map's floor drawn from its nav. The kills come from BPL matches the BPL Bots launcher
// played since kill positions were recorded. One map's file is loaded at a time.
const HM = { mode: "kills", side: "all", event: "" };
const _hmFiles = {};
function hmFetch(file){
  if(!_hmFiles[file]) _hmFiles[file] = fetch("heatmaps/"+file+"?x="+encodeURIComponent(DATA.builtAt||"")).then(r=>r.ok?r.json():null).catch(()=>null);
  return _hmFiles[file];
}
async function renderHeatmaps(){
  const parts = location.hash.replace(/^#\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Kill Heatmaps</h2><div class="loading">Loading…</div>`;
  const idx = await hmFetch("index.json");
  const maps = (idx && idx.maps) || [];
  if(!maps.length){
    app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Kill Heatmaps</h2>
      <div class="notice"><h2>No kill data yet</h2><p class="muted">Heatmaps fill up from BPL matches played after 6 November 2026, when kill positions started being recorded.</p></div>`;
    return;
  }
  const m = maps.find(x=>x.map===parts[1]) || maps.slice().sort((a,b)=>b.kills-a.kills)[0];
  const team = parts[2]==="team" ? parts[3]||"" : "", player = parts[2]==="player" ? parts[3]||"" : "";
  const d = await hmFetch(m.file);
  if(!location.hash.startsWith("#/heatmaps")) return;          // left the page while it loaded
  if(!d){ app.innerHTML = `<div class="notice"><h2>Couldn't load the ${esc(m.map)} heatmap</h2></div>`; return; }
  const go = (t, p) => { location.hash = "#/heatmaps/"+encodeURIComponent(m.map)+(p ? "/player/"+encodeURIComponent(p) : t ? "/team/"+encodeURIComponent(t) : ""); };
  const ti = d.teams.indexOf(team), pi = d.players.indexOf(player);
  // a player's team on this map: the one they've played it for most
  const teamsOf = new Map();
  d.kills.forEach(k=>{ [[k[5],k[7]],[k[6],k[8]]].forEach(([p,t])=>{ if(p<0||t<0) return; const c=teamsOf.get(p)||{}; c[t]=(c[t]||0)+1; teamsOf.set(p,c); }); });
  const mainTeam = (p) => { const c=teamsOf.get(p); if(!c) return -1; return +Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0]; };
  const shownTeam = ti>=0 ? ti : pi>=0 ? mainTeam(pi) : -1;           // a player's link shows their team
  const playerList = d.players.map((n,i)=>({n,i})).filter(x=>shownTeam<0 || mainTeam(x.i)===shownTeam).sort((a,b)=>a.n.localeCompare(b.n));
  const ev = HM.event && d.events.findIndex(e=>e[0]===HM.event);
  // kills: where the killer stood (by the killer's side); deaths: where the victim fell (by theirs)
  const pts = [];
  for(const k of d.kills){
    if(HM.event && k[10]!==ev) continue;
    const deaths = HM.mode==="deaths", side = deaths ? 1-k[4] : k[4];
    if(HM.side==="t" && side!==0 || HM.side==="ct" && side!==1) continue;
    if(pi>=0 && (deaths ? k[6] : k[5])!==pi) continue;
    if(pi<0 && ti>=0 && (deaths ? k[8] : k[7])!==ti) continue;
    pts.push(deaths ? [k[2],k[3]] : [k[0],k[1]]);
  }
  const who = player ? esc(player) : team ? esc(team) : "everyone";
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Kill Heatmaps <span class="muted" style="font-size:11px">(${d.kills.length} kills recorded on ${esc(m.map)})</span>
      <a href="#/maps" class="hm-link">← Maps</a></h2>
    <div class="tabs hm-maps">${maps.map(x=>`<button data-map="${esc(x.map)}" class="${x.map===m.map?"active":""}">${esc(x.map)} <span class="muted">${x.kills}</span></button>`).join("")}</div>
    <div class="hm-filters">
      <div class="tabs hm-seg">${[["kills","Kills"],["deaths","Deaths"]].map(([v,l])=>`<button data-mode="${v}" class="${HM.mode===v?"active":""}">${l}</button>`).join("")}</div>
      <div class="tabs hm-seg">${[["all","Both sides"],["t","T"],["ct","CT"]].map(([v,l])=>`<button data-side="${v}" class="${HM.side===v?"active":""}">${l}</button>`).join("")}</div>
      <label>Team <select id="hm-team"><option value="">All teams</option>${d.teams.slice().sort().map(t=>`<option ${shownTeam>=0&&t===d.teams[shownTeam]?"selected":""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Player <select id="hm-player"><option value="">${shownTeam>=0?"Whole team":"All players"}</option>${playerList.map(x=>`<option ${x.n===player?"selected":""}>${esc(x.n)}</option>`).join("")}</select></label>
      ${d.events.length>1?`<label>Event <select id="hm-event"><option value="">All events</option>${d.events.map(e=>`<option value="${esc(e[0])}" ${e[0]===HM.event?"selected":""}>${esc(e[1])}</option>`).join("")}</select></label>`:""}
    </div>
    <div class="hm-wrap"><canvas id="hm-canvas"></canvas></div>
    <div class="muted hm-note">${pts.length} ${HM.mode==="kills"?"kills":"deaths"} · ${who}${HM.side!=="all"?" · "+HM.side.toUpperCase()+" side":""} · ${HM.mode==="kills"?"where the killer stood":"where the player died"}. The map is drawn from its bot navigation mesh; kills are recorded from BPL matches since 6 November 2026.</div>`;
  app.querySelectorAll("[data-map]").forEach(b=>b.onclick=()=>{ location.hash = "#/heatmaps/"+encodeURIComponent(b.dataset.map); });
  app.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ HM.mode=b.dataset.mode; renderHeatmaps(); });
  app.querySelectorAll("[data-side]").forEach(b=>b.onclick=()=>{ HM.side=b.dataset.side; renderHeatmaps(); });
  $("#hm-team").onchange = e=>go(e.target.value, "");
  $("#hm-player").onchange = e=>go(shownTeam>=0 ? d.teams[shownTeam] : "", e.target.value);
  if($("#hm-event")) $("#hm-event").onchange = e=>{ HM.event=e.target.value; renderHeatmaps(); };
  hmDraw($("#hm-canvas"), d.nav, pts);
}

// The map's floor (nav areas, higher floors lighter and drawn on top) with the points as heat:
// soft dots summed on a hidden canvas, then coloured by how many overlap (blue → yellow → red).
function hmDraw(cv, nav, pts){
  const areas = nav.areas||[];
  if(!areas.length) return;
  let x1=1e9, y1=1e9, x2=-1e9, y2=-1e9, z1=1e9, z2=-1e9;
  areas.forEach(a=>{ x1=Math.min(x1,a[0]); y1=Math.min(y1,a[1]); x2=Math.max(x2,a[2]); y2=Math.max(y2,a[3]); z1=Math.min(z1,a[4]); z2=Math.max(z2,a[4]); });
  const pad=120; x1-=pad; y1-=pad; x2+=pad; y2+=pad;
  const W = Math.min(900, (cv.parentElement.clientWidth||900));
  const s = W/(x2-x1), H = Math.round((y2-y1)*s);
  const dpr = window.devicePixelRatio||1;
  cv.width = W*dpr; cv.height = H*dpr; cv.style.width = W+"px"; cv.style.height = H+"px";
  const g = cv.getContext("2d");
  g.scale(dpr,dpr);
  const X = (x)=>(x-x1)*s, Y = (y)=>(y2-y)*s;          // world y points north: up on screen
  areas.forEach(a=>{
    const t = z2>z1 ? (a[4]-z1)/(z2-z1) : .5;
    g.fillStyle = `rgb(${Math.round(34+t*30)},${Math.round(44+t*34)},${Math.round(68+t*40)})`;
    g.fillRect(X(a[0]), Y(a[3]), Math.max(1,(a[2]-a[0])*s), Math.max(1,(a[3]-a[1])*s));
  });
  // the heat
  const r = Math.max(7, 70*s);                           // ~70 u around each point
  const off = document.createElement("canvas"); off.width=cv.width; off.height=cv.height;
  const o = off.getContext("2d"); o.scale(dpr,dpr);
  const a = Math.max(.05, Math.min(.35, 6/Math.sqrt(pts.length||1)));
  pts.forEach(([x,y])=>{
    const px=X(x), py=Y(y), gr=o.createRadialGradient(px,py,0,px,py,r);
    gr.addColorStop(0,`rgba(0,0,0,${a})`); gr.addColorStop(1,"rgba(0,0,0,0)");
    o.fillStyle=gr; o.fillRect(px-r,py-r,2*r,2*r);
  });
  const img = o.getImageData(0,0,off.width,off.height), px = img.data;
  const stops = [[0,[56,120,255]],[.35,[56,214,255]],[.6,[120,255,120]],[.8,[255,210,61]],[1,[255,61,100]]];
  for(let i=0;i<px.length;i+=4){
    const v = px[i+3]/255; if(!v) continue;
    let k=1; while(k<stops.length-1 && v>stops[k][0]) k++;
    const [p0,c0]=stops[k-1], [p1,c1]=stops[k], f=Math.min(1,Math.max(0,(v-p0)/(p1-p0)));
    px[i]=c0[0]+(c1[0]-c0[0])*f; px[i+1]=c0[1]+(c1[1]-c0[1])*f; px[i+2]=c0[2]+(c1[2]-c0[2])*f;
    px[i+3]=Math.min(235, 90+v*200);
  }
  o.putImageData(img,0,0);
  g.setTransform(1,0,0,1,0,0);
  g.drawImage(off,0,0);
  g.scale(dpr,dpr);
  // place names on top
  g.font = "600 11px Inter, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  (nav.places||[]).forEach(([n,x,y])=>{ g.fillStyle="rgba(8,12,23,.7)"; const w=g.measureText(n).width+8; g.fillRect(X(x)-w/2,Y(y)-8,w,16); g.fillStyle="#c5cde0"; g.fillText(n,X(x),Y(y)); });
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
    ["Rating Points",p=>p.ratingPoints!=null?p.ratingPoints:'—',p=>p.ratingPoints||0],
    ["Level",p=>p.level||'—',p=>p.level||0],
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
      <div class="cmp-ptier">${p.level?`${levelChip(p.level)} <span class="muted" style="font-size:12px">Lvl ${p.level} · ${p.ratingPoints} pts</span>`:'<span class="muted">Unranked</span>'}</div></div>`;
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
    ["BPL Rank", t=>t.provisional?'Unranked':'#'+t.rank, t=>t.rank==null?-9999:-t.rank],
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
  const pools=["pro","solo"];   // amateur merged into pro
  // dedupe people across pools by name
  const seen=new Set(), nat={}, reg={};
  pools.forEach(pk=>DATA.players[pk].forEach(p=>{
    const key=normKey(p.name); if(seen.has(key)) return; seen.add(key);
    const name=p.nat||'Unknown', e=nat[name]=nat[name]||{nat:name,iso:p.iso||'',n:0}; e.n++;
    if(!e.iso&&p.iso) e.iso=p.iso;
    const rn=playerRegion(p); const re=reg[rn]=reg[rn]||{region:rn,n:0}; re.n++;
  }));
  const natList=Object.values(nat).sort((a,b)=>b.n-a.n);
  const totalPeople=seen.size;
  const countries=natList.filter(x=>x.nat!=='Unknown').length;
  // level distribution (pro)
  const levelCount={}; DATA.players.pro.forEach(p=>{ if(p.level) levelCount[p.level]=(levelCount[p.level]||0)+1; });
  const levelMax=Math.max(1,...Object.values(levelCount));
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
  const topByReg={};
  const consider=(map,keyOf,p,isPro)=>{
    if(p.rating==null) return; const kk=keyOf(p); if(kk==null||kk==="") return;
    const cur=map[kk]; if(cur&&cur.pro&&!isPro) return;
    if(!cur||p.rating>cur.rating) map[kk]={name:p.name,rating:p.rating,ratingPoints:p.ratingPoints,team:p.team,slug:p.slug,pro:isPro};
  };
  DATA.players.pro.forEach(p=>{ consider(topByNat,x=>x.nat,p,true); consider(topByReg,playerRegion,p,true); });
  ["amateur","solo"].forEach(pk=>DATA.players[pk].forEach(p=>{ consider(topByNat,x=>x.nat,p,false); consider(topByReg,playerRegion,p,false); }));
  const natBars=natList.slice(0,14).map(x=>{
    const tp=topByNat[x.nat];
    const fl = tp ? `<span class="flag-tip">${flag(x.iso)}<span class="ftbox"><span class="ftlabel">Top player</span><b>${esc(tp.name)}</b><span class="ftmeta">${tp.ratingPoints} pts${tp.team?' · '+esc(tp.team):''}</span></span></span>` : flag(x.iso);
    return `<div class="bar-row"><span class="bar-label">${fl}<span class="bar-cty">${esc(x.nat)}</span></span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(x.n/natMax*100))}%"></div></div>
      <span class="bar-val">${x.n}</span></div>`;
  }).join("");
  const regList=Object.values(reg).sort((a,b)=>b.n-a.n);
  const regMax=Math.max(1,...regList.map(x=>x.n));
  const regBars=regList.map(x=>{
    const tp=topByReg[x.region];
    const lbl = tp ? `<span class="flag-tip"><span class="bar-cty reg-name">${esc(x.region)}</span><span class="ftbox"><span class="ftlabel">Top player</span><b>${esc(tp.name)}</b><span class="ftmeta">${tp.ratingPoints} pts${tp.team?' · '+esc(tp.team):''}</span></span></span>` : `<span class="bar-cty reg-name">${esc(x.region)}</span>`;
    return `<div class="bar-row"><span class="bar-label">${lbl}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.round(x.n/regMax*100))}%"></div></div>
      <span class="bar-val">${x.n}</span></div>`;
  }).join("");
  const levelBars=[10,9,8,7,6,5,4,3,2,1].map(lv=>levelCount[lv]?bar(`<span class="dot" style="background:${levelColor(lv)}"></span>Level ${lv}`,levelCount[lv],levelMax,levelColor(lv)):'').join("");
  const poolSize=pk=>pk==='solo'?soloLeague().length:DATA.players[pk].length;
  const poolMax=Math.max(...pools.map(poolSize));
  const poolBars=pools.map(pk=>bar(pk==='pro'?'Pro':pk==='amateur'?'Amateur':'Solo Queue',poolSize(pk),poolMax)).join("");
  const tile=(v,l)=>`<div class="stat"><div class="sv">${v}</div><div class="sl">${l}</div></div>`;
  app.innerHTML=`
    <h2 class="section-title"><span class="accent-bar"></span>League Stats</h2>
    <div class="statgrid" style="margin-bottom:22px">
      ${tile(totalPeople,"Players")}
      ${tile(DATA.teams.filter(t=>!t.provisional).length,"Pro Teams")}
      ${tile(countries,"Countries")}
      ${tile((DATA.tournaments||[]).length,"Events")}
      ${tile(matchCount,"Matches")}
    </div>
    <div class="stats2col">
      <div><h3 class="rec-group">Players by Country <span class="muted" style="font-size:11px">(top 14)</span></h3>
        <div class="bars">${natBars}</div>
        <h3 class="rec-group" style="margin-top:22px">Players by Region <span class="muted" style="font-size:11px">(hover for top player)</span></h3>
        <div class="bars">${regBars}</div></div>
      <div><h3 class="rec-group">Pro Players by Level</h3>
        <div class="bars">${levelBars}</div>
        <h3 class="rec-group" style="margin-top:22px">Player Pools</h3>
        <div class="bars">${poolBars}</div></div>
    </div>`;
}

// ---------- Match page ----------
// locate a match (and its round/stage titles) within a tournament by ref string
function findMatchByRef(tr, ref){
  let match=null, roundTitle="", stageName="";
  const scan = (rounds, sName)=>rounds.forEach(rd=>rd.matches.forEach(m=>{
    if(m.i!=null && (String(m.i)===ref || `${ref}`.endsWith("-"+m.i))){ match=m; roundTitle=rd.title; stageName=sName||""; }
  }));
  if(ref.includes("-") && tr.stages){ const sid=ref.split("-")[0]; const st=tr.stages.find(s=>String(s.id)===sid); if(st) scan(st.rounds, st.name); }
  if(!match){ (tr.bracket||[]).forEach(rd=>rd.matches.forEach(m=>{ if(String(m.i)===ref){match=m;roundTitle=rd.title;} })); }
  if(!match && tr.stages){ tr.stages.forEach(st=>scan(st.rounds, st.name)); }
  return {match, roundTitle, stageName};
}
function renderMatch(){
  const parts = location.hash.replace(/^#\/?/,"").split("/");
  const slug = parts[1], ref = parts.slice(2).join("/");
  const tr = (DATA.tournaments||[]).find(t=>t.slug===slug);
  if(!tr){ app.innerHTML = notFound("Match"); return; }
  const _f = findMatchByRef(tr, ref);
  let match=_f.match, roundTitle=_f.roundTitle, stageName=_f.stageName;
  if(!match){ app.innerHTML = notFound("Match"); return; }

  const side = (name, slug2, score, win)=>{
    const t = slug2 ? teamBySlug(slug2) : null;
    const logo = nationCrest(name, 48)                                   // national teams -> country flag
      || (t&&t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<div class="m-noimg">${initials(name||'?')}</div>`);
    const nm = name ? (slug2?`<a href="#/team/${slug2}">${esc(name)}</a>`:esc(name)) : '<span class="muted">TBD</span>';
    return `<div class="m-side ${win?'m-win':''}">${logo}<div class="m-name">${nm}</div><div class="m-score">${score!=null?score:'–'}</div></div>`;
  };
  // head-to-head between these two teams (all prior meetings, this match excluded)
  let h2hHtml = '';
  if(match.aTeam && match.bTeam && match.aTeam!==match.bTeam){
    const meets = teamMeetings(match.aTeam, match.bTeam).filter(x=>!(x.eventSlug===slug && x.ref===ref));
    const wA = meets.filter(x=>x.winner==='a').length, wB = meets.filter(x=>x.winner==='b').length;
    const la = teamBySlug(match.aTeam), lb = teamBySlug(match.bTeam);
    const crest = tm => tm&&tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : '';
    const rows = meets.slice(0,12).map(x=>{
      const aw = x.winner==='a';
      const href = x.ref ? `#/match/${x.eventSlug}/${x.ref}` : `#/tournament/${x.eventSlug}`;
      return `<a class="h2h-meet" href="${href}">
        <span class="h2h-date">${fmtDate(x.date)}</span>
        <span class="h2h-scores"><span class="h2h-sc ${aw?'won':'lost'}">${x.aScore!=null?x.aScore:'–'}</span><span class="h2h-colon">:</span><span class="h2h-sc ${aw?'lost':'won'}">${x.bScore!=null?x.bScore:'–'}</span></span>
        <span class="h2h-ev">${esc(x.event)}</span></a>`;
    }).join("");
    h2hHtml = `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Head-to-Head</h2>
      <div class="h2h-box">
        <div class="h2h-head">
          <span class="h2h-team">${crest(la)}<a href="#/team/${match.aTeam}">${esc(match.a)}</a></span>
          <span class="h2h-rec"><span class="hw">${wA}</span><span class="muted">–</span><span class="hl">${wB}</span></span>
          <span class="h2h-team right"><a href="#/team/${match.bTeam}">${esc(match.b)}</a>${crest(lb)}</span>
        </div>
        ${meets.length ? `<div class="h2h-list">${rows}</div>${meets.length>12?`<div class="h2h-more muted">+ ${meets.length-12} earlier meeting${meets.length-12===1?'':'s'}</div>`:''}`
          : '<div class="h2h-none muted">First-ever meeting between these two teams.</div>'}
      </div>`;
  }
  const vetoHtml = matchVetoHtml(match);
  // A series in progress (BPL Bots sends each map as it ends; the result is only set once the series
  // is won): the header shows the maps won so far, e.g. 0 – 1 after team b takes the first map.
  const playedMaps = ((match.stats && match.stats.maps) || []).filter(m=>m.scoreA!=null && m.scoreB!=null && +m.scoreA !== +m.scoreB);
  const inProgress = match.w!==1 && match.w!==2 && match.sa==null && match.sb==null && playedMaps.length > 0;
  const headA = inProgress ? playedMaps.filter(m=>+m.scoreA > +m.scoreB).length : match.sa;
  const headB = inProgress ? playedMaps.filter(m=>+m.scoreB > +m.scoreA).length : match.sb;
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
  // rosters at this event (if available). Ad-hoc/amateur teams have no teamSlug,
  // so match those by team name — otherwise every slug-less side collapses onto
  // the first slug-less attending row.
  const rosterCol = (slug2, name2)=>{
    const row = (tr.attending||[]).find(r=> slug2
      ? r.teamSlug===slug2
      : (r.teamSlug==null && !!name2 && normKey(r.team)===normKey(name2)));
    if(!row) return '';
    return `<div class="m-roster"><div class="m-roster-h">${esc(row.team)}</div>${row.players.map(p=>
      `<div class="m-rp">${flag(p.iso)}${p.slug?`<a href="#/${p.human?'human':'player'}/${p.slug}">${esc(p.name)}</a>`:esc(p.name)}${p.human?humanBadge(p):''}${p.captain?'<span class="rp-c">C</span>':''}</div>`).join("")}</div>`;
  };
  const rosters = (match.aTeam||match.bTeam||match.a||match.b) ? `${rosterCol(match.aTeam, match.a)}${rosterCol(match.bTeam, match.b)}` : '';

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
    <div class="m-card"${match.w!==1 && match.w!==2 ? ' data-open="1"' : ''}>
      ${side(match.a, match.aTeam, headA, match.w===1)}
      <div class="m-mid"><div class="m-vs">${(match.sa!=null&&match.sb!=null)?`${match.sa} : ${match.sb}`:'vs'}</div>
        ${match.w?`<div class="muted" style="font-size:12px">${esc(match.w===1?match.a:match.b)} won</div>`
          : `<div class="muted" style="font-size:12px">${inProgress ? `in progress · ${playedMaps.length} map${playedMaps.length===1?'':'s'} played` : 'not played'}</div>`}</div>
      ${side(match.b, match.bTeam, headB, match.w===2)}
    </div>
    <div id="m-stream" class="m-stream" inert></div>
    <div id="m-live"></div>
    ${oddsBarHtml(match)}
    ${h2hHtml && vetoHtml ? `<div class="m-duo"><div>${h2hHtml}</div><div>${vetoHtml}</div></div>` : h2hHtml + vetoHtml}
    ${previewHtml}
    ${sbHtml || (rosters?`<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Rosters</h2><div class="m-rosters">${rosters}</div>`:'')}
    ${_adminOn?`<div style="margin-top:16px"><button id="m-editstats" class="loadmore">${match.stats?'Edit':'Record'} scoreboard</button></div><div id="m-statsform"></div>`:''}
    <div style="margin-top:20px"><a href="#/tournament/${esc(slug)}" class="muted">← back to ${esc(tr.name)}</a></div>`;

  if(maps.length) renderScoreboard();
  const eb = $("#m-editstats");
  if(eb) eb.onclick = ()=>openStatsForm(slug, ref, match);
  if(!tr.champion && match.w!==1 && match.w!==2) liveMatchWatch(slug, ref);
  else liveMatchWatch(null);
}
let _sbMatch = null, _sbTab = 'all';
function aggregateMaps(maps){
  const by = {};
  maps.forEach(mp=>mp.players.forEach(p=>{
    const key = (p.slug||"") + "|" + normKey(p.name) + "|" + normKey(p.team);
    if(!by[key]) by[key] = {team:p.team, name:p.name, slug:p.slug, iso:p.iso, human:p.human, hslug:p.hslug, kind:p.kind, k:0, a:0, d:0, mvp:0, score:0, xk:0};
    const t = by[key]; t.k+=p.k||0; t.a+=p.a||0; t.d+=p.d||0; t.mvp+=p.mvp||0; t.score+=p.score||0;
    if(p.rnd>0){ XS_KEYS.forEach(k=>{ t[k]=(t[k]||0)+(p[k]||0); }); t.xk+=p.k||0; }   // xk: kills on recorded maps (HS%)
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
// ---------- win chance + rating swings (build/elo.py) ----------
// m.odds = team A's chance to win the series: from the line-ups' Rating Points before the match (played)
// or right now (upcoming). m.elo[slug] = [points before, after map 1, after map 2, ...] (null = sat out).
const ODDS_NOTE = "From the two line-ups' Rating Points (the player Elo) before the match. BPL is close: the favourite wins about 54% of matches, so most chances sit between 40% and 60%.";
function oddsSplit(m){ if(m.odds==null) return null; const a=Math.round(m.odds*100); return [a,100-a]; }
function isUpset(m){ return m.odds!=null && (m.w===1||m.w===2) && Math.round((m.w===1?m.odds:1-m.odds)*100) < 40; }
function oddsBarHtml(m, compact){
  const sp=oddsSplit(m); if(!sp) return '';
  const played=m.w===1||m.w===2, [pa,pb]=sp;
  const head=`<div class="odds-head"><span>${played?'Pre-match win chance':'Win chance'}</span>${isUpset(m)?'<span class="odds-upset">Upset</span>':''}<span class="odds-q" title="${esc(ODDS_NOTE)}">?</span></div>`;
  return `<div class="odds${compact?' compact':''}">${head}
    <div class="odds-row"><span class="odds-p ${pa>pb?'fav':''}">${pa}%</span>
      <span class="odds-bar"><i style="width:${pa}%"></i><b style="width:${pb}%"></b></span>
      <span class="odds-p r ${pb>pa?'fav':''}">${pb}%</span></div></div>`;
}
function oddsChip(m){
  const sp=oddsSplit(m); if(!sp) return '';
  return `<span class="odds-chip" title="${esc('Win chance: '+(m.a||'')+' '+sp[0]+'% · '+sp[1]+'% '+(m.b||'')+'. '+ODDS_NOTE)}"><b class="${sp[0]>sp[1]?'fav':''}">${sp[0]}%</b><i></i><b class="${sp[1]>sp[0]?'fav':''}">${sp[1]}%</b></span>`;
}
// rating change for one player: the whole match (mapIdx null) or one map; null if not rated
function eloSwing(m, slug, mapIdx){
  const path=m.elo&&slug?m.elo[slug]:null; if(!path) return null;
  if(mapIdx==null){ const last=[...path].reverse().find(v=>v!=null); return {from:path[0], to:last, d:last-path[0]}; }
  const to=path[mapIdx+1]; if(to==null) return null;
  let from=null; for(let i=mapIdx;i>=0;i--){ if(path[i]!=null){ from=path[i]; break; } }
  return {from, to, d:to-from};
}
function swingCell(sw){
  if(!sw) return '<td class="mono muted">–</td>';
  const c=sw.d>0?'var(--good)':sw.d<0?'var(--accent2,#ff6b6b)':'var(--muted)';
  return `<td class="mono sb-elo" style="color:${c}" title="Rating Points ${sw.from} → ${sw.to}">${sw.d>0?'+':sw.d<0?'−':'±'}${Math.abs(sw.d)}</td>`;
}
// ---------- HLTV-style match card (click a played bracket match) ----------
function matchCardHTML(tr, m, ref){
  const ta = m.aTeam?teamBySlug(m.aTeam):null, tb = m.bTeam?teamBySlug(m.bTeam):null;
  const seedOf = (nm,sl)=>{ const s = tr.seeds && (tr.seeds[sl]||tr.seeds[nm]); return s?`<span class="mc-seed">#${s}</span>`:''; };
  const crest = (t,nm)=> nationCrest(nm,24) || (t&&t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span class="mc-noimg">${initials(nm||'?')}</span>`);
  const head = `<div class="mc-head">
      <div class="mc-team ${m.w===1?'win':''}">${crest(ta,m.a)}<span class="mc-tn">${m.aTeam?`<a href="#/team/${m.aTeam}">${esc(m.a)}</a>`:esc(m.a||'TBD')}</span>${seedOf(m.a,m.aTeam)}</div>
      <div class="mc-score"><b class="${m.w===1?'won':''}">${m.sa!=null?m.sa:'–'}</b><span>:</span><b class="${m.w===2?'won':''}">${m.sb!=null?m.sb:'–'}</b></div>
      <div class="mc-team right ${m.w===2?'win':''}">${seedOf(m.b,m.bTeam)}<span class="mc-tn">${m.bTeam?`<a href="#/team/${m.bTeam}">${esc(m.b)}</a>`:esc(m.b||'TBD')}</span>${crest(tb,m.b)}</div>
      <span class="mc-close" title="Close">×</span>
    </div>`;
  const maps = (m.stats && m.stats.maps) || [];
  let mapsHtml = '';
  if(maps.length){
    mapsHtml = `<div class="mc-sec">Maps</div><div class="mc-maps">`+maps.map(mp=>{
      const aw = mp.scoreA>mp.scoreB, bw = mp.scoreB>mp.scoreA;
      return `<div class="mc-map"><span class="mc-ms ${aw?'won':''}">${mp.scoreA!=null?mp.scoreA:'–'}</span>`+
             `<span class="mc-mn">${mp.map?esc(mp.map):'Map'}</span>`+
             `<span class="mc-ms ${bw?'won':''}">${mp.scoreB!=null?mp.scoreB:'–'}</span></div>`;
    }).join("")+`</div>`;
  }
  // lineups with this-match aggregate rating, paired A-vs-B by rating rank
  let lineHtml = '';
  const R = maps.reduce((s,mp)=>s+((mp.scoreA||0)+(mp.scoreB||0)),0);
  if(R>0){
    const agg = aggregateMaps(maps);
    const side = nm => agg.filter(p=>normKey(p.team)===normKey(nm))
      .map(p=>({...p, rtg:matchRating(p.k,p.a,p.d,p.score,R)}))
      .sort((x,y)=>(y.rtg==null?-1:y.rtg)-(x.rtg==null?-1:x.rtg));
    const A = side(m.a), B = side(m.b), n = Math.max(A.length, B.length);
    if(n){
      // 4 fixed grid columns per row: [left player][left rtg][right rtg][right player]
      // so every rating lines up in the two central columns (not staggered by name length).
      const pcell = (p, right)=>{
        if(!p) return `<span class="mc-pl ${right?'r':''}"></span>`;
        const nm = p.slug?`<a href="#/player/${p.slug}">${esc(p.name)}</a>`:esc(p.name);
        return right
          ? `<span class="mc-pl r"><span class="mc-pn">${nm}</span>${flag(p.iso)}</span>`
          : `<span class="mc-pl">${flag(p.iso)}<span class="mc-pn">${nm}</span></span>`;
      };
      const rcell = (p, cls)=>{
        const rt = (!p||p.rtg==null)?'—':p.rtg.toFixed(2);
        return `<b class="mc-rt ${cls}" style="color:${rtgColor(p&&p.rtg)}">${rt}</b>`;
      };
      let rows='';
      for(let i=0;i<n;i++) rows += `<div class="mc-lrow">${pcell(A[i],false)}${rcell(A[i],'l')}${rcell(B[i],'r')}${pcell(B[i],true)}</div>`;
      lineHtml = `<div class="mc-sec">Lineups <span>player ratings for this match</span></div><div class="mc-lines">${rows}</div>`;
    }
  }
  const btn = `<a class="mc-btn" href="#/match/${tr.slug}/${ref}">Match page</a>`;
  return `<div class="mc-card">${head}${m.odds!=null?`<div class="mc-odds">${oddsBarHtml(m,true)}</div>`:''}${mapsHtml}${lineHtml}${btn}</div>`;
}
function matchCardEl(){
  let ov = document.getElementById("match-card-ov");
  if(!ov){
    ov = document.createElement("div"); ov.id="match-card-ov"; ov.style.display="none";
    ov.innerHTML = `<div class="mc-inner"></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e=>{ if(e.target===ov) hideMatchCard(); });
    ov.addEventListener("click", e=>{ if(e.target.closest(".mc-close")||e.target.closest(".mc-btn")||e.target.closest("a")) hideMatchCard(); });
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") hideMatchCard(); });
  }
  return ov;
}
function showMatchCard(html){ const ov=matchCardEl(); ov.querySelector(".mc-inner").innerHTML=html; ov.style.display="flex"; }
function hideMatchCard(){ const ov=document.getElementById("match-card-ov"); if(ov) ov.style.display="none"; }
// every recorded map a player appeared in (from scoreboards): rtg + win/loss, oldest→newest
function playerFormLog(slug){
  const out=[];
  (DATA.tournaments||[]).forEach(tr=>{
    const scan=(matches, pfx)=>matches.forEach(m=>{
      if(!m.stats || !m.stats.maps) return;
      m.stats.maps.forEach(mp=>{
        const pl=(mp.players||[]).find(x=>x.slug===slug); if(!pl) return;
        const tot=(mp.scoreA||0)+(mp.scoreB||0); if(!tot) return;
        const onA = normKey(pl.team)===normKey(m.a);
        const won = mp.scoreA===mp.scoreB ? null : (onA ? mp.scoreA>mp.scoreB : mp.scoreB>mp.scoreA);
        out.push({ date:tr.date||'', ts:m.ts||0, event:tr.name, eventSlug:tr.slug, ref:(m.i!=null?pfx+m.i:null),
          opp:(onA?m.b:m.a)||'', score:(onA?`${mp.scoreA}-${mp.scoreB}`:`${mp.scoreB}-${mp.scoreA}`), map:mp.map||'',
          rtg:matchRating(pl.k,pl.a,pl.d,pl.score,tot), won, k:pl.k, d:pl.d });
      });
    });
    if(tr.stages && tr.stages.length) tr.stages.forEach(st=>st.rounds.forEach(rd=>scan(rd.matches, st.id+"-")));
    else (tr.bracket||[]).forEach(rd=>scan(rd.matches, ""));
  });
  // Order by when each result was actually recorded (ts), not the event's start date, so a
  // paused-then-resumed event (e.g. Bot Pro Cup, played around the Nations Cup) slots its maps
  // into the real timeline. Older scraped matches carry no ts and fall back to the event date.
  const sortKey = x => x.ts ? x.ts*1000 : (Date.parse(x.date||'')||0);
  out.sort((a,b)=> sortKey(a)-sortKey(b));
  return out;
}
// per-map play/win aggregate from a form log → favorite (most played), best & worst (win rate)
function playerMapStats(log){
  const by={};
  log.forEach(x=>{
    if(!x.map) return;
    const m = by[x.map] = by[x.map] || {map:x.map, played:0, w:0, l:0};
    m.played++;
    if(x.won===true) m.w++; else if(x.won===false) m.l++;
  });
  const arr = Object.values(by).map(m=>({...m, dec:m.w+m.l, wr:(m.w+m.l)?m.w/(m.w+m.l):0}));
  if(!arr.length) return null;
  const favorite = [...arr].sort((a,b)=> b.played-a.played || b.dec-a.dec)[0];
  const rated = arr.filter(m=>m.dec>=2);   // need a real sample for a win-rate claim
  const best = rated.length ? [...rated].sort((a,b)=> b.wr-a.wr || b.dec-a.dec)[0] : null;
  const worst = rated.length>=2 ? [...rated].sort((a,b)=> a.wr-b.wr || b.dec-a.dec)[0] : null;
  return {favorite, best, worst};
}
function formDotAttrs(x){
  return `data-rtg="${x.rtg.toFixed(2)}" data-map="${esc(x.map||'')}" data-event="${esc(x.event||'')}" `+
         `data-won="${x.won===true?'W':x.won===false?'L':'—'}" data-opp="${esc(x.opp||'')}" data-score="${esc(x.score||'')}"`;
}
function formDots(log){
  return `<span class="form-dots">${log.slice(-12).map(x=>{
    const c = x.won===true?'w':x.won===false?'l':'t';
    const label = x.won===true?'W':x.won===false?'L':'–';
    return x.ref
      ? `<a class="form-dot ${c}" href="#/match/${x.eventSlug}/${x.ref}" ${formDotAttrs(x)}>${label}</a>`
      : `<span class="form-dot ${c}" ${formDotAttrs(x)}>${label}</span>`;
  }).join("")}</span>`;
}
function formSpark(log){
  const rec=log.slice(-14); if(!rec.length) return '';
  const vals=rec.map(x=>x.rtg);
  const hi=Math.max(1.4,...vals), lo=Math.min(0.6,...vals), H=46, BW=14, GAP=4;
  const bars=rec.map((x,i)=>{ const h=Math.max(3,(H-6)*((x.rtg-lo)/((hi-lo)||1)));
    return `<rect class="fs-bar" x="${i*(BW+GAP)}" y="${H-h}" width="${BW}" height="${h}" rx="2" fill="${rtgColor(x.rtg)}" ${formDotAttrs(x)}></rect>`; }).join("");
  return `<svg class="form-spark" width="${rec.length*(BW+GAP)}" height="${H}" aria-label="recent rating trend">${bars}</svg>`;
}
// ---------------- rating / ranking history charts ----------------
// Series come from build/history.py (rebuilt every build). Players: one point per recorded match,
// grouped into event bands. Teams: points/rank after every completed event, on a time axis.
const _hc = {};
function playerHistorySeries(p){
  const ev = DATA.historyEvents||[];
  return (p.rh||[]).map(([e,pts,rk,opp,res])=>({ pts, rk, e,
    ev: e>=0 ? ev[e][1] : "Now", date: e>=0 ? ev[e][2] : "", slug: e>=0 ? ev[e][0] : "", res,
    sub: res==="S" ? "Before their first recorded match" : res==="N" ? "Today: other players' results have moved the ladder"
       : `${res==="W"?"Won":res==="L"?"Lost":"Drew"} vs ${opp||"?"}` }));
}
function teamHistorySeries(t){
  const ev = DATA.historyEvents||[];
  const now = (DATA.tournaments||[]).map(x=>x.date||"").reduce((a,b)=>b>a?b:a,"");
  return (t.rh||[]).map(([e,pts,rk,played])=>({ pts, rk, e, played: !!played,
    ev: e>=0 ? ev[e][1] : "Now", date: e>=0 ? ev[e][2] : now, slug: e>=0 ? ev[e][0] : "",
    sub: e<0 ? "Today (older results keep decaying)" : played ? "Played this event" : "Didn't play: other results and decay moved the table" }));
}
function historyChartHtml(id, pts, opts){
  if(!pts || pts.length<2) return '';
  _hc[id] = {pts, time:!!opts.time, mode:(_hc[id]&&_hc[id].mode)||"pts", ptsLabel:opts.ptsLabel||"Points"};
  const m = _hc[id].mode;
  return `<h2 class="section-title" style="margin-top:18px"><span class="accent-bar"></span>${esc(opts.title)}
      <span class="hc-toggle" data-hcid="${id}"><button type="button" data-hcmode="pts" class="${m==='pts'?'on':''}">${esc(_hc[id].ptsLabel)}</button><button type="button" data-hcmode="rk" class="${m==='rk'?'on':''}">Rank</button></span></h2>
    <div class="hc" id="hc-${id}" data-hcid="${id}">${hcSvg(id)}</div>
    ${opts.note?`<div class="hc-note">${esc(opts.note)}</div>`:''}`;
}
function hcNice(lo, hi, n, integer){   // the largest "nice" step that still gives >= 3 ticks in lo..hi
  const span = hi-lo || 1, mag = Math.pow(10, Math.floor(Math.log10(span/n)));
  const ks = integer ? [1,2,5] : [1,2,2.5,5];
  const steps = [mag/10, mag, mag*10].flatMap(m=>ks.map(k=>k*m)).filter(st=>!integer || (st>=1 && Number.isInteger(st)));
  const ticksFor = st=>{ const out=[]; for(let v=Math.ceil(lo/st-1e-9)*st; v<=hi+1e-9; v+=st) out.push(Math.round(v*100)/100); return out; };
  let best = ticksFor(steps[0]);
  for(const st of steps){ const t=ticksFor(st); if(t.length>=3 && t.length<=n+2) best=t; }
  return best;
}
function hcSvg(id){
  const c=_hc[id], P=c.pts, n=P.length, W=820, H=230, L=48, R=14, T=12, B=c.time?24:36;
  const key = c.mode==="rk" ? "rk" : "pts";
  const vals = P.map(p=>p[key]).filter(v=>v!=null);
  if(!vals.length) return '<p class="muted" style="font-size:12px">No ranked history yet.</p>';
  let lo=Math.min(...vals), hi=Math.max(...vals);
  if(key==="pts"){ const pad=(hi-lo)*0.12||20; lo-=pad; hi+=pad; } else { lo=Math.max(1,lo-1); hi=hi+1; }
  const ys = v => key==="rk" ? T+(v-lo)/((hi-lo)||1)*(H-T-B) : T+(hi-v)/((hi-lo)||1)*(H-T-B);
  let xs;
  if(c.time){ const ts=P.map(p=>Date.parse(p.date)), t0=Math.min(...ts), t1=Math.max(...ts);
    xs = ts.map(t=> t1>t0 ? L+(t-t0)/(t1-t0)*(W-L-R) : (L+W-R)/2); }
  else xs = P.map((_,i)=> L+(n>1 ? i/(n-1) : .5)*(W-L-R));
  c.geo = {xs, W, H, L, R, T, B, ys:P.map(p=>p[key]!=null?ys(p[key]):null)};
  // y grid
  const ticks = key==="rk" ? hcNice(lo,hi,4,true).filter(v=>v>=1) : hcNice(lo,hi,4);
  const grid = ticks.map(v=>`<line class="hc-grid" x1="${L}" x2="${W-R}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"/>
    <text class="hc-ylab" x="${L-7}" y="${(ys(v)+4).toFixed(1)}" text-anchor="end">${key==="rk"?"#"+v:v}</text>`).join("");
  // x: event bands (players) or year ticks (teams)
  let xaxis = "";
  if(c.time){
    const y0=new Date(P[0].date).getFullYear(), y1=new Date(P[n-1].date).getFullYear(), ts0=Date.parse(P[0].date), ts1=Date.parse(P[n-1].date);
    for(let y=y0+1; y<=y1; y++){ const x=L+(Date.parse(y+"-01-01")-ts0)/((ts1-ts0)||1)*(W-L-R);
      xaxis += `<line class="hc-grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${H-B}"/><text class="hc-xlab" x="${x.toFixed(1)}" y="${H-8}" text-anchor="middle">${y}</text>`; }
  } else {
    const bands=[]; P.forEach((p,i)=>{ const k=p.e>=0?p.e:"now"; const b=bands[bands.length-1]; if(b&&b.k===k) b.j=i; else bands.push({k, i, j:i, name:p.ev}); });
    const half = n>1 ? (W-L-R)/(n-1)/2 : 20;
    xaxis = bands.map((b,bi)=>{ const x0=Math.max(L, xs[b.i]-half), x1=Math.min(W-R, xs[b.j]+half), w=x1-x0;
      const chars=Math.floor(w/6.2), lab = chars>=4 ? (b.name.length>chars ? b.name.slice(0,chars-1)+"\u2026" : b.name) : "";
      return `<rect class="hc-band ${bi%2?'odd':''}" x="${x0.toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${H-T-B}"/>
        ${lab?`<text class="hc-xlab" x="${((x0+x1)/2).toFixed(1)}" y="${H-B+15}" text-anchor="middle">${esc(lab)}</text>`:''}`; }).join("");
  }
  // line (broken where a value is missing) + area
  let d="", started=false; P.forEach((p,i)=>{ const v=p[key]; if(v==null){ started=false; return; }
    d += `${started?"L":"M"}${xs[i].toFixed(1)},${ys(v).toFixed(1)}`; started=true; });
  const idx = P.map((p,i)=>p[key]!=null?i:-1).filter(i=>i>=0);
  const area = key==="pts" && idx.length>1 ? `<path class="hc-area" d="${d}L${xs[idx[idx.length-1]].toFixed(1)},${H-B}L${xs[idx[0]].toFixed(1)},${H-B}Z"/>` : '';
  const dots = P.map((p,i)=>{ if(p[key]==null) return '';
    const cls = c.time ? (p.played?'hc-dot played':'hc-dot') : `hc-dot r${p.res||''}`;
    if(c.time && !p.played && p.e>=0) return '';
    return `<circle class="${cls}" cx="${xs[i].toFixed(1)}" cy="${ys(p[key]).toFixed(1)}" r="${c.time?3.2:3.4}"/>`; }).join("");
  return `<svg class="hc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-hcid="${id}">
    <defs><linearGradient id="hcg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${xaxis}${grid}
    ${area.replace('class="hc-area"', `class="hc-area" fill="url(#hcg-${id})"`)}
    <path class="hc-line" d="${d}"/>${dots}
    <line class="hc-guide" x1="0" x2="0" y1="${T}" y2="${H-B}" style="display:none"/>
    <circle class="hc-focus" r="5.5" cx="0" cy="0" style="display:none"/>
    <rect class="hc-hit" x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}"/>
  </svg>`;
}
function setupHistoryCharts(){
  let tip=document.getElementById("form-tip");
  if(!tip){ tip=document.createElement("div"); tip.id="form-tip"; tip.style.display="none"; document.body.appendChild(tip); }
  let active=null;
  const nearest=(svg, ev)=>{ const c=_hc[svg.dataset.hcid]; if(!c||!c.geo) return null;
    const r=svg.getBoundingClientRect(), vx=(ev.clientX-r.left)/r.width*c.geo.W;
    let best=-1, bd=1e9; c.geo.xs.forEach((x,i)=>{ if(c.geo.ys[i]==null) return; const dd=Math.abs(x-vx); if(dd<bd){ bd=dd; best=i; } });
    return best<0?null:{c, i:best, r}; };
  const hide=()=>{ if(!active) return; active.querySelector(".hc-guide").style.display="none"; active.querySelector(".hc-focus").style.display="none"; tip.style.display="none"; active=null; };
  document.addEventListener("mousemove", ev=>{
    const svg = ev.target.closest && ev.target.closest(".hc-svg");
    if(!svg){ hide(); return; }
    const hit = nearest(svg, ev); if(!hit) return;
    if(active && active!==svg) hide();
    active = svg;
    const {c, i, r} = hit, p=c.pts[i], g=c.geo, x=g.xs[i], y=g.ys[i];
    const guide=svg.querySelector(".hc-guide"), focus=svg.querySelector(".hc-focus");
    guide.setAttribute("x1",x); guide.setAttribute("x2",x); guide.style.display="";
    focus.setAttribute("cx",x); focus.setAttribute("cy",y); focus.style.display="";
    const prev = c.pts.slice(0,i).reverse().find(q=>q.pts!=null);
    const dp = prev ? p.pts-prev.pts : 0, dr = (prev && prev.rk!=null && p.rk!=null) ? prev.rk-p.rk : 0;
    const chg = prev ? `<span class="hc-chg ${dp>0?'up':dp<0?'down':''}">${dp>0?'+':''}${dp} pts</span>${dr?` <span class="hc-chg ${dr>0?'up':'down'}">${dr>0?'\u25b2':'\u25bc'}${Math.abs(dr)}</span>`:''}` : '';
    tip.innerHTML = `<div class="ft-rtg">${p.pts!=null?p.pts:"-"} <span>pts</span>${p.rk!=null?` <span style="font-size:16px;color:var(--text)">#${p.rk}</span>`:''}</div>
      ${chg?`<div class="ft-sub">${chg}</div>`:''}
      <div class="ft-sub">${esc(p.sub)}</div>
      <div class="ft-ev">${esc(p.ev)}${p.date?" \u00b7 "+esc(p.date):""}</div>`;
    tip.style.display="block";
    const px = r.left + window.scrollX + x/g.W*r.width, py = r.top + window.scrollY + y/g.H*r.height;
    const w = tip.offsetWidth||160;
    tip.style.left = Math.max(8, Math.min(document.documentElement.clientWidth-w-8, px-w/2))+"px";
    tip.style.top = (py - tip.offsetHeight - 12)+"px";
  });
  document.addEventListener("click", ev=>{
    const b = ev.target.closest && ev.target.closest("[data-hcmode]");
    if(b){ const id=b.parentElement.dataset.hcid, c=_hc[id]; if(!c) return;
      c.mode=b.dataset.hcmode; b.parentElement.querySelectorAll("button").forEach(x=>x.classList.toggle("on", x===b));
      const box=document.getElementById("hc-"+id); if(box) box.innerHTML=hcSvg(id); hide(); return; }
    const svg = ev.target.closest && ev.target.closest(".hc-svg");
    if(svg){ const hit=nearest(svg, ev); if(hit && hit.c.pts[hit.i].slug) location.hash = "#/tournament/"+hit.c.pts[hit.i].slug; }
  });
}
// ---- peak rank pop-out (osu!-style "Highest Rank: #1 on 2 Oct 2026") on profile ranks ----
const PEAK_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtPeakDate(d){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||""); return m?`${+m[3]} ${PEAK_MONTHS[+m[2]-1]} ${m[1]}`:""; }
function peakAttr(pk){ return pk&&pk.rank ? ` data-peak-rank="${pk.rank}" data-peak-date="${esc(pk.date||"")}" tabindex="0"` : ""; }
function setupPeakTip(){
  let tip=document.getElementById("peak-tip");
  if(!tip){ tip=document.createElement("div"); tip.id="peak-tip"; tip.style.display="none"; document.body.appendChild(tip); }
  const show=el=>{
    const d=fmtPeakDate(el.dataset.peakDate);
    tip.innerHTML=`Highest Rank: <b>#${esc(el.dataset.peakRank)}</b>${d?` on ${d}`:""}`;
    tip.style.display="block";
    const r=el.getBoundingClientRect(), w=tip.offsetWidth;
    tip.style.left=Math.max(8, Math.min(document.documentElement.clientWidth-w-8, r.left+window.scrollX+r.width/2-w/2))+"px";
    tip.style.top=(r.top+window.scrollY-tip.offsetHeight-10)+"px";
  };
  document.addEventListener("mouseover", e=>{ const el=e.target.closest&&e.target.closest("[data-peak-rank]"); if(el) show(el); });
  document.addEventListener("mouseout", e=>{ const el=e.target.closest&&e.target.closest("[data-peak-rank]");
    if(el && !(e.relatedTarget && el.contains(e.relatedTarget))) tip.style.display="none"; });
  document.addEventListener("focusin", e=>{ const el=e.target.closest&&e.target.closest("[data-peak-rank]"); if(el) show(el); });
  document.addEventListener("focusout", ()=>{ tip.style.display="none"; });
  window.addEventListener("hashchange", ()=>{ tip.style.display="none"; });
}
function setupFormTip(){
  let tip=document.getElementById("form-tip");
  if(!tip){ tip=document.createElement("div"); tip.id="form-tip"; tip.style.display="none"; document.body.appendChild(tip); }
  document.addEventListener("mouseover", e=>{
    const r=e.target.closest && e.target.closest(".fs-bar, .form-dot"); if(!r) return;
    const won=r.getAttribute("data-won"), rtg=r.getAttribute("data-rtg");
    const opp=r.getAttribute("data-opp"), score=r.getAttribute("data-score"), map=r.getAttribute("data-map");
    const col=r.getAttribute("fill") || rtgColor(parseFloat(rtg));
    const clickable=r.tagName.toLowerCase()==="a";
    tip.innerHTML=`<div class="ft-rtg" style="color:${col}">${rtg} <span>RTG</span></div>
      <div class="ft-sub">${won==="W"?"Win":won==="L"?"Loss":"Tie"}${opp?" vs "+esc(opp):""}${score?" · "+esc(score):""}</div>
      <div class="ft-ev">${map?esc(map)+" · ":""}${esc(r.getAttribute("data-event")||"")}</div>
      ${clickable?`<div class="ft-go">click to view match →</div>`:""}`;
    tip.style.display="block";
    const b=r.getBoundingClientRect(), w=tip.offsetWidth||150;
    let left=b.left+window.scrollX+b.width/2-w/2;
    left=Math.max(6, Math.min(left, window.scrollX+window.innerWidth-w-8));
    tip.style.left=left+"px";
    tip.style.top=(b.top+window.scrollY-tip.offsetHeight-9)+"px";
  });
  document.addEventListener("mouseout", e=>{
    if(e.target.closest && e.target.closest(".fs-bar, .form-dot")) tip.style.display="none";
  });
}
function renderScoreboard(){
  const match = _sbMatch; if(!match) return;
  const c = document.getElementById("sb-container"); if(!c) return;
  const maps = match.stats.maps;
  const hasElo = !!(match.elo && Object.keys(match.elo).length);
  const view = _sbTab === 'all' ? aggregateMaps(maps) : maps[_sbTab].players;
  const hasXs = view.some(p=>p.rnd>0);   // advanced stats recorded (BPL Bots plugin)
  const xsCells = p => !hasXs ? '' : !(p.rnd>0) ? '<td class="mono muted">–</td>'.repeat(4) :
    `<td class="mono">${(p.dmg/p.rnd).toFixed(0)}</td><td class="mono">${Math.round(100*p.kast/p.rnd)}%</td>
     <td class="mono">${Math.round(100*p.hs/Math.max(1,p.xk!=null?p.xk:p.k))}%</td><td class="mono" title="Opening kills–deaths">${p.fk}–${p.fd}</td>`;
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
          <th class="no-sort">+/–</th>${hasXs?'<th class="no-sort" title="Average damage per round">ADR</th><th class="no-sort" title="Rounds with a kill, assist, survival or trade">KAST</th><th class="no-sort" title="Headshot kills">HS%</th><th class="no-sort" title="Opening kills–deaths">FK–FD</th>':''}<th class="no-sort">MVP</th><th class="no-sort">Score</th>
          <th class="no-sort" title="BPL match rating (HLTV-style, ~1.00 = average)">RTG</th>${hasElo?`<th class="no-sort" title="Rating Points change from ${_sbTab==='all'?'this match':'this map'} (player Elo). Hover a number for before → after.">Δ Pts</th>`:''}</tr></thead>
        <tbody>${players.map(p=>{const pm=p.k-p.d; const rtg=matchRating(p.k,p.a,p.d,p.score,rounds); return `<tr>
          <td class="name-cell">${flag(p.iso)}${p.slug?`<a href="#/player/${p.slug}">${esc(p.name)}</a>`:p.hslug?`<a href="#/human/${esc(p.hslug)}">${esc(p.name)}</a>${humanBadge(p)}`:esc(p.name)}</td>
          <td class="mono">${p.k}</td><td class="mono">${p.a}</td><td class="mono">${p.d}</td>
          <td class="mono" style="color:${pm>0?'var(--good)':pm<0?'var(--accent2)':'var(--muted)'}">${pm>0?'+':''}${pm}</td>${xsCells(p)}
          <td class="mono">${p.mvp?'★'+p.mvp:'–'}</td><td class="mono">${p.score}</td>
          <td class="mono sb-rtg" style="color:${rtgColor(rtg)}">${rtg!=null?rtg.toFixed(2):'–'}</td>${hasElo?swingCell(eloSwing(match,p.slug,_sbTab==='all'?null:_sbTab)):''}</tr>`;}).join("")}</tbody>
      </table></div></div>`;
  };
  const tabs = maps.length > 1 ? `<div class="tabs" style="margin-bottom:10px">
      <button data-tab="all" class="${_sbTab==='all'?'active':''}">All maps</button>
      ${maps.map((mp,i)=>`<button data-tab="${i}" class="${_sbTab===i?'active':''}">Map ${i+1}${mp.map?' · '+esc(mp.map):''}${mp.scoreA!=null?` (${mp.scoreA}–${mp.scoreB})`:''}</button>`).join("")}
    </div>` : (maps[0].map?`<div class="muted" style="font-size:12px;margin-bottom:8px">${esc(maps[0].map)}${maps[0].scoreA!=null?` · ${maps[0].scoreA}–${maps[0].scoreB}`:''}</div>`:'');
  // With the advanced columns two teams no longer fit side by side: one above the other.
  c.innerHTML = tabs + `<div class="sb-wrap${hasXs?' sb-stack':''}">${block(match.a, match.aTeam)}${block(match.b, match.bTeam)}</div>`;
  c.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{ _sbTab = b.dataset.tab==='all'?'all':+b.dataset.tab; renderScoreboard(); });
}
let _sfMaps = [];
let _sfListA = "allplayers", _sfListB = "allplayers";
// The BPL map pool (Ancient replaced Tuscan in October 2026; old Tuscan games stay as played).
const SF_MAP_POOL = ["Dust2","Anubis","Mirage","Inferno","Vertigo","Cache","Ancient"];
function sfTeamRoster(tr, teamName){
  if(!tr || !teamName) return null;
  const row = (tr.attending||[]).find(r=>normKey(r.team)===normKey(teamName));
  return (row && row.players && row.players.length) ? row.players.map(p=>p.name) : null;
}
function openStatsForm(slug, ref, match){
  const box = $("#m-statsform"); if(!box) return;
  const em = (match.stats&&match.stats.maps)||[];
  _sfMaps = em.length ? JSON.parse(JSON.stringify(em)) : [{map:"", players:[]}];
  // Per-team player lists: clicking a slot only suggests that team's roster for this event.
  const tr = (DATA.tournaments||[]).find(t=>t.slug===slug);
  const rosterA = sfTeamRoster(tr, match.a), rosterB = sfTeamRoster(tr, match.b);
  _sfListA = rosterA ? "sf-roster-a" : "allplayers";
  _sfListB = rosterB ? "sf-roster-b" : "allplayers";
  const dl = (id, names)=> names ? `<datalist id="${id}">${names.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>` : '';
  // Map pool: the active 7, plus Split only on a 3rd-place decider (match.tp).
  const mapPool = SF_MAP_POOL.concat(match.tp ? ["Split"] : []);
  box.innerHTML = `
    <div class="sf-wrap">
      <datalist id="allplayers">${allPlayers().map(p=>`<option value="${esc(p.name)}">`).join("")}</datalist>
      ${dl("sf-roster-a", rosterA)}${dl("sf-roster-b", rosterB)}
      ${dl("sf-maps-list", mapPool)}
      ${qeBoxHtml(match)}
      <div id="sf-maps"></div>
      <button id="sf-addmap" class="loadmore" style="margin-top:6px">+ Add map</button>
      <div style="margin-top:12px"><button id="sf-save" class="adm-btn" style="max-width:220px">Save all maps</button>
        <span id="sf-msg" class="muted" style="font-size:12px;margin-left:10px"></span></div>
    </div>`;
  renderSfMaps(match);
  setupQuickEntry(match, rosterA, rosterB);
  $("#sf-addmap").onclick = ()=>{ collectSf(match); _sfMaps.push({map:"", players:[]}); renderSfMaps(match); };
  $("#sf-save").onclick = async ()=>{
    collectSf(match);
    $("#sf-msg").textContent = "Saving…";
    const res = await apiPost("/api/matchstats", {slug, ref, maps:_sfMaps});
    if(res.ok){ await reloadData(); renderMatch(); } else $("#sf-msg").textContent = "Error: "+(res.error||"failed");
  };
}
// ---- quick scoreboard entry: type or paste the whole match as text; checked live, then fills the grid ----
// One line per map ("Mirage 13 11"), then one line per player ("ebi 24 3 15 3 62"). Names can be the first
// few letters or have a typo: they're matched to the two line-ups, which also tells which team they're on.
// Checks use rules that held on 500+ recorded BPL maps: a team's kills can't exceed the other team's deaths,
// and a team's MVP stars equal the rounds it won.
const QE_ORDERS = {kadms:["k","a","d","mvp","score"], kdams:["k","d","a","mvp","score"], kdasm:["k","d","a","score","mvp"], kadsm:["k","a","d","score","mvp"]};
const QE_LABEL = {k:"K", a:"A", d:"D", mvp:"MVP", score:"Score"};
const QE_EXTRA_MAPS = ["Tuscan","Split","Nuke","Overpass","Ancient","Train","Office"];
function qeOrderKey(){ try{ const k=localStorage.getItem("bpl_qe_order"); return QE_ORDERS[k]?k:"kadms"; }catch(e){ return "kadms"; } }
function qeMapName(w){ const k=normKey(String(w||"").replace(/^de_/i,"")); return SF_MAP_POOL.concat(QE_EXTRA_MAPS).find(m=>normKey(m)===k)||null; }
function qeLev(a,b){
  const dp=Array.from({length:a.length+1},(_,i)=>[i]);
  for(let j=1;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++)
    dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[a.length][b.length];
}
function qeResolve(name, cands){
  const k=normKey(name); if(!k) return null;
  for(const test of [c=>normKey(c.name)===k, c=>normKey(c.name).startsWith(k), c=>normKey(c.name).includes(k)]){
    const hit=cands.filter(test);
    if(hit.length===1) return {c:hit[0], exact:normKey(hit[0].name)===k};
    if(hit.length>1) return {amb:hit};
  }
  // typo tolerance: distance to the whole name or to its start (so "notorius" still finds NOTORIOUS47)
  const dist=c=>{ const n=normKey(c.name); return Math.min(qeLev(k,n), ...[-1,0,1].map(o=>k.length+o>=3?qeLev(k,n.slice(0,k.length+o)):99)); };
  const sc=cands.map(c=>({c, d:dist(c)})).sort((x,y)=>x.d-y.d);
  if(sc.length && sc[0].d<=Math.max(1,Math.floor(k.length/4)) && (sc.length===1||sc[1].d>sc[0].d)) return {c:sc[0].c, exact:false};
  return null;
}
function qeValidScore(a,b){             // MR12 (first to 13), overtime MR3 first to 4: 16-14, 19-17, ...
  const hi=Math.max(a,b), lo=Math.min(a,b);
  if(hi===13) return lo<=11;
  return hi>13 && (hi-16)%3===0 && lo>=hi-4 && lo<=hi-2;
}
function qeParse(text, match, rosterA, rosterB){
  const order=QE_ORDERS[qeOrderKey()];
  const lineup=[...(rosterA||[]).map(n=>({name:n, team:match.a})), ...(rosterB||[]).map(n=>({name:n, team:match.b}))];
  const everyone=allPlayers().map(p=>({name:p.name, team:null}));
  const maps=[], lineErrs=[]; let cur=null;
  const newMap=(name,sa,sb)=>{ cur={map:name||"", scoreA:sa, scoreB:sb, rows:[]}; maps.push(cur); };
  text.split(/\r?\n/).forEach((raw,ln)=>{
    const line=raw.replace(/[★*]/g," ").trim(); if(!line || line.startsWith("#")) return;
    const hm=line.match(/^(?:map\s*\d*\s*[:.\-]?\s*)?([a-z_0-9]+)(?:\s+(\d+)\s*[-:–\s]\s*(\d+))?\s*$/i);
    if(hm && qeMapName(hm[1])){ newMap(qeMapName(hm[1]), hm[2]!=null?+hm[2]:null, hm[3]!=null?+hm[3]:null); return; }
    const toks=line.split(/[\s,;|]+/).filter(Boolean), nums=[];
    while(toks.length && /^\d+$/.test(toks[toks.length-1])) nums.unshift(+toks.pop());
    while(nums.length>5) toks.push(String(nums.shift()));          // a name that ends in a number ("Player 2")
    const name=toks.join(" ");
    if(!name){ lineErrs.push(`Line ${ln+1}: no player name.`); return; }
    if(nums.length!==5){ lineErrs.push(`Line ${ln+1} (${name}): expected 5 numbers (${order.map(c=>QE_LABEL[c]).join(" ")}), found ${nums.length}.`); return; }
    if(!cur) newMap("", null, null);
    const st={}; order.forEach((c,i)=>st[c]=nums[i]);
    const r=qeResolve(name, lineup);
    if(r&&r.c) cur.rows.push({typed:name, name:r.c.name, team:r.c.team, exact:r.exact, ...st});
    else if(r&&r.amb) cur.rows.push({typed:name, name, team:null, amb:r.amb.map(c=>c.name), ...st});
    else { const g=qeResolve(name, everyone);
      cur.rows.push({typed:name, name:g&&g.c?g.c.name:name, team:null, stand:!!(g&&g.c), unknown:!(g&&g.c), exact:!!(g&&g.c&&g.exact), ...st}); }
  });
  // players outside both line-ups (stand-ins / unknown): put them on the team that's short
  maps.forEach(mp=>{
    mp.rows.filter(r=>!r.team).forEach(r=>{
      const nA=mp.rows.filter(x=>x.team===match.a).length, nB=mp.rows.filter(x=>x.team===match.b).length;
      r.team = nA<5 && (nA<=nB || nB>=5) ? match.a : match.b; r.guessTeam=true;
    });
    mp.checks=qeChecks(mp, match);
  });
  // whole-match check: maps won vs the result entered in the bracket
  const matchErrs=[];
  if(match.w===1||match.w===2){
    let wa=0,wb=0; maps.forEach(mp=>{ if(mp.scoreA!=null&&mp.scoreB!=null){ if(mp.scoreA>mp.scoreB) wa++; else if(mp.scoreB>mp.scoreA) wb++; } });
    const bo=match.bo||1;
    if((wa||wb) && (bo>1 ? (wa!==match.sa||wb!==match.sb) : ((wa>wb?1:2)!==match.w)))
      matchErrs.push({lv:"bad", t:`These maps make it ${wa}-${wb}, but the bracket result is ${match.w===1?match.a:match.b} winning${bo>1?` ${Math.max(match.sa,match.sb)}-${Math.min(match.sa,match.sb)}`:''}.`});
  }
  return {maps, lineErrs, matchErrs, order};
}
function qeChecks(mp, match){
  const out=[], A=mp.rows.filter(r=>r.team===match.a), B=mp.rows.filter(r=>r.team===match.b);
  const sum=(rs,c)=>rs.reduce((t,r)=>t+(r[c]||0),0);
  [[match.a,A],[match.b,B]].forEach(([nm,rs])=>{ if(rs.length!==5) out.push({lv:"bad", t:`${nm} has ${rs.length} player${rs.length===1?'':'s'} (needs 5).`}); });
  const seen={}; mp.rows.forEach(r=>{ const k=normKey(r.name); if(seen[k]) out.push({lv:"bad", t:`${r.name} is listed twice.`}); seen[k]=1; });
  mp.rows.forEach(r=>{
    if(r.amb) out.push({lv:"bad", t:`"${r.typed}" could be ${r.amb.join(" or ")}: type a bit more of the name.`});
    else if(r.unknown) out.push({lv:"warn", t:`"${r.typed}" isn't a known player; it will be saved as typed (on ${r.team}).`});
    else if(r.stand) out.push({lv:"warn", t:`${r.name} isn't in either line-up at this event; put on ${r.team} (fix in the grid if wrong).`});
  });
  if(A.length&&B.length){
    const kA=sum(A,"k"), kB=sum(B,"k"), dA=sum(A,"d"), dB=sum(B,"d");
    [[match.a,kA,match.b,dB],[match.b,kB,match.a,dA]].forEach(([x,k,y,d])=>{
      if(k>d) out.push({lv:"bad", t:`${x}'s kills (${k}) are more than ${y}'s deaths (${d}). That can't happen, so a K or D is off.`});
      else if(d-k>=4) out.push({lv:"warn", t:`${y} have ${d-k} deaths that weren't kills by ${x} (${d} deaths, ${k} kills). Usually 0 to 2: check the K and D columns.`});
    });
    if(mp.scoreA!=null&&mp.scoreB!=null){
      const mA=sum(A,"mvp"), mB=sum(B,"mvp");
      if(mA===mp.scoreB && mB===mp.scoreA && mA!==mB)
        out.push({lv:"bad", t:`The MVP stars say ${mA>mB?match.a:match.b} won ${Math.max(mA,mB)}-${Math.min(mA,mB)}. Is the map score the wrong way round? (left number = ${match.a})`});
      else {
        if(mA!==mp.scoreA) out.push({lv:"warn", t:`${match.a}'s MVP stars (${mA}) should equal the rounds they won (${mp.scoreA}).`});
        if(mB!==mp.scoreB) out.push({lv:"warn", t:`${match.b}'s MVP stars (${mB}) should equal the rounds they won (${mp.scoreB}).`});
      }
    }
  }
  if(mp.scoreA!=null&&mp.scoreB!=null&&!qeValidScore(mp.scoreA,mp.scoreB)) out.push({lv:"warn", t:`${mp.scoreA}-${mp.scoreB} isn't a possible final score (MR12, overtime first to 4).`});
  if(!mp.map) out.push({lv:"warn", t:"No map name: start the map with a line like \"Mirage 13 11\"."});
  return out;
}
function qeBoxHtml(match){
  const ok=qeOrderKey();
  return `<details class="qe" ${match.stats?'':'open'}><summary><b>Quick entry</b> <span class="muted">· type or paste the whole scoreboard as text, checked as you type</span></summary>
    <div class="qe-help">A line per map (<code>Mirage 13 11</code>, left score = ${esc(match.a||'team A')}), then a line per player:
      <code>name</code> + the numbers in this order:
      <select id="qe-order" class="adm-in">${Object.keys(QE_ORDERS).map(k=>`<option value="${k}" ${k===ok?'selected':''}>${QE_ORDERS[k].map(c=>QE_LABEL[c]).join(" ")}</option>`).join("")}</select>.
      The first few letters of a name are enough; the team is worked out from the line-ups.</div>
    <div class="qe-cols"><textarea id="qe-text" class="adm-in" rows="14" spellcheck="false" placeholder="Mirage 13 11&#10;ebi 24 3 15 3 62&#10;crex 21 5 14 2 55&#10;…&#10;&#10;Inferno 16 14&#10;…"></textarea>
      <div id="qe-preview" class="qe-preview"><span class="muted">The parsed scoreboard and checks show here.</span></div></div>
    <div class="qe-foot"><button id="qe-apply" class="adm-btn" style="margin:0;max-width:220px" disabled>Fill the form below</button>
      <span id="qe-msg" class="muted" style="font-size:12px"></span></div></details>`;
}
function qeToText(maps, match, order){
  return maps.map(mp=>{
    const head=`${mp.map||'Map'}${mp.scoreA!=null?` ${mp.scoreA} ${mp.scoreB}`:''}`;
    const rows=[match.a,match.b].flatMap(t=>(mp.players||[]).filter(p=>normKey(p.team)===normKey(t)))
      .map(p=>`${p.name} ${order.map(c=>p[c]!=null?p[c]:0).join(" ")}`);
    return [head,...rows].join("\n");
  }).join("\n\n");
}
function setupQuickEntry(match, rosterA, rosterB){
  const ta=$("#qe-text"); if(!ta) return;
  const existing = match.stats&&match.stats.maps&&match.stats.maps.length ? match.stats.maps : null;
  if(existing) ta.value=qeToText(existing, match, QE_ORDERS[qeOrderKey()]);
  let parsed=null;
  const draw=()=>{
    parsed=qeParse(ta.value, match, rosterA, rosterB);
    const pv=$("#qe-preview"), btn=$("#qe-apply");
    if(!ta.value.trim()){ pv.innerHTML='<span class="muted">The parsed scoreboard and checks show here.</span>'; btn.disabled=true; $("#qe-msg").textContent=''; return; }
    const issue=i=>`<div class="qe-i qe-${i.lv}">${i.lv==='bad'?'✗':'!'} ${esc(i.t)}</div>`;
    const team=(mp,nm)=>{ const rs=mp.rows.filter(r=>r.team===nm);
      return `<div class="qe-team"><div class="qe-tn">${esc(nm||'?')}</div>${rs.map(r=>`<div class="qe-r">
        <span class="qe-n ${r.amb||r.unknown?'bad':r.stand||r.guessTeam?'warn':''}" title="${esc('typed: '+r.typed)}">${esc(r.amb?r.typed+'?':r.name)}${!r.exact&&!r.amb&&!r.unknown?` <i>${esc(r.typed)}</i>`:''}</span>
        ${["k","a","d","mvp","score"].map(c=>`<span>${r[c]}</span>`).join("")}</div>`).join("")}</div>`; };
    pv.innerHTML = parsed.lineErrs.map(t=>issue({lv:"bad",t})).join("") + parsed.matchErrs.map(issue).join("") +
      parsed.maps.map((mp,i)=>`<div class="qe-map"><div class="qe-mh">Map ${i+1}${mp.map?' · '+esc(mp.map):''}${mp.scoreA!=null?` <b>${mp.scoreA}-${mp.scoreB}</b>`:''}</div>
        <div class="qe-hdr"><span></span><span>K</span><span>A</span><span>D</span><span>MVP</span><span>Score</span></div>
        ${team(mp,match.a)}${team(mp,match.b)}
        ${mp.checks.length?mp.checks.map(issue).join(""):'<div class="qe-i qe-ok">✓ Kills, deaths, MVPs and score all add up.</div>'}</div>`).join("");
    const bad=parsed.lineErrs.length + parsed.matchErrs.length + parsed.maps.reduce((t,mp)=>t+mp.checks.filter(c=>c.lv==='bad').length,0);
    btn.disabled=!parsed.maps.length;
    $("#qe-msg").textContent = !parsed.maps.length ? '' : bad ? `${bad} problem${bad===1?'':'s'} marked ✗: you can still fill the form and fix them there.` : 'Looks good.';
    $("#qe-msg").style.color = bad ? 'var(--accent2,#ff6b6b)' : 'var(--good)';
    return bad;
  };
  ta.addEventListener("input", draw);
  $("#qe-order").onchange=e=>{
    const before=QE_ORDERS[qeOrderKey()];
    try{ localStorage.setItem("bpl_qe_order", e.target.value); }catch(_){}
    // untouched prefilled text: rewrite it in the new column order
    if(existing && ta.value===qeToText(existing, match, before)) ta.value=qeToText(existing, match, QE_ORDERS[e.target.value]);
    draw();
  };
  $("#qe-apply").onclick=()=>{
    if(!parsed||!parsed.maps.length) return;
    _sfMaps = parsed.maps.map(mp=>({map:mp.map, scoreA:mp.scoreA, scoreB:mp.scoreB,
      players: mp.rows.map(r=>({team:r.team, name:r.amb?r.typed:r.name, k:r.k, a:r.a, d:r.d, mvp:r.mvp, score:r.score}))}));
    renderSfMaps(match);
    $("#qe-msg").textContent="Filled. Check the grid, then press Save all maps."; $("#qe-msg").style.color="var(--good)";
    $("#sf-maps").scrollIntoView({behavior:"smooth", block:"start"});
  };
  if(ta.value && draw()) document.querySelector("details.qe").open = true;   // a saved scoreboard that fails a check
}
// The advanced stats aren't in the form, so an edit keeps whatever the line had.
function collectSf(match){
  const before = _sfMaps;
  _sfMaps = [...document.querySelectorAll(".sf-map")].map((bl,mi)=>{
    const num=(el,c)=>{const v=el.querySelector(c).value; return v===''?0:+v;};
    const sa=bl.querySelector(".sf-scA").value, sb=bl.querySelector(".sf-scB").value;
    const players=[];
    const old=((before[mi]&&before[mi].players)||[]).filter(x=>x.rnd>0);
    bl.querySelectorAll(".sf-row").forEach(r=>{
      const name=r.querySelector(".sf-name").value.trim(); if(!name) return;
      const was=old.find(x=>normKey(x.name)===normKey(name)&&normKey(x.team)===normKey(r.dataset.team));
      const xs={}; if(was) XS_KEYS.forEach(k=>{ xs[k]=was[k]||0; });
      players.push({team:r.dataset.team, name, k:num(r,".sf-k"), a:num(r,".sf-a"), d:num(r,".sf-d"), mvp:num(r,".sf-mvp"), score:num(r,".sf-score"), ...xs});
    });
    return {map:bl.querySelector(".sf-mapname").value.trim(), scoreA:sa===''?null:+sa, scoreB:sb===''?null:+sb, players};
  });
}
function renderSfMaps(match){
  const c = $("#sf-maps"); if(!c) return;
  const rowFor=(mp,teamName,idx,listId)=>{
    const p=(mp.players||[]).filter(x=>normKey(x.team)===normKey(teamName))[idx]||{};
    const v=k=>p[k]!=null?p[k]:'';
    return `<div class="sf-row" data-team="${esc(teamName)}">
      <input class="sf-in sf-name" placeholder="player" list="${listId}" value="${esc(p.name||'')}">
      <input class="sf-in sf-k" type="number" placeholder="K" value="${v('k')}">
      <input class="sf-in sf-a" type="number" placeholder="A" value="${v('a')}">
      <input class="sf-in sf-d" type="number" placeholder="D" value="${v('d')}">
      <input class="sf-in sf-mvp" type="number" placeholder="MVP" value="${v('mvp')}">
      <input class="sf-in sf-score" type="number" placeholder="Score" value="${v('score')}"></div>`;
  };
  const teamBlock=(mp,teamName,listId)=> teamName ? `<div class="sf-team"><div class="sf-th">${esc(teamName)}</div>
    <div class="sf-hdr"><span>Player</span><span>K</span><span>A</span><span>D</span><span>MVP</span><span>Score</span></div>
    ${[0,1,2,3,4].map(i=>rowFor(mp,teamName,i,listId)).join("")}</div>` : '';
  c.innerHTML = _sfMaps.map((mp,mi)=>`<div class="sf-map">
      <div class="sf-maphdr"><span class="sf-mapno">Map ${mi+1}</span>
        <input class="sf-in sf-mapname" placeholder="map" list="sf-maps-list" value="${esc(mp.map||'')}" style="max-width:150px">
        <span class="muted" style="font-size:11px">score</span>
        <input class="sf-in sf-scA" type="number" title="${esc(match.a||'A')}" value="${mp.scoreA!=null?mp.scoreA:''}" style="width:52px">
        <input class="sf-in sf-scB" type="number" title="${esc(match.b||'B')}" value="${mp.scoreB!=null?mp.scoreB:''}" style="width:52px">
        ${_sfMaps.length>1?`<button class="sf-delmap" data-mi="${mi}" title="remove map">✕ map</button>`:''}</div>
      <div class="sf-teams">${teamBlock(mp,match.a,_sfListA)}${teamBlock(mp,match.b,_sfListB)}</div></div>`).join("");
  c.querySelectorAll(".sf-delmap").forEach(b=>b.onclick=()=>{ collectSf(match); _sfMaps.splice(+b.dataset.mi,1); if(!_sfMaps.length) _sfMaps=[{map:"",players:[]}]; renderSfMaps(match); });
}

// ---------- Admin (local editing) ----------
let adminEditing = null, _adminTeams = [], _adminOn = false;
async function reloadData(){ try{ DATA = await loadData(5); _allMatches=null; _rivals=null; _allMapScores=null; _proSlugs=null; _soloLeague=null; livePushDirty(); }catch(e){} }
function apiPost(p, body){ return fetch(p,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body)}).then(r=>r.json())
  .then(res=>{ if(res && res.ok && body && body.slug && LIVE_PATHS.test(p)) LivePush.dirty.add(body.slug); return res; })   // sent live after the reload
  .catch(e=>({ok:false,error:String(e)})); }
// Site Health panel (admin): results of build/health.py, recomputed on every build
function adminHealthHtml(){
  const hl = DATA.health;
  if(!hl) return '';
  const c = hl.counts||{}, issues = hl.issues||[];
  const item = i=>`<div class="hl-item hl-${i.level}"><span class="hl-dot"></span><span class="hl-check">${esc(i.check)}</span>
    <span class="hl-msg">${esc(i.msg)}</span>${i.link?`<a class="hl-link" href="${esc(i.link)}">view →</a>`:''}</div>`;
  const serious = issues.filter(i=>i.level!=="info"), notes = issues.filter(i=>i.level==="info" && !i.fix);
  const genderFix = issues.filter(i=>i.fix && i.fix.kind==="gender");
  const prizeFix = issues.filter(i=>i.fix && i.fix.kind==="prize");
  const ok = !c.error && !c.warning;
  const head = ok ? `<span class="hl-ok">✓ All checks passed</span>`
    : `${c.error?`<span class="hl-pill hl-error">${c.error} error${c.error===1?'':'s'}</span>`:''}${c.warning?`<span class="hl-pill hl-warning">${c.warning} warning${c.warning===1?'':'s'}</span>`:''}`;
  return `<div class="adm-health ${ok?'ok':'bad'}">
    <div class="hl-head"><span class="adm-pub-t" style="font-size:14px">Site Health</span>${head}
      <span class="muted" style="font-size:11px;margin-left:auto">checked at last build · ${esc((hl.generated||'').replace('T',' '))}</span></div>
    ${serious.length?`<div class="hl-list">${serious.map(item).join("")}</div>`:''}
    ${genderFix.length?genderFixHtml(genderFix):''}
    ${_gfDone?`<div class="gf-done">✓ ${esc(_gfDone)}</div>`:''}
    ${prizeFix.length?prizeFixHtml(prizeFix):''}
    ${_pfDone?`<div class="gf-done">✓ ${esc(_pfDone)}</div>`:''}
    ${notes.length?`<details class="hl-notes"><summary>${notes.length} note${notes.length===1?'':'s'} (FYI)</summary><div class="hl-list">${notes.map(item).join("")}</div></details>`:''}
  </div>`;
}
// quick fix: set many players' genders at once (He / She / They), saved in one go
let _gfDone = null;
function genderFixHtml(fixes){
  const rows = fixes.map(i=>{
    const p = rsAllPlayers().find(x=>x.slug===i.fix.slug) || {};
    return `<div class="gf-row" data-gfname="${esc(i.fix.player)}">
      <span class="gf-who">${flag(p.iso)}<a href="#/player/${esc(i.fix.slug)}">${esc(i.fix.player)}</a>
        <span class="muted">${esc(p.team||"Free agent")}</span></span>
      <span class="gf-btns"><button type="button" data-g="F">She</button><button type="button" data-g="M">He</button><button type="button" data-g="NB">They</button></span>
    </div>`; }).join("");
  return `<details class="hl-fix" open><summary><b>Missing genders</b> <span class="muted">· ${fixes.length} player${fixes.length===1?'':'s'}: pick She / He / They for each, then save them all at once</span></summary>
    <div class="gf-grid">${rows}</div>
    <div class="gf-foot"><button id="gf-save" class="adm-btn" style="margin:0" disabled>Save 0 genders</button>
      <span class="muted" style="font-size:11px">"They" is saved as a deliberate they/them choice, so it leaves this list too.</span>
      <span id="gf-msg" style="font-size:12px"></span></div>
  </details>`;
}
// quick fix: type the prize pool of every event that doesn't have one, saved in one go
let _pfDone = null;
function prizeFixHtml(fixes){
  const rows = fixes.map(i=>{ const f=i.fix, tr=(DATA.tournaments||[]).find(t=>t.slug===f.slug)||{tier:f.tier,tierLabel:f.tier};
    return `<div class="pf-row" data-pfslug="${esc(f.slug)}" data-pftier="${esc(f.tier)}">
      <span class="pf-ev">${tierBadgeEvent(tr)} <a href="#/tournament/${esc(f.slug)}">${esc(f.name)}</a> <span class="muted">${fmtDate(f.date)}</span></span>
      <span class="pf-in"><input class="adm-in pf-amt" inputmode="numeric" placeholder="$ prize pool"><span class="pf-sub muted"></span></span>
    </div>`; }).join("");
  return `<details class="hl-fix" open><summary><b>Missing prize pools</b> <span class="muted">· ${fixes.length} event${fixes.length===1?'':'s'}: type each prize pool in dollars, then save them all at once</span></summary>
    <div class="muted" style="font-size:11px;margin:4px 0 8px">${esc(PRIZE_HINT)} Until an event has a prize pool it pays no prize money and keeps its plain tier weight.</div>
    <div class="pf-grid">${rows}</div>
    <div class="gf-foot"><button id="pf-save" class="adm-btn" style="margin:0" disabled>Save 0 prize pools</button><span id="pf-msg" style="font-size:12px"></span></div>
  </details>`;
}
function setupPrizeFix(){
  const save = $("#pf-save"); if(!save) return;
  const collect=()=>{ const out={}; document.querySelectorAll(".pf-row").forEach(r=>{ const v=parseUSD(r.querySelector(".pf-amt").value); if(v) out[r.dataset.pfslug]=v; }); return out; };
  document.querySelectorAll(".pf-row").forEach(r=>{
    const inp=r.querySelector(".pf-amt"), lab=r.querySelector(".pf-sub");
    inp.oninput=()=>{ const v=parseUSD(inp.value); lab.textContent = v ? (subTierFor(r.dataset.pftier, v) ? '→ '+subTierFor(r.dataset.pftier, v) : fmtUSD(v)) : '';
      const n=Object.keys(collect()).length; save.disabled=!n; save.textContent=`Save ${n} prize pool${n===1?'':'s'}`; };
  });
  save.onclick=async ()=>{
    const pools=collect(); save.disabled=true; save.textContent="Saving…";
    const r = await apiPost("/api/prizepools", {pools});
    if(!r.ok){ $("#pf-msg").style.color="var(--accent2,#ff6b6b)"; $("#pf-msg").textContent=r.error||r.msg||"Failed."; save.disabled=false; return; }
    _pfDone = `Saved ${r.changed} prize pool${r.changed===1?'':'s'}. Earnings and rankings are updated.`;
    await reloadData(); renderAdmin();
  };
}
function setupGenderFix(){
  const save = $("#gf-save"); if(!save) return;
  const picks = {};
  document.querySelectorAll(".gf-row").forEach(row=>{
    row.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{
      const name=row.dataset.gfname, on = picks[name]!==b.dataset.g;
      row.querySelectorAll("[data-g]").forEach(x=>x.classList.remove("on"));
      if(on){ picks[name]=b.dataset.g; b.classList.add("on"); } else delete picks[name];
      const n=Object.keys(picks).length; save.disabled=!n; save.textContent=`Save ${n} gender${n===1?'':'s'}`;
    });
  });
  save.onclick=async ()=>{
    save.disabled=true; save.textContent="Saving…";
    const r = await apiPost("/api/roster", {action:"genders", genders:picks, dryRun:false});
    if(!r.ok){ $("#gf-msg").style.color="var(--accent2,#ff6b6b)"; $("#gf-msg").textContent=r.error||r.msg||"Failed."; save.disabled=false; return; }
    _gfDone = (r.changes||[])[0] || "Saved.";
    await reloadData(); renderAdmin();
  };
}
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
  const _active = state.tournaments.filter(t=>!t.completed);
  const _done = state.tournaments.filter(t=>t.completed);
  const _tierBadge = t=>`<span class="event-tier ${TIER_CLASS[t.tier]}">${esc((t.tier==='major'?'MAJ':t.tier==='s'?'S':'A'))}</span>`;
  const listHtml = _active.length ? _active.map(t=>`
      <div class="adm-trow">
        ${_tierBadge(t)}
        <a href="#/admin" data-edit="${esc(t.slug)}" class="adm-name">${esc(t.name)}</a>
        <span class="muted" style="font-size:12px">${esc(t.date)} · ${t.stages} stage${t.stages===1?'':'s'}</span>
        <a href="#/tournament/${esc(t.slug)}" class="muted" style="font-size:12px">view →</a>
        <button class="adm-predlock ${t.predictionsLocked?'on':''}" data-predlock="${esc(t.slug)}" data-locked="${t.predictionsLocked?1:0}"
          title="${t.predictionsLocked?'Predictions are locked — click to reopen them':'Start this tournament — lock predictions so no new entries or edits are accepted'}">${t.predictionsLocked?'🔒 Predictions locked':'▶ Start (lock predictions)'}</button>
        <button class="adm-complete" data-complete="${esc(t.slug)}" title="Mark finished — freezes the rosters that played and moves it to Completed">✓ Complete</button>
        <button class="adm-del" data-del="${esc(t.slug)}" title="Delete">✕</button>
      </div>`).join("") : '<p class="muted">No active tournaments.</p>';
  const doneHtml = _done.length ? `<details class="adm-archived" style="margin-top:12px">
      <summary style="cursor:pointer;color:var(--muted);font-size:13px;padding:4px 0">Completed events (${_done.length})</summary>
      ${_done.map(t=>`<div class="adm-trow" style="opacity:.85">
        ${_tierBadge(t)}
        <span class="adm-name">${esc(t.name)}</span>
        <span class="muted" style="font-size:12px">${esc(t.date)} · rosters frozen</span>
        <a href="#/tournament/${esc(t.slug)}" class="muted" style="font-size:12px">view →</a>
        <button class="adm-wrap" data-wrap="${esc(t.slug)}" title="Apply this event's end-of-event rules (promotions, disbands, seeds) and draft the recap">🏁 Wrap up</button>
        <button class="adm-reopen" data-reopen="${esc(t.slug)}" title="Reopen for editing (rosters stay frozen until re-completed)">↩ Reopen</button>
      </div><div class="adm-wrapbox" data-wrapbox="${esc(t.slug)}"></div>`).join("")}
    </details>` : '';

  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Admin <span class="muted" style="font-size:11px">· editing enabled</span></h2>
    <div class="adm-publish">
      <div>
        <div class="adm-pub-t">⬆ Publish to the live site</div>
        <div class="muted" style="font-size:12px">Push all your latest edits to GitHub — the public site updates about a minute later.</div>
        ${(DATA.health&&DATA.health.counts&&DATA.health.counts.error)?`<div style="font-size:12px;margin-top:6px;color:var(--accent2,#ff6b6b)">Deploy guard: Site Health has ${DATA.health.counts.error} error${DATA.health.counts.error===1?'':'s'} below, so publishing is blocked until they're fixed. The live site stays as it is.</div>`:''}
        <div id="adm-pubmsg" style="font-size:12px;margin-top:6px"></div>
      </div>
      <button id="adm-publish" class="adm-btn adm-pub-btn">Publish to GitHub</button>
    </div>
    ${adminHealthHtml()}
    <div id="adm-live" class="adm-live"></div>
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
        <label class="adm-l" title="${esc(PRIZE_HINT)}">Prize pool (USD) <span id="adm-prize-sub" class="muted"></span></label>
        <input id="adm-prize" class="adm-in" inputmode="numeric" placeholder="e.g. 250,000">
        <button id="adm-create" class="adm-btn">Create tournament</button>
        <div id="adm-msg" class="muted" style="font-size:12px;margin-top:8px">Create it, then add stages (a bracket, groups, swiss…) in the editor.</div>
      </div>
      <div>
        <h3 class="rec-group" style="margin-top:0">Your Tournaments</h3>
        <div class="adm-list">${listHtml}</div>
        ${doneHtml}
        <div id="adm-editor" style="margin-top:18px"></div>
      </div>
    </div>
    <div class="adm-roster" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>Roster Tools</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Transfers, new players, renames, promotions and disbands. Every change shows a preview first; nothing is saved until you press <strong>Apply</strong>.</p>
      <div class="tabs rs-tabs">${RS_TABS.map(([k,l])=>`<button data-rstab="${k}" class="${k===rosterTab?'active':''}">${l}</button>`).join("")}</div>
      <div class="profile-grid" style="grid-template-columns:380px 1fr">
        <div class="infobox" style="padding:14px"><div id="rs-form"></div></div>
        <div id="rs-preview" class="rs-preview"><p class="muted" style="font-size:12px">Fill in the form and press <strong>Preview changes</strong>.</p></div>
      </div>
    </div>
    <div class="adm-news" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>News / Articles</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Write an article and publish it to the News page. Supports <code>**bold**</code>, <code>*italic*</code>, and <code>[links](#/team/masmark)</code>. Leave a blank line between paragraphs.</p>
      <div class="profile-grid" style="grid-template-columns:1fr 300px">
        <div class="infobox" style="padding:14px">
          <div class="ib-title" style="margin:-14px -14px 12px" id="art-formtitle">New Article</div>
          <input type="hidden" id="art-slug">
          <label class="adm-l">Title</label>
          <input id="art-title" class="adm-in" placeholder="Masmark part ways with estellyy., sign HikariiFloofie">
          <div style="display:flex;gap:8px">
            <div style="flex:1"><label class="adm-l">Date</label><input id="art-date" class="adm-in" type="date"></div>
            <div style="flex:1"><label class="adm-l">Author (optional)</label><input id="art-author" class="adm-in" placeholder="BPL Staff"></div>
          </div>
          <label class="adm-l">Body</label>
          <input type="hidden" id="art-draft">
          <div class="art-wrap"><textarea id="art-body" class="adm-in" rows="10" placeholder="Write the article here…&#10;&#10;Blank line between paragraphs. Type [[ to link a player, team or event."></textarea>
          <div id="art-ac" class="art-ac" hidden></div></div>
          <div class="muted" style="font-size:11px;margin-top:4px">Links: type <code>[[</code> and pick a name, e.g. <code>[[rebebx]]</code>. Custom text: <code>[[Aimpunch|the champions]]</code>.</div>
          <div id="ai-box" class="ai-box"></div>
          <button id="art-save" class="adm-btn" style="margin-top:8px">Save article</button>
          <button id="art-new" class="adm-btn" style="margin-top:6px;background:var(--panel);border:1px solid var(--border);color:var(--text)">+ New (clear)</button>
          <div id="art-msg" class="muted" style="font-size:12px;margin-top:8px"></div>
        </div>
        <div>
          <div id="art-drafts"></div>
          <h3 class="rec-group" style="margin-top:0">Published articles <span id="art-count" class="muted" style="font-size:11px"></span></h3>
          <input id="art-filter" class="adm-in" placeholder="Filter by title or date…" style="margin-bottom:8px">
          <div id="art-list" class="adm-list adm-list-scroll"><p class="muted">None yet.</p></div>
        </div>
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
          <label class="adm-l">Score</label>
          <div class="sq-scorebar">
            <input id="sq-score-a" class="adm-in sq-score" type="number" min="0" placeholder="13" title="Team A rounds">
            <span class="sq-vs">–</span>
            <input id="sq-score-b" class="adm-in sq-score" type="number" min="0" placeholder="0" title="Team B rounds">
            <span class="muted" style="font-size:11px">winner is set automatically</span>
          </div>
          <div class="sq-team-h" id="sq-th-a"><span>Team A</span><span class="sq-th-badge" id="sq-badge-a"></span></div>
          <div id="sq-players-a"></div>
          <button class="adm-btn sq-teamadd" data-team="a" style="margin-top:4px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 8px">+ add</button>
          <div class="sq-team-h" id="sq-th-b" style="margin-top:12px"><span>Team B</span><span class="sq-th-badge" id="sq-badge-b"></span></div>
          <div id="sq-players-b"></div>
          <button class="adm-btn sq-teamadd" data-team="b" style="margin-top:4px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 8px">+ add</button>
          <button id="sq-save" class="adm-btn" style="margin-top:10px">Save game</button>
          <div id="sq-msg" class="muted" style="font-size:12px;margin-top:8px"></div>
          <button id="sq-rand" class="adm-btn" style="margin-top:12px;background:var(--panel);border:1px solid var(--border);color:var(--text)" title="Pick 10 players of similar Solo Queue rank and output bot_add lines">🎲 Random balanced lineup (10)</button>
          <textarea id="sq-randout" class="adm-in" rows="3" readonly placeholder="bot_add lines appear here…" style="margin-top:6px;font-family:monospace;font-size:11px;line-height:1.5" hidden></textarea>
          <div id="sq-randmsg" class="muted" style="font-size:11px;margin-top:4px"></div>
        </div>
        <div>
          <h3 class="rec-group" style="margin-top:0">Recorded Solo Games</h3>
          <div id="sq-list" class="adm-list"><p class="muted">Loading…</p></div>
        </div>
      </div>
    </div>
    <div class="adm-shuffle" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>Amateur Team Shuffler</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Shuffles all <strong>${amateurShufflePool().length}</strong> non-pro players (everyone except the ${DATA.teams.filter(t=>!t.provisional).length} ranked pro teams, incl. solo-queue-only players) into teams of 5. Each team gets 1 IGL + 1 Awper first (scarce roles spread as far as they go), then fills by shared country/region. Nothing is saved — this is a scratch tool.</p>
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
    </div>
    <div class="adm-veto" style="margin-top:26px">
      <h2 class="section-title"><span class="accent-bar"></span>Map Veto Simulator</h2>
      <p class="muted" style="font-size:12px;margin:-4px 0 14px">A real CS-style veto driven by each team's per-map win rate. Teams ban the opponent's strong maps (but never their own best), pick their best, and leave a decider. Split is excluded (custom 3rd-place map only).</p>
      <div class="veto-controls">
        ${(()=>{const mk=list=>list.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>`<option value="${t.slug}">${esc(t.name)}</option>`).join("");
          const adhoc=DATA.adhocMapTeams||[], nations=DATA.nationMapTeams||[], quals=DATA.qualifierMapTeams||[];
          const opts=`<optgroup label="Pro Teams">${mk(DATA.teams)}</optgroup>`
            +(nations.length?`<optgroup label="Nation Teams">${mk(nations)}</optgroup>`:'')
            +(quals.length?`<optgroup label="Nation Qualifiers">${mk(quals)}</optgroup>`:'')
            +(adhoc.length?`<optgroup label="Tournament Teams">${mk(adhoc)}</optgroup>`:'');
          return `<select id="veto-a" class="adm-in">${opts}</select>
          <span class="veto-vs">vs</span>
          <select id="veto-b" class="adm-in">${opts}</select>
          <select id="veto-fmt" class="adm-in"><option value="bo1">Best of 1</option><option value="bo3" selected>Best of 3</option><option value="bo5">Best of 5 (final)</option></select>
          <button id="veto-go" class="adm-btn" style="max-width:180px">Simulate veto</button>`;})()}
      </div>
      <div id="veto-out"></div>
    </div>`;

  setupLivePanel();
  $("#adm-publish").onclick = async ()=>{
    const btn=$("#adm-publish"), msg=$("#adm-pubmsg");
    btn.disabled=true; const orig=btn.textContent; btn.textContent="Publishing…"; msg.textContent="";
    const r = await apiPost("/api/publish",{});
    btn.disabled=false; btn.textContent=orig;
    msg.textContent = r.msg || (r.ok?"Published.":"Publish failed.");
    msg.style.color = r.ok ? "var(--good)" : "var(--accent2, #ff6b6b)";
  };
  const prizeSub=()=>{ const v=parseUSD($("#adm-prize").value); $("#adm-prize-sub").textContent = v ? (subTierFor($("#adm-tier").value, v) ? '· '+subTierFor($("#adm-tier").value, v) : '· '+fmtUSD(v)) : ''; };
  $("#adm-prize").oninput = prizeSub; $("#adm-tier").addEventListener("change", prizeSub);
  $("#adm-create").onclick = async ()=>{
    const name = $("#adm-name").value.trim();
    if(!name){ $("#adm-msg").textContent = "Enter a name."; return; }
    $("#adm-msg").textContent = "Creating…";
    const r = await apiPost("/api/create",{name, tier:$("#adm-tier").value, date:$("#adm-date").value, prizePool:parseUSD($("#adm-prize").value)||null});
    if(r.ok){ await reloadData(); adminEditing = r.slug; renderAdmin(); }
    else $("#adm-msg").textContent = "Error: "+(r.error||"failed");
  };
  app.querySelectorAll("[data-edit]").forEach(a=>a.onclick=e=>{e.preventDefault();adminEditing=a.dataset.edit;openEditor(a.dataset.edit);});
  app.querySelectorAll("[data-wrap]").forEach(b=>b.onclick=()=>{
    const box=app.querySelector(`[data-wrapbox="${b.dataset.wrap}"]`), open=!!box.innerHTML;
    app.querySelectorAll("[data-wrapbox]").forEach(x=>x.innerHTML="");          // one wrap-up panel at a time
    if(!open){ box.innerHTML='<div class="loading" style="padding:8px">Loading…</div>'; setupWrapUp(b.dataset.wrap, async ()=>{ await reloadData(); renderAdmin(); }, box); }
  });
  app.querySelectorAll("[data-del]").forEach(b=>b.onclick=async e=>{
    e.preventDefault();
    if(!confirm("Delete this tournament?")) return;
    await apiPost("/api/delete",{slug:b.dataset.del}); adminEditing=null; await reloadData(); renderAdmin();
  });
  app.querySelectorAll("[data-predlock]").forEach(b=>b.onclick=async e=>{
    e.preventDefault();
    const locking = b.dataset.locked!=="1";
    if(locking && !confirm("Start this tournament and lock predictions?\n\nNo new predictions can be made and existing ones can't be edited. You can reopen them later. Remember to Publish afterwards to apply it to the live site.")) return;
    if(!locking && !confirm("Reopen predictions for this tournament? People will be able to enter and edit predictions again.")) return;
    b.disabled=true; b.textContent = locking?"Locking…":"Reopening…";
    await apiPost("/api/predlock",{slug:b.dataset.predlock, locked:locking});
    await reloadData(); renderAdmin();
  });
  app.querySelectorAll("[data-complete]").forEach(b=>b.onclick=async e=>{
    e.preventDefault();
    if(!confirm("Mark this tournament completed?\n\nThe rosters that played will be frozen (they won't change if a player later switches teams), and it moves to the Completed section. Remember to Publish afterwards.")) return;
    b.disabled=true; b.textContent="Completing…";
    await apiPost("/api/complete",{slug:b.dataset.complete, completed:true});
    await reloadData(); renderAdmin();
  });
  app.querySelectorAll("[data-reopen]").forEach(b=>b.onclick=async e=>{
    e.preventDefault();
    b.disabled=true; b.textContent="Reopening…";
    await apiPost("/api/complete",{slug:b.dataset.reopen, completed:false});
    await reloadData(); renderAdmin();
  });
  setupNewsAdmin();
  setupSoloAdmin();
  setupRosterAdmin();
  setupGenderFix(); _gfDone = null;
  setupPrizeFix(); _pfDone = null;
  setupShuffler();
  setupMapVeto();
  if(adminEditing) openEditor(adminEditing);
}

// ---- map veto simulator (admin) ----
const VETO_MAPS = ["Mirage","Dust2","Inferno","Cache","Ancient","Vertigo","Anubis"];
const VETO_IMG = {Mirage:"mirage.jpg",Dust2:"dust2.jpg",Inferno:"inferno.jpg",Cache:"cache.jpg",Ancient:"ancient.jpg",Tuscan:"tuscan.jpg",Vertigo:"vertigo.jpeg",Anubis:"anubis.jpeg"};
// The team that picks a map doesn't choose sides — the opponent picks which side
// to start on. We have no CT/T split in the stats, so the choice is deterministic
// (stable per matchup) with a light lean toward each map's stronger starting side.
const MAP_SIDE_LEAN = {Mirage:"CT",Dust2:"T",Inferno:"CT",Cache:"CT",Ancient:"CT",Tuscan:"CT",Vertigo:"CT",Anubis:"T"};
function vetoHash(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function vetoSide(chooser, map, A, B){
  const lean = MAP_SIDE_LEAN[map] || "CT";
  const follow = (vetoHash((chooser.slug||chooser.name)+"|"+map+"|"+A.slug+"|"+B.slug) % 100) < 65;
  return follow ? lean : (lean==="CT" ? "T" : "CT");
}
function setupMapVeto(){
  const go=$("#veto-go"); if(!go) return;
  const teams=DATA.teams.concat(DATA.adhocMapTeams||[]).concat(DATA.nationMapTeams||[]).concat(DATA.qualifierMapTeams||[]); const bySlug={}; teams.forEach(t=>bySlug[t.slug]=t);
  // default B to a different team than A
  const b=$("#veto-b"); if(b && b.options.length>1) b.selectedIndex=1;
  go.onclick=()=>{
    const A=bySlug[$("#veto-a").value], B=bySlug[$("#veto-b").value], fmt=$("#veto-fmt").value;
    const out=$("#veto-out");
    if(!A||!B){ out.innerHTML='<p class="muted">Pick two teams.</p>'; return; }
    if(A===B){ out.innerHTML='<p class="muted" style="color:var(--accent2,#ff6b6b)">Pick two different teams.</p>'; return; }
    renderVetoResult(A,B,fmt,simulateVeto(A,B,fmt));
  };
}
function simulateVeto(A,B,fmt){
  const wr=(t,m)=> (t.mapStats&&t.mapStats[m] ? t.mapStats[m].wr : 0.5);
  const isBest=(t,m)=> (t.bestMaps||[]).includes(m);
  let remaining=VETO_MAPS.slice(); const steps=[];
  const seq = fmt==="bo1"
    ? [[A,"ban"],[B,"ban"],[A,"ban"],[B,"ban"],[A,"ban"],[B,"ban"]]
    : fmt==="bo5"
    ? [[A,"ban"],[B,"ban"],[A,"pick"],[B,"pick"],[A,"pick"],[B,"pick"]]
    : [[A,"ban"],[B,"ban"],[A,"pick"],[B,"pick"],[A,"ban"],[B,"ban"]];
  for(const [team,action] of seq){
    const opp = team===A?B:A; let map, reason;
    if(action==="ban"){
      let cands=remaining.filter(m=>!isBest(team,m));      // never ban your own best…
      if(!cands.length) cands=remaining.slice();            // …unless the field is all your best maps
      cands.sort((x,y)=> wr(opp,y)-wr(opp,x) || wr(team,x)-wr(team,y));
      map=cands[0];
      if(isBest(opp,map)) reason=`removes ${opp.name}'s best map (${pct(wr(opp,map))})`;
      else if(wr(opp,map)>=0.55) reason=`${opp.name} are strong here (${pct(wr(opp,map))})`;
      else reason=`${team.name} are weakest here (${pct(wr(team,map))})`;
    } else {
      let cands=remaining.slice().sort((x,y)=> wr(team,y)-wr(team,x));
      map=cands[0];
      reason = isBest(team,map) ? `${team.name}'s best map (${pct(wr(team,map))})` : `${team.name}'s strongest left (${pct(wr(team,map))})`;
    }
    remaining=remaining.filter(m=>m!==map);
    const step={team:team.name, side:team===A?"a":"b", action, map, reason, wrA:wr(A,map), wrB:wr(B,map)};
    if(action==="pick"){                                  // opponent of the picker elects the side
      const chooser=opp, ss=vetoSide(chooser,map,A,B);
      step.sideTeam=chooser.name; step.sideAB=chooser===A?"a":"b"; step.startSide=ss;
      step.sideNote=`${chooser.name} start ${ss} (${team.name}'s pick, so ${chooser.name} choose side)`;
    }
    steps.push(step);
  }
  const decider=remaining[0];
  const dstep={team:"", side:"d", action:"decider", map:decider, reason:"the map left after all vetoes", wrA:wr(A,decider), wrB:wr(B,decider)};
  {                                                        // decider: sides settled by a coin flip
    const kwin=(vetoHash(A.slug+"|"+B.slug+"|"+decider)%2===0)?A:B, ss=vetoSide(kwin,decider,A,B);
    dstep.sideTeam=kwin.name; dstep.sideAB=kwin===A?"a":"b"; dstep.startSide=ss; dstep.coin=true;
    dstep.sideNote=`${kwin.name} win the coin flip and start ${ss}`;
  }
  steps.push(dstep);
  return {steps, decider, played: fmt==="bo1" ? [decider] : steps.filter(s=>s.action==="pick").map(s=>s.map).concat(decider)};
}
function vetoMapImg(m){ return `<img class="vt-img" src="assets/maps/${VETO_IMG[m]}" alt="${esc(m)}">`; }
// A team as BPL Bots' veto sees it (lib/bpl.js + runVeto in its ui/app.js): map stats looked up by
// name, a pro team's own over the qualifier/nation/tournament lists, best and worst maps re-ranked
// within the pool. With no stats every map counts as 50%, like the app.
function vetoTeamFor(name){
  const key=String(name||'').toLowerCase();
  let mt=null;
  for(const list of [DATA.qualifierMapTeams, DATA.nationMapTeams, DATA.adhocMapTeams, DATA.teams])
    for(const t of list||[]) if(t.mapStats && t.name.toLowerCase()===key) mt=t;
  if(!mt) return {name, slug:'x-'+key.replace(/[^a-z0-9]+/g,'-'), mapStats:null, bestMaps:[], worstMaps:[]};
  const wr=m=>mt.mapStats[m]?mt.mapStats[m].wr:0.5;
  const order=VETO_MAPS.slice().sort((x,y)=>wr(y)-wr(x)||(x<y?-1:1));
  return {name, slug:mt.slug, mapStats:mt.mapStats, bestMaps:order.slice(0,2), worstMaps:[order[order.length-1],order[order.length-2]]};
}
// The match page's Map Veto: the veto BPL Bots launched the match from (stats.veto, sides as the
// match's team a/b), or for an upcoming match the one the same simulation gives on today's win rates.
function matchVetoHtml(match){
  let v=match.stats&&match.stats.veto, projected=false;
  if(!v||!(v.steps||[]).length){
    if(match.w===1||match.w===2||!match.a||!match.b||/^(tbd|bye)$/i.test(match.a)||/^(tbd|bye)$/i.test(match.b)) return '';
    const fmt='bo'+(match.bo===5?5:match.bo===3?3:1);
    v={fmt, steps:simulateVeto(vetoTeamFor(match.a), vetoTeamFor(match.b), fmt).steps};
    projected=true;
  }
  const nm=k=>k==='a'?match.a:k==='b'?match.b:'';
  const flip=x=>x==='CT'?'T':'CT';
  const maps=(match.stats&&match.stats.maps)||[];
  const playedOrder=v.steps.filter(s=>v.fmt==='bo1'?s.action==='decider':s.action!=='ban').map(s=>s.map);
  const rows=v.steps.map((s,i)=>{
    const badge=s.action==='ban'?'<span class="vt-badge ban">BAN</span>':s.action==='pick'?'<span class="vt-badge pick">PICK</span>':'<span class="vt-badge dec">DECIDER</span>';
    const line=s.action==='decider' ? `${badge} <b>${esc(s.map)}</b> was left over`
      : `${badge} <span class="mv-team ${s.side}">${esc(nm(s.side))}</span> ${s.action==='ban'?'removed':'picked'} <b>${esc(s.map)}</b>`;
    let extra='';
    const k=playedOrder.indexOf(s.map);
    if(k>=0){
      const mp=maps.find(x=>normKey(x.map)===normKey(s.map));
      const done=mp&&mp.scoreA!=null&&mp.scoreB!=null&&mp.scoreA!==mp.scoreB;
      const res=done ? (()=>{ const aw=mp.scoreA>mp.scoreB, hi=Math.max(mp.scoreA,mp.scoreB), lo=Math.min(mp.scoreA,mp.scoreB);
          return ` · <span class="mv-team ${aw?'a':'b'}">${esc(aw?match.a:match.b)}</span> won <b class="mono">${hi}–${lo}</b>`; })()
        : (match.w===1||match.w===2) ? ' · <span class="muted">not needed</span>' : '';
      const side=s.startSide&&s.sideAB ? ` · ${esc(nm(s.sideAB))} start ${s.startSide}${s.coin?' (coin flip)':''}` : '';
      extra=`<div class="mv-played">Map ${k+1}${res}${side}</div>`;
    }
    return `<div class="mv-step ${s.action}"><span class="mv-n">${i+1}</span>${vetoMapImg(s.map)}
      <div class="mv-body"><div class="mv-line">${line}</div>${s.reason?`<div class="mv-reason">${esc(s.reason)}</div>`:''}${extra}</div>
      <div class="mv-wr"><span class="a">${s.wrA!=null?pct(s.wrA):''}</span><span class="b">${s.wrB!=null?pct(s.wrB):''}</span></div></div>`;
  }).join('');
  const note = projected ? 'projected from today’s map win rates' : v.rebuilt ? 'BPL Bots’ veto, rebuilt from the win rates before the match' : 'as BPL Bots played it';
  return `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Map Veto</h2>
    <div class="mv-box">
      <div class="mv-head"><span>${v.fmt.toUpperCase()} <span class="mv-note">· ${note}</span></span>
        <span class="mv-legend" title="Each team's win rate on that map on BPL${projected?'':', when the match was played'}">map win rate <span class="a">${esc(match.a)}</span><span class="b">${esc(match.b)}</span></span></div>
      ${rows}
    </div>`;
}
// For each played map, copyable bot_add lines: the CT team as bot_add_ct "<tag> name",
// the T team as plain bot_add name. Needs a real roster (pro teams have one; ad-hoc/nation
// map teams do not), so those show a note instead.
// teams whose in-game bots carry no tag prefix (their bot names are just the player name)
const VETO_NOTAG = new Set(["beehyve","eiromancers"]);
// bot name for a player: "<tag> name" when the team uses a tag, else just the name; quoted if it has a space
function vetoBotName(t,p){
  const nm = (t.tag && !VETO_NOTAG.has(t.slug) ? t.tag+" " : "") + p.name;
  return /\s/.test(nm) ? `"${nm}"` : nm;
}
function vetoServerSetup(A,B,res){
  const stepByMap={}; res.steps.forEach(s=>{ if(s.action==="pick"||s.action==="decider") stepByMap[s.map]=s; });
  // resolve a team's roster: pro/provisional teams carry one; ad-hoc/amateur teams (no roster
  // field) are matched by the pro-pool players whose current team is this team's name.
  const byTeamName={};
  [...(DATA.players.pro||[]),...(DATA.players.amateur||[]),...(DATA.players.solo||[])]
    .forEach(p=>{ const k=normKey(p.team||""); if(k) (byTeamName[k]=byTeamName[k]||[]).push(p); });
  const rosterOf=t=>{
    if(t.roster && t.roster.length) return t.roster;
    const r=byTeamName[normKey(t.name)];
    return r ? r.slice().sort((a,b)=>(b.rating||0)-(a.rating||0)) : null;
  };
  const line=(t,roster,ct)=>roster.map(p=>`${ct?"bot_add_ct":"bot_add"} ${vetoBotName(t,p)};`).join(" ");
  const blocks=res.played.map(m=>{
    const s=stepByMap[m]; if(!s) return "";
    const sideTeamObj=s.sideAB==="a"?A:B, otherObj=s.sideAB==="a"?B:A;
    const ctT = s.startSide==="CT"?sideTeamObj:otherObj;
    const tT  = s.startSide==="CT"?otherObj:sideTeamObj;
    const ctR=rosterOf(ctT), tR=rosterOf(tT);
    if(!ctR||!tR){
      const missing=!ctR?ctT:tT;
      return `<div class="vt-ba"><div class="vt-ba-head">${vetoMapImg(m)}<b>${esc(m)}</b>
        <span class="vt-ba-note">no roster on file for ${esc(missing.name)}</span></div></div>`;
    }
    const text=`${line(ctT,ctR,true)}\n${line(tT,tR,false)}`;
    return `<div class="vt-ba">
      <div class="vt-ba-head">${vetoMapImg(m)}<b>${esc(m)}</b>
        <span class="vt-ba-sides"><span class="ct">${esc(ctT.name)} · CT</span> <span class="t">${esc(tT.name)} · T</span></span>
        <button class="vt-ba-copy" data-copy type="button">Copy</button></div>
      <textarea class="vt-ba-text" readonly rows="2">${esc(text)}</textarea>
    </div>`;
  }).join("");
  return blocks ? `<h3 class="rec-group" style="margin-top:18px">Server setup · bot_add</h3>
    <p class="muted" style="font-size:11px;margin:-4px 0 10px">Per played map: CT team on line 1, T team on line 2. Copy into the console.</p>
    <div class="vt-ba-list">${blocks}</div>` : "";
}
function renderVetoResult(A,B,fmt,res){
  const out=$("#veto-out"); if(!out) return;
  const wr=(t,m)=> (t.mapStats&&t.mapStats[m]?t.mapStats[m].wr:0.5);
  const isBest=(t,m)=>(t.bestMaps||[]).includes(m), isWorst=(t,m)=>(t.worstMaps||[]).includes(m);
  const cell=(t,m)=>{ const w=wr(t,m); const cls=isBest(t,m)?"vt-best":isWorst(t,m)?"vt-worst":"";
    const st=t.mapStats&&t.mapStats[m]||{}; const g=st.g||0;
    const mark = g ? '' : (st.est ? '~' : '*');
    const title = g ? g+' maps played'
      : st.est ? ('est. from '+st.estN+' player'+(st.estN===1?'':'s')+' ('+st.estMaps+' map'+(st.estMaps===1?'':'s')+')')
      : 'projected';
    return `<td class="mono ${cls}" title="${title}">${pct(w)}${mark}</td>`; };
  const matrix=`<div class="tablewrap" style="max-width:560px"><table class="data vt-matrix">
    <thead><tr><th class="no-sort">Map</th><th class="no-sort">${esc(A.name)}</th><th class="no-sort">${esc(B.name)}</th></tr></thead>
    <tbody>${VETO_MAPS.map(m=>`<tr><td class="name-cell">${vetoMapImg(m)}<span class="vt-mname">${esc(m)}</span></td>${cell(A,m)}${cell(B,m)}</tr>`).join("")}</tbody></table>
    <div class="muted" style="font-size:11px;margin-top:4px">Green = best map · red = worst · <b>~</b> = estimated from the players' own map form · <b>*</b> = projected (no data yet).</div></div>`;
  const stepRow=s=>{
    const badge = s.action==="ban"?`<span class="vt-badge ban">BAN</span>`
      : s.action==="pick"?`<span class="vt-badge pick">PICK</span>`
      : `<span class="vt-badge dec">DECIDER</span>`;
    const who = s.team?`<span class="vt-team ${s.side}">${esc(s.team)}</span>`:`<span class="vt-team d">Left over</span>`;
    const other = s.sideAB==="a"?"b":"a";
    const otherName = s.sideAB==="a"?B.name:A.name;
    const sideHtml = s.sideNote
      ? `<div class="vt-side"><span class="vt-sd ${s.sideAB}">${esc(s.sideTeam)} <b>${s.startSide}</b></span>
         <span class="vt-sd ${other}">${esc(otherName)} <b>${s.startSide==="CT"?"T":"CT"}</b></span>
         <span class="vt-sd-note">${s.coin?"🪙 coin flip":`${esc(s.sideTeam)} choose side`}</span></div>`
      : '';
    return `<div class="vt-step ${s.action}">
      ${vetoMapImg(s.map)}
      <div class="vt-body"><div class="vt-line">${badge} ${who} — <b>${esc(s.map)}</b></div>
        <div class="vt-reason">${esc(s.reason)}</div>${sideHtml}</div>
      <div class="vt-wr"><span class="a">${esc(A.name.slice(0,10))} ${pct(s.wrA)}</span><span class="b">${esc(B.name.slice(0,10))} ${pct(s.wrB)}</span></div>
    </div>`; };
  out.innerHTML=`<div class="veto-grid">
    <div><h3 class="rec-group" style="margin-top:0">Veto sequence · ${fmt.toUpperCase()}</h3>
      <div class="vt-steps">${res.steps.map(stepRow).join("")}</div>
      <div class="vt-final">${fmt==="bo1"?"Map played:":"Maps played:"} ${res.played.map(m=>`<span class="vt-chip">${vetoMapImg(m)}${esc(m)}</span>`).join("")}</div>
    </div>
    <div><h3 class="rec-group" style="margin-top:0">Win-rate by map</h3>${matrix}</div>
  </div>` + vetoServerSetup(A,B,res);
  out.querySelectorAll("[data-copy]").forEach(btn=>btn.onclick=()=>{
    const ta=btn.closest(".vt-ba")&&btn.closest(".vt-ba").querySelector(".vt-ba-text"); if(!ta) return;
    ta.focus(); ta.select();
    const done=()=>{ btn.textContent="Copied!"; setTimeout(()=>{btn.textContent="Copy";},1200); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done).catch(()=>{ try{document.execCommand("copy");done();}catch(e){} });
    else { try{document.execCommand("copy");done();}catch(e){} }
  });
}

// the shuffler works on AMATEURS only: everyone (tournament pool + solo-queue-only players)
// except the players signed to one of the ranked pro teams.
function amateurShufflePool(){
  const proTeams = new Set(DATA.teams.filter(t=>!t.provisional).map(t=>normKey(t.name)));
  const seen = new Set(), pool = [];
  DATA.players.pro.concat(DATA.players.solo||[]).forEach(p=>{
    const k = normKey(p.name); if(seen.has(k)) return; seen.add(k);
    if(p.iso === "neutral") return;                        // Land of Make Believe (novelty team)
    if(p.team && proTeams.has(normKey(p.team))) return;    // drop players on a pro team
    pool.push(p);
  });
  return pool;
}
function setupShuffler(){
  const go = $("#shf-go"); if(!go) return;
  const parseLocks = ()=>{
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const known = {}; amateurShufflePool().forEach(p=>known[norm(p.name)]=p.name);
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
    lastShuffle = generateTeams(amateurShufflePool(), groups, $("#shf-country").checked);
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
        <span class="shf-rat">${p.points!=null?p.points+' pts':'—'}</span>
      </div>`).join("")}
    </div>`).join("")}</div>`;
}
function isoForCountry(c){ const m={USA:"us",Singapore:"sg",Malaysia:"my",Japan:"jp",Philippines:"ph",Australia:"au","Hong Kong":"hk",Canada:"ca",Brazil:"br",Taiwan:"tw",Indonesia:"id",Thailand:"th",Korea:"kr","South Korea":"kr",China:"cn",Vietnam:"vn"}; return m[c]||""; }

// ---- amateur team shuffler (scratch tool; client-side only) ----
const SHF_REGION = {
  sg:"SEA",my:"SEA",ph:"SEA",id:"SEA",th:"SEA",vn:"SEA",
  jp:"East Asia",kr:"East Asia",tw:"East Asia",hk:"East Asia",cn:"East Asia",
  au:"Oceania",nz:"Oceania", us:"North America",ca:"North America", br:"South America",
  gb:"Europe",fr:"Europe",de:"Europe",nl:"Europe",be:"Europe",at:"Europe",pl:"Europe",fi:"Europe",it:"Europe",is:"Europe",se:"Europe",ua:"Europe",ba:"Europe",cz:"Europe",gr:"Europe",lt:"Europe",no:"Europe",
  kz:"Central Asia",
};
const shfRegion = iso => SHF_REGION[iso] || "";
// Region for a player. Land of Make Believe (flagless "neutral") is its own region, not "Other".
function playerRegion(p){
  if(p && (p.nat==="Land of Make Believe")) return "Land of Make Believe";
  return SHF_REGION[(p&&p.iso)||""] || "Other";
}
function shfShuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
let lastShuffle = null;

function generateTeams(players, lockedGroups, groupByCountry=true){
  const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const byKey = {}; players.forEach(p=>{ byKey[norm(p.name)] = p; });
  const meta = p => {
    const role = (p.role||"").toLowerCase();
    const vssmb = norm(p.name)==="vssmb";
    return { p, name:p.name, rating:(p.rating==null?-1:p.rating), points:(p.ratingPoints==null?null:p.ratingPoints),
             iso:p.iso||"", country:p.nat||"",
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
      return { name:m.name, slug:m.p.slug, role, rating:m.rating, points:m.points, iso:m.iso, country:m.country };
    }).sort((a,b)=> (a.role.startsWith("IGL")?0: a.role==="Awper"?1: a.role==="Fill"?3:2) - (b.role.startsWith("IGL")?0: b.role==="Awper"?1: b.role==="Fill"?3:2));
    return { n:i+1, players:rows, country:dominantCountry(t),
             missingAwp: !t.members.some(m=>m.isAwp), missingIGL: !iglPick };
  });
}

// ---- news/articles admin (write + publish articles) ----
// ---------------- Roster Tools (admin) ----------------
const RS_TABS = [["transfer","Transfer"],["add","Add player"],["edit","Edit player"],["rename","Rename"],["promote","Promote to pro"],["disband","Disband"]];
let rosterTab = "transfer", _rsMeta = null, _rsDone = null, _rsLogo = null;
function rsAllPlayers(){ return [...(DATA.players.pro||[]),...(DATA.players.amateur||[]),...(DATA.players.solo||[])]; }
function rsFindPlayer(name){ const k=normKey(name); return k ? rsAllPlayers().find(p=>normKey(p.name)===k) : null; }
function rsTeamNames(){
  // team pages + every amateur/ad-hoc team name in use (sheet teams, live-event teams)
  const names = new Map();
  (DATA.teams||[]).forEach(t=>names.set(normKey(t.name), t.name));
  rsAllPlayers().forEach(p=>{ if(p.team && !names.has(normKey(p.team))) names.set(normKey(p.team), p.team); });
  (DATA.tournaments||[]).filter(t=>!t.champion).forEach(t=>(t.attending||[]).forEach(r=>{ if(r.team && !names.has(normKey(r.team))) names.set(normKey(r.team), r.team); }));
  return [...names.values()].sort((a,b)=>a.localeCompare(b));
}
function rsSuggestRoster(team){
  // latest event line-up under this name, else the players currently on it
  const k = normKey(team); if(!k) return [];
  const evs = [...(DATA.tournaments||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  for(const t of evs){ const row=(t.attending||[]).find(r=>normKey(r.team)===k); if(row) return row.players.map(p=>p.name); }
  return rsAllPlayers().filter(p=>normKey(p.team)===k).map(p=>p.name);
}
// the league calendar runs ahead of real time: default to the later of local today and the
// latest in-world date already on the site (articles, transfers)
function rsLeagueToday(){
  const d=new Date(), local=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return [local, ...(DATA.articles||[]).map(a=>a.date||""), ...(DATA.transfers||[]).map(t=>t.date||"")].reduce((a,b)=>b>a?b:a, "");
}
function rsField(label, html){ return `<label class="adm-l">${label}</label>${html}`; }
function rsInput(id, list, ph="", val=""){ return `<input id="${id}" class="adm-in"${list?` list="${list}"`:''} placeholder="${esc(ph)}" value="${esc(val)}" autocomplete="off">`; }
function rsSelect(id, opts, blank){ return `<select id="${id}" class="adm-in">${blank!=null?`<option value="">${esc(blank)}</option>`:''}${opts.map(o=>`<option>${esc(o)}</option>`).join("")}</select>`; }
function rsFormHtml(tab){
  const m=_rsMeta||{countries:[],roles:[]}, today=rsLeagueToday();
  const hint = id=>`<div id="${id}" class="rs-hint"></div>`;
  if(tab==="transfer") return rsField("Player", rsInput("rs-player","rs-dl-players","e.g. Sadgeboi")) + hint("rs-player-hint")
    + rsField("Move to", rsInput("rs-to","rs-dl-teams","a team, or Free agent"))
    + rsField("Transfer fee (USD)", `<input id="rs-fee" class="adm-in" inputmode="numeric" placeholder="$0">`) + hint("rs-fee-hint")
    + rsField("Date", `<input id="rs-date" class="adm-in" type="date" value="${today}">`) + `<label class="rs-check"><input id="rs-live" type="checkbox" checked> Also update running events' line-ups (only teams that haven't played there yet)</label>`;
  if(tab==="add") return rsField("Name", rsInput("rs-name","","exact in-game name"))
    + `<div style="display:flex;gap:8px"><div style="flex:1">${rsField("Country", rsSelect("rs-country", m.countries, "pick one"))}</div><div style="flex:1">${rsField("Gender", rsSelect("rs-gender", ["F","M","NB"], "pick one"))}</div></div>`
    + rsField("Role", rsSelect("rs-role", m.roles, "pick one")) + rsField("Team (optional)", rsInput("rs-team","rs-dl-teams","Free agent")) + `<label class="rs-check"><input id="rs-live" type="checkbox" checked> Also update running events' line-ups (only teams that haven't played there yet)</label>`;
  if(tab==="edit") return rsField("Player", rsInput("rs-player","rs-dl-players","e.g. miorine")) + hint("rs-player-hint")
    + `<p class="muted" style="font-size:11px;margin:6px 0 0">Leave a field on "no change" to keep it.</p>`
    + rsField("Role", rsSelect("rs-role", m.roles, "no change")) + rsField("Country", rsSelect("rs-country", m.countries, "no change"))
    + rsField("Gender", rsSelect("rs-gender", ["F","M","NB"], "no change"))
    + rsField("Sub-role (riflers)", rsSelect("rs-subrole", ["entry","lurker","anchor","support","auto"], "no change"))
    + `<p class="muted" style="font-size:11px;margin:4px 0 0">A sub-role picked here is pinned: transfers won't move it. “auto” lets the build choose again.</p>`;
  if(tab==="rename") return rsField("What", rsSelect("rs-kind", ["Player","Team"]))
    + rsField("Current name", rsInput("rs-old","rs-dl-players","")) + rsField("New name", rsInput("rs-new","","new name"));
  if(tab==="promote") return rsField("Team", rsInput("rs-pteam","rs-dl-teams","e.g. the Challengers champion"))
    + `<div style="display:flex;gap:8px"><div style="flex:1">${rsField("In-game tag", rsInput("rs-tag","","e.g. PD"))}</div><div style="flex:2">${rsField("Origin (optional)", rsInput("rs-origin","","e.g. BPL Challengers Stage 2026"))}</div></div>`
    + rsField("Roster (5)", [0,1,2,3,4].map(i=>rsInput("rs-p"+i,"rs-dl-players","player "+(i+1))).join(""))
    + rsField("Logo", `<input id="rs-logo" type="file" accept="image/*" class="adm-in"><div id="rs-logo-prev" class="rs-logo-prev"></div>`)
    + `<label class="rs-check"><input id="rs-prov" type="checkbox"> Provisional (team page, but not ranked yet)</label>`;
  if(tab==="disband") return rsField("Team", rsInput("rs-dteam","rs-dl-teams","team to disband")) + hint("rs-dteam-hint")
    + `<p class="muted" style="font-size:11px;margin:6px 0 0">Everyone currently on the team becomes a free agent. Past event rosters and the team page (if any) stay.</p>`;
  return "";
}
function rsCollect(tab){
  const v=id=>{ const e=$("#"+id); return e?e.value.trim():""; };
  const live = $("#rs-live") ? $("#rs-live").checked : true;
  if(tab==="transfer") return {action:"transfer", player:v("rs-player"), to:v("rs-to")||"Free agent", date:v("rs-date"), fee:parseUSD(v("rs-fee")), liveSync:live};
  if(tab==="add") return {action:"add", name:v("rs-name"), country:v("rs-country"), gender:v("rs-gender"), role:v("rs-role"), team:v("rs-team"), liveSync:live};
  if(tab==="edit") return {action:"edit", player:v("rs-player"), role:v("rs-role"), country:v("rs-country"), gender:v("rs-gender"), subRole:v("rs-subrole")};
  if(tab==="rename") return {action: v("rs-kind")==="Team"?"rename_team":"rename_player", old:v("rs-old"), new:v("rs-new")};
  if(tab==="promote") return {action:"promote", name:v("rs-pteam"), tag:v("rs-tag"), origin:v("rs-origin"),
    players:[0,1,2,3,4].map(i=>v("rs-p"+i)).filter(Boolean), provisional:$("#rs-prov").checked, logo:_rsLogo};
  if(tab==="disband") return {action:"disband", team:v("rs-dteam")};
}
function rsPreviewHtml(res, applied){
  const items=(res.changes||[]).map(c=>`<li class="${c.startsWith("\u26a0")?'rs-warn':''}">${esc(c)}</li>`).join("");
  return `<div class="rs-box ${applied?'done':''}">
    <div class="rs-box-t">${applied?'\u2713 Done: saved and rebuilt':'Preview: nothing saved yet'}</div>
    <ul class="rs-list">${items||'<li class="muted">No changes.</li>'}</ul>
    ${applied?'':`<div style="display:flex;gap:8px;margin-top:10px"><button id="rs-apply" class="adm-btn" style="margin:0">Apply changes</button>
      <button id="rs-cancel" class="adm-btn" style="margin:0;background:var(--panel);border:1px solid var(--border);color:var(--text)">Cancel</button></div>`}
  </div>`;
}
async function setupRosterAdmin(){
  const form=$("#rs-form"), prev=$("#rs-preview"); if(!form) return;
  if(!_rsMeta){ const r=await fetch("/api/roster/meta").then(r=>r.json()).catch(()=>null); _rsMeta = (r&&r.ok)?r:{countries:[],roles:[]}; }
  // shared autocomplete lists
  ["rs-dl-players","rs-dl-teams"].forEach(id=>{ const old=$("#"+id); if(old) old.remove(); });
  const mk=(id,vals)=>{ const dl=document.createElement("datalist"); dl.id=id; dl.innerHTML=vals.map(v=>`<option value="${esc(v)}">`).join(""); document.body.appendChild(dl); };
  mk("rs-dl-players", [...new Set(rsAllPlayers().map(p=>p.name))].sort((a,b)=>a.localeCompare(b)));
  mk("rs-dl-teams", ["Free agent", ...rsTeamNames()]);
  const draw=()=>{
    form.innerHTML = rsFormHtml(rosterTab) + `<button id="rs-preview-btn" class="adm-btn" style="margin-top:12px">Preview changes</button><div id="rs-msg" class="muted" style="font-size:12px;margin-top:8px"></div>`;
    _rsLogo = null;
    const ph=$("#rs-player"), hh=$("#rs-player-hint");
    if(ph&&hh) ph.oninput=()=>{ const p=rsFindPlayer(ph.value); hh.innerHTML = p ? `${flag(p.iso)} ${esc(p.name)} \u00b7 ${esc(p.team||"Free agent")} \u00b7 ${esc(p.role||"no role")} \u00b7 ${esc(p.nat||"no country")}` : ""; };
    // transfer fee: suggested from the player's market value; free agents and releases cost nothing;
    // the buying team's budget is shown, and the server refuses a fee it can't afford
    const fee=$("#rs-fee"), to=$("#rs-to"), fh=$("#rs-fee-hint");
    if(fee && ph && to){
      let touched=false;
      const feeHint=()=>{ const pl=rsFindPlayer(ph.value), tm=(DATA.teams||[]).find(t=>normKey(t.name)===normKey(to.value));
        const free=!!pl && !pl.team, release=!to.value || normKey(to.value)==="freeagent";
        fee.disabled = free || release;
        if(fee.disabled) fee.value=''; else if(!touched && !fee.value && pl && pl.marketValue) fee.value=pl.marketValue.toLocaleString('en-US');
        const f=parseUSD(fee.value); let h=[];
        if(pl && pl.marketValue) h.push(`Market value ${fmtUSD(pl.marketValue)}.`);
        if(free) h.push('Free agents join for free.'); else if(release && pl) h.push('Releases have no fee.');
        if(tm && tm.budget!=null && !fee.disabled) h.push(`${tm.name}'s budget: ${fmtUSD(tm.budget)}${f?` → ${fmtUSD(tm.budget-f)} after the fee`:''}.`);
        if(tm && f>tm.budget) h.push("They can't afford this.");
        fh.textContent=h.join(' '); fh.style.color = tm && f>tm.budget ? 'var(--accent2,#ff6b6b)' : ''; };
      fee.oninput=()=>{ touched=true; feeHint(); };
      const prevIn=ph.oninput;
      ph.oninput=()=>{ if(prevIn) prevIn(); touched=false; fee.value=''; feeHint(); };   // new player: fresh suggestion
      to.oninput=feeHint;
    }
    const kind=$("#rs-kind"), old=$("#rs-old"); if(kind&&old) kind.onchange=()=>old.setAttribute("list", kind.value==="Team"?"rs-dl-teams":"rs-dl-players");
    const pt=$("#rs-pteam"); if(pt) pt.onchange=()=>{ const r=rsSuggestRoster(pt.value); [0,1,2,3,4].forEach(i=>{ const e=$("#rs-p"+i); if(e && !e.value) e.value=r[i]||""; }); };
    const lg=$("#rs-logo"); if(lg) lg.onchange=()=>{ const f=lg.files[0]; if(!f){ _rsLogo=null; return; }
      const fr=new FileReader(); fr.onload=()=>{ _rsLogo=fr.result; $("#rs-logo-prev").innerHTML=`<img src="${_rsLogo}" alt="">`; }; fr.readAsDataURL(f); };
    const dt=$("#rs-dteam"), dh=$("#rs-dteam-hint");
    if(dt&&dh) dt.oninput=()=>{ const ms=rsAllPlayers().filter(p=>normKey(p.team)===normKey(dt.value)); dh.textContent = ms.length ? "Current players: "+ms.map(p=>p.name).join(", ") : ""; };
    $("#rs-preview-btn").onclick=async ()=>{
      const msg=$("#rs-msg"), body=rsCollect(rosterTab); msg.style.color=""; msg.textContent="Checking\u2026";
      const r=await apiPost("/api/roster", {...body, dryRun:true});
      if(!r.ok){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent=r.error||"Something went wrong."; prev.innerHTML=""; return; }
      msg.textContent=""; prev.innerHTML=rsPreviewHtml(r,false);
      $("#rs-cancel").onclick=()=>{ prev.innerHTML=""; };
      $("#rs-apply").onclick=async ()=>{
        $("#rs-apply").disabled=true; $("#rs-apply").textContent="Saving\u2026";
        const a=await apiPost("/api/roster", {...body, dryRun:false});
        if(!a.ok){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent=a.error||a.msg||"Failed."; $("#rs-apply").disabled=false; $("#rs-apply").textContent="Apply changes"; return; }
        _rsDone=a; await reloadData(); renderAdmin();
      };
    };
  };
  document.querySelectorAll("[data-rstab]").forEach(b=>b.onclick=()=>{ rosterTab=b.dataset.rstab;
    document.querySelectorAll("[data-rstab]").forEach(x=>x.classList.toggle("active", x===b)); prev.innerHTML=""; draw(); });
  draw();
  if(_rsDone){ prev.innerHTML=rsPreviewHtml(_rsDone,true); _rsDone=null; document.querySelector(".adm-roster").scrollIntoView({block:"start"}); }
}
// ---- auto news drafts (build/storylines.py writes them; the admin edits + publishes or discards) ----
async function loadDrafts(){
  const box=$("#art-drafts"); if(!box) return;
  const r=await fetch("/api/drafts").then(r=>r.json()).catch(()=>null);
  const ds=(r&&r.ok&&r.drafts)||[];
  if(!ds.length){ box.innerHTML=""; return; }
  box.innerHTML=`<h3 class="rec-group" style="margin-top:0">Drafts <span class="muted" style="font-size:11px">(${ds.length}) written automatically from what just happened; edit, then save to publish</span></h3>
    <div class="adm-list adm-list-scroll" style="margin-bottom:14px">${ds.slice().reverse().map(d=>`<div class="adm-trow draft-row">
      <span class="draft-kind">${esc(d.kind)}</span>
      <span class="adm-name" style="flex:1;min-width:0">${esc(d.title)}${d.note?`<div class="draft-note">${esc(d.note)}</div>`:''}</span>
      <button class="adm-btn draft-edit" data-dedit="${esc(d.id)}" style="margin:0;padding:3px 10px;font-size:11px">Edit</button>
      <button class="adm-del" data-ddel="${esc(d.id)}" title="Discard draft">\u2715</button></div>`).join("")}</div>`;
  box.querySelectorAll("[data-dedit]").forEach(b=>b.onclick=()=>{
    const d=ds.find(x=>x.id===b.dataset.dedit); if(!d) return;
    $("#art-slug").value=""; $("#art-title").value=d.title; $("#art-date").value=d.date||rsLeagueToday();
    $("#art-author").value="BPL Staff"; $("#art-body").value=d.body; $("#art-draft").value=d.id;
    $("#art-formtitle").textContent="Draft: "+d.title; $("#art-msg").textContent=d.note||"";
    $("#art-title").scrollIntoView({behavior:"smooth", block:"center"});
  });
  box.querySelectorAll("[data-ddel]").forEach(b=>b.onclick=async ()=>{
    if(!confirm("Discard this draft? It won't be written again.")) return;
    await apiPost("/api/draft/delete",{id:b.dataset.ddel}); loadDrafts();
  });
}
// [[ autocomplete for the article editor: players, teams and events
function linkTargets(){
  const out=[], seen={};
  const add=(name,kind,sub)=>{ const k=normKey(name); if(!k) return; (seen[k]=seen[k]||[]).push(kind); out.push({name,kind,sub,k}); };
  (DATA.teams||[]).forEach(t=>add(t.name,"team", t.provisional?"provisional":(t.rank?"#"+t.rank+" in BPL":"")));
  [...(DATA.players.pro||[]),...(DATA.players.solo||[])].forEach(p=>add(p.name,"player", p.team?p.team:"free agent"));
  (DATA.tournaments||[]).forEach(t=>add(t.name,"event", t.date||"event"));
  out.forEach(o=>o.ambiguous=seen[o.k].length>1);
  return out;
}
function setupLinkAutocomplete(ta, box){
  if(!ta||!box) return;
  let targets=null, items=[], sel=0, q=null;
  const close=()=>{ box.hidden=true; q=null; };
  const query=()=>{ const pos=ta.selectionStart, before=ta.value.slice(0,pos);
    const m=before.match(/\[\[([^\[\]|\n]{0,40})$/); return m?m[1]:null; };
  const draw=()=>{
    box.innerHTML=items.map((o,i)=>`<div class="ac-row ${i===sel?'on':''}" data-i="${i}"><span class="ac-kind ac-${o.kind}">${o.kind}</span>
      <span class="ac-name">${esc(o.name)}</span><span class="ac-sub">${esc(o.sub)}</span></div>`).join("");
    box.querySelectorAll(".ac-row").forEach(r=>r.onmousedown=e=>{ e.preventDefault(); sel=+r.dataset.i; accept(); });
  };
  const update=()=>{
    q=query(); if(q==null){ close(); return; }
    targets=targets||linkTargets();
    const t=q.replace(/^(player|team|event)\s*:\s*/i,"").toLowerCase(), nk=normKey(t);
    items=targets.filter(o=>!nk || o.k.includes(nk) || o.name.toLowerCase().includes(t))
      .sort((a,b)=>(b.k.startsWith(nk)-a.k.startsWith(nk)) || a.name.localeCompare(b.name)).slice(0,8);
    if(!items.length){ close(); return; }
    sel=Math.min(sel,items.length-1); box.hidden=false; draw();
  };
  const accept=()=>{
    const o=items[sel]; if(!o||q==null) return;
    const pos=ta.selectionStart, start=pos-q.length;
    const ins=(o.ambiguous?o.kind+":":"")+o.name+"]]";
    const after=ta.value.slice(pos).replace(/^[^\[\]\n]*\]\]/, "");      // replace any half-typed name + ]]
    ta.value=ta.value.slice(0,start)+ins+after; const c=start+ins.length; ta.setSelectionRange(c,c); close(); ta.focus();
  };
  ta.addEventListener("input", ()=>{ sel=0; update(); });
  ta.addEventListener("click", update);
  ta.addEventListener("blur", ()=>setTimeout(close,150));
  ta.addEventListener("keydown", e=>{
    if(box.hidden) return;
    if(e.key==="ArrowDown"){ sel=(sel+1)%items.length; draw(); e.preventDefault(); }
    else if(e.key==="ArrowUp"){ sel=(sel-1+items.length)%items.length; draw(); e.preventDefault(); }
    else if(e.key==="Enter"||e.key==="Tab"){ accept(); e.preventDefault(); }
    else if(e.key==="Escape"){ close(); e.preventDefault(); }
  });
}
// "✨ Write with AI": turns the draft in the editor into a long news article (build/ai_writer.py, via the
// admin server and the Chutes API). The key is kept on this computer only (local/ai.json, never published).
let _aiUndo = null;
async function setupAiBox(){
  const box=$("#ai-box"); if(!box) return;
  let st={configured:false};
  try{ st = await (await fetch("/api/ai/status")).json(); }catch(e){}
  const keyForm = `<div class="ai-key" id="ai-keyform"${st.configured?' hidden':''}>
      <input id="ai-key" class="adm-in" type="password" placeholder="Paste your Chutes API key (cpk_…)" autocomplete="off">
      <button id="ai-savekey" class="loadmore">Save key</button>
      <div class="muted" style="font-size:11px;margin-top:4px">Kept only on this computer (bot-pro-league/local/ai.json), never published. Each computer needs it once.</div></div>`;
  box.innerHTML = `<div class="ai-row">
      <button id="ai-go" class="loadmore ai-go"${st.configured?'':' disabled'}>✨ Write with AI</button>
      <span class="muted" style="font-size:11px">${st.configured?`long article · ${esc((st.model||'').split('/').pop())} · <a href="#/admin" id="ai-changekey">change key</a>`:'needs your Chutes API key'}</span>
      ${_aiUndo?'<button id="ai-undo" class="loadmore">↩ Undo</button>':''}
    </div>${keyForm}<div id="ai-msg" class="muted" style="font-size:12px;margin-top:6px"></div>`;
  const msg=$("#ai-msg");
  const ck=$("#ai-changekey"); if(ck) ck.onclick=e=>{ e.preventDefault(); $("#ai-keyform").hidden=false; };
  $("#ai-savekey").onclick=async ()=>{
    const k=$("#ai-key").value.trim(); if(!k){ msg.textContent="Paste the key first."; return; }
    const r=await apiPost("/api/ai/key",{key:k});
    if(r.ok) setupAiBox(); else msg.textContent="Couldn't save the key: "+(r.error||"failed");
  };
  const undo=$("#ai-undo"); if(undo) undo.onclick=()=>{ $("#art-title").value=_aiUndo.title; $("#art-body").value=_aiUndo.body; _aiUndo=null; setupAiBox(); };
  $("#ai-go").onclick=async ()=>{
    const title=$("#art-title").value.trim(), body=$("#art-body").value.trim();
    if(!body){ msg.textContent="Put the facts in the body first (open a draft, or write a few lines with [[links]])."; return; }
    const btn=$("#ai-go"); btn.disabled=true; btn.textContent="✨ Writing… (up to a minute)"; msg.textContent="";
    const r=await apiPost("/api/ai/draft",{title, body, date:$("#art-date").value});
    if(r.ok){
      _aiUndo={title, body};
      $("#art-title").value=r.title||title; $("#art-body").value=r.body;
      await setupAiBox();
      $("#ai-msg").innerHTML="Written. <b>Read it through before saving:</b> the stats come from the league data, but the AI can still get a detail wrong. Press it again for another version.";
    } else { btn.disabled=false; btn.textContent="✨ Write with AI"; msg.textContent=r.error||"Something went wrong."; }
  };
}
function setupNewsAdmin(){
  const list=$("#art-list"); if(!list) return;
  const arts = DATA.articles||[];
  const clearForm=()=>{ $("#art-slug").value=""; $("#art-title").value=""; $("#art-author").value="";
    $("#art-body").value=""; $("#art-date").value=rsLeagueToday(); $("#art-draft").value="";
    $("#art-formtitle").textContent="New Article"; $("#art-msg").textContent=""; };
  clearForm();
  const filterEl=$("#art-filter"), countEl=$("#art-count");
  const renderList=(q)=>{
    const term=(q||"").trim().toLowerCase();
    const shown = term ? arts.filter(a=>(a.title||"").toLowerCase().includes(term)||(a.date||"").includes(term)) : arts;
    list.innerHTML = !arts.length ? '<p class="muted">None yet.</p>'
      : (shown.length ? shown.map(a=>`<div class="adm-trow" data-artedit="${esc(a.slug)}" style="cursor:pointer" title="Click to edit">
        <span class="adm-name" style="flex:1;min-width:0">${esc(a.title)}</span>
        <span class="muted" style="font-size:11px">${esc(a.date||'')}</span>
        <button class="adm-del" data-artdel="${esc(a.slug)}" title="Delete">✕</button>
      </div>`).join("") : '<p class="muted">No matches.</p>');
    if(countEl) countEl.textContent = arts.length ? `(${term?shown.length+" of ":""}${arts.length})` : "";
    list.querySelectorAll("[data-artedit]").forEach(row=>row.onclick=e=>{
      if(e.target.closest("[data-artdel]")) return;
      const a=arts.find(x=>x.slug===row.dataset.artedit); if(!a) return;
      $("#art-slug").value=a.slug; $("#art-title").value=a.title||""; $("#art-date").value=a.date||"";
      $("#art-author").value=a.author||""; $("#art-body").value=a.src||a.body||""; $("#art-draft").value="";
      $("#art-formtitle").textContent="Editing: "+a.title; $("#art-msg").textContent="";
      $("#art-title").scrollIntoView({behavior:"smooth", block:"center"});
    });
    list.querySelectorAll("[data-artdel]").forEach(b=>b.onclick=async e=>{
      e.stopPropagation();
      if(!confirm("Delete this article?")) return;
      await apiPost("/api/article/delete",{slug:b.dataset.artdel}); await reloadData(); renderAdmin();
    });
  };
  renderList("");
  if(filterEl) filterEl.oninput=()=>renderList(filterEl.value);
  setupLinkAutocomplete($("#art-body"), $("#art-ac"));
  setupAiBox();
  loadDrafts();
  $("#art-new").onclick=clearForm;
  $("#art-save").onclick=async ()=>{
    const title=$("#art-title").value.trim(), msg=$("#art-msg");
    if(!title){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent="Enter a title."; return; }
    msg.style.color=""; msg.textContent="Saving…";
    const r=await apiPost("/api/article/save",{slug:$("#art-slug").value.trim(), title, draftId:$("#art-draft").value||undefined,
      date:$("#art-date").value, author:$("#art-author").value.trim(), body:$("#art-body").value});
    if(r.ok){ await reloadData(); renderAdmin(); }
    else { msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent="Error: "+(r.msg||r.error||"failed"); }
  };
}

const SOLO_HALF = 5;                               // a solo game is 5v5
function setupSoloAdmin(){
  const teamA=$("#sq-players-a"), teamB=$("#sq-players-b"); if(!teamA||!teamB) return;
  // autocomplete list of every bot in BPL (alphabetical), so any player can be typed quickly
  let dl = $("#sq-allbots"); if(dl) dl.remove();
  dl = document.createElement("datalist"); dl.id = "sq-allbots";
  const seen = new Set(), names = [];
  allPlayers().forEach(p=>{ const k=normKey(p.name); if(seen.has(k)) return; seen.add(k); names.push(p.name); });
  names.sort((a,b)=>a.localeCompare(b));
  dl.innerHTML = names.map(n=>`<option value="${esc(n)}">`).join("");
  document.body.appendChild(dl);
  const addRow = (container, name="")=>{
    const row = document.createElement("div");
    row.className = "sq-prow";
    row.style.cssText = "display:flex;gap:4px;margin-bottom:4px";
    row.innerHTML = `
      <input class="adm-in sq-name" list="sq-allbots" autocomplete="off" placeholder="Player" value="${esc(name)}" style="flex:2;min-width:0">
      <input class="adm-in sq-k" type="number" min="0" placeholder="K" style="width:42px" title="Kills">
      <input class="adm-in sq-a" type="number" min="0" placeholder="A" style="width:42px" title="Assists">
      <input class="adm-in sq-d" type="number" min="0" placeholder="D" style="width:42px" title="Deaths">
      <input class="adm-in sq-mvp" type="number" min="0" placeholder="M" style="width:42px" title="MVPs">
      <button class="sq-rm" title="Remove" style="background:none;border:none;color:var(--muted);cursor:pointer">✕</button>`;
    row.querySelector(".sq-rm").onclick = ()=>row.remove();
    container.appendChild(row);
  };
  const fillTeams = (a=[], b=[])=>{ teamA.innerHTML=""; teamB.innerHTML="";
    for(let i=0;i<SOLO_HALF;i++) addRow(teamA, a[i]||"");
    for(let i=0;i<SOLO_HALF;i++) addRow(teamB, b[i]||""); };
  fillTeams();
  document.querySelectorAll(".sq-teamadd").forEach(b=>b.onclick=()=>addRow(b.dataset.team==="a"?teamA:teamB));
  // match score -> which side won (drives the header badges and the saved won/lost flags)
  const thA=$("#sq-th-a"), thB=$("#sq-th-b"), badgeA=$("#sq-badge-a"), badgeB=$("#sq-badge-b");
  const winnerA=()=>{ const av=$("#sq-score-a").value, bv=$("#sq-score-b").value;
    if(av===""||bv==="") return null; const sa=+av, sb=+bv; return sa===sb ? "tie" : sa>sb; };
  const updateWin=()=>{ const w=winnerA();
    thA.className="sq-team-h"; thB.className="sq-team-h"; badgeA.textContent=""; badgeB.textContent=""; badgeA.className="sq-th-badge"; badgeB.className="sq-th-badge";
    if(w==="tie"){ badgeA.textContent="tie — no winner"; badgeA.classList.add("tie"); return; }
    if(w===null) return;
    thA.classList.add(w?"win":"lose"); thB.classList.add(w?"lose":"win");
    badgeA.textContent=w?"WON":"LOST"; badgeB.textContent=w?"LOST":"WON"; };
  $("#sq-score-a").oninput=updateWin; $("#sq-score-b").oninput=updateWin;
  // random balanced lineup -> fill both teams AND output the bot_add string
  const randBtn=$("#sq-rand");
  if(randBtn) randBtn.onclick=()=>{
    const out=$("#sq-randout"), rmsg=$("#sq-randmsg");
    const line=soloRandomLineup(SOLO_HALF*2);
    if(!line){ out.hidden=false; out.value=""; rmsg.textContent=`Need at least ${SOLO_HALF*2} ranked solo players to build a lineup.`; return; }
    fillTeams(line.teamA, line.teamB);            // stack-mates kept on the same side where they fit
    out.hidden=false; out.value=line.str; out.focus(); out.select();
    let copied=false; try{ copied=document.execCommand("copy"); }catch(e){}
    rmsg.textContent=(copied?"Copied. ":"")+`${line.rankLo}–${line.rankHi} in Solo Queue · filled both teams`;
  };
  $("#sq-save").onclick = async ()=>{
    const msg = $("#sq-msg");
    const av=$("#sq-score-a").value, bv=$("#sq-score-b").value, sa=+av, sb=+bv;
    if(av===""||bv===""||sa===sb){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent="Enter a score with a winner (no ties)."; return; }
    const aWon=sa>sb;
    const collect=(container,won)=>[...container.querySelectorAll(".sq-prow")].map(r=>({
      name: r.querySelector(".sq-name").value.trim(),
      k: +r.querySelector(".sq-k").value||0, d: +r.querySelector(".sq-d").value||0,
      a: +r.querySelector(".sq-a").value||0, mvp: +r.querySelector(".sq-mvp").value||0, won
    })).filter(p=>p.name);
    const players=[...collect(teamA,aWon), ...collect(teamB,!aWon)];
    if(!players.length){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent="Add at least one player."; return; }
    msg.style.color=""; msg.textContent = "Saving…";
    const before = soloRankSnapshot();                       // solo standings before this game
    const r = await apiPost("/api/solo/add",{map:$("#sq-map").value.trim(), date:$("#sq-date").value, players});
    if(r.ok){ msg.style.color="var(--good)"; msg.textContent="Saved "+players.length+" players.";
      $("#sq-map").value=""; $("#sq-score-a").value=""; $("#sq-score-b").value=""; updateWin(); fillTeams();
      await reloadData(); loadSoloList();
      showSoloRankSummary(before, soloRankSnapshot(), players.map(p=>normKey(p.name))); }
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
    return `<div class="adm-trow sq-gamerow" data-sologame="${g.id}" title="Click for the scoreboard">
      <span class="muted" style="font-size:11px;min-width:70px">${esc(g.map||"—")}${g.date?" · "+esc(g.date):""}</span>
      <span style="flex:1;font-size:12px"><span class="ae-win">${w||"—"}</span> <span class="muted">def.</span> ${l||"—"}</span>
      <button class="adm-del" data-solodel="${g.id}" title="Delete">✕</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-sologame]").forEach(row=>row.onclick=e=>{
    if(e.target.closest("[data-solodel]")) return;               // delete button handles itself
    const g=games.find(x=>String(x.id)===row.dataset.sologame); if(g) showSoloGameCard(g);
  });
  box.querySelectorAll("[data-solodel]").forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    if(!confirm("Delete this solo game?")) return;
    await apiPost("/api/solo/delete",{id:+b.dataset.solodel}); await reloadData(); loadSoloList();
  });
}

// click a recorded solo game -> scoreboard popup (like the pro match card) with each
// player's stats and the rating-point gain this game earned them.
function showSoloGameCard(g){
  const stats=(DATA.soloGameStats||{})[String(g.id)]||{};
  const info={}; allPlayers().forEach(p=>{ const k=normKey(p.name); if(!info[k]) info[k]=p; });
  const rows=(g.players||[]).slice().sort((a,b)=> (b.won?1:0)-(a.won?1:0) || b.k-a.k);
  const line=pl=>{ const k=normKey(pl.name), pi=info[k], st=stats[k]||{};
    const kd=pl.d?(pl.k/pl.d).toFixed(2):(pl.k).toFixed(2);
    const gain=st.gain;
    const gtxt=gain==null?'—':(gain>0?'+'+gain:''+gain), gcls=gain>0?'up':gain<0?'down':'same';
    const nm = pi&&pi.slug ? `<a href="#/player/${pi.slug}">${esc(pl.name)}</a>` : esc(pl.name);
    return `<tr class="${pl.won?'sg-w':'sg-l'}">
      <td class="sg-nm">${pi?flag(pi.iso):''}${nm}</td>
      <td class="mono">${pl.k}</td><td class="mono">${pl.a}</td><td class="mono">${pl.d}</td>
      <td class="mono">${kd}</td><td class="mono">${pl.mvp}</td>
      <td class="mono sg-gain ${gcls}" title="rating points earned from this game">${gtxt}</td></tr>`; };
  const w=g.players.filter(p=>p.won).length, l=g.players.length-w;
  let ov=$("#sqgame-ov");
  if(!ov){ ov=document.createElement("div"); ov.id="sqgame-ov"; document.body.appendChild(ov); }
  ov.innerHTML=`<div class="sqgame-card">
      <div class="sqgame-head"><div><div class="sqgame-map">${esc(g.map||"Solo Queue")}</div>
        <div class="sqgame-sub muted">${g.date?esc(g.date)+" · ":""}${w} won · ${l} lost</div></div>
        <button class="sqgame-x" aria-label="Close">✕</button></div>
      <div class="sqgame-body"><table class="data sqgame-tbl"><thead><tr>
        <th class="no-sort">Player</th><th class="no-sort">K</th><th class="no-sort">A</th><th class="no-sort">D</th>
        <th class="no-sort">K/D</th><th class="no-sort">MVP</th><th class="no-sort" title="Rating points earned">±Pts</th>
        </tr></thead><tbody>${rows.map(line).join("")}</tbody></table></div>
      <div class="sqgame-foot muted">Rating points = how this game moved each player's Solo Queue score.</div></div>`;
  ov.style.display="flex";
  const close=()=>{ ov.style.display="none"; };
  ov.querySelector(".sqgame-x").onclick=close;
  ov.onclick=e=>{ if(e.target===ov) close(); };
  document.addEventListener("keydown", function esc2(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown", esc2); } });
}

// bot_add name for a player: team players get "<tag> <name>", free agents just "<name>";
// anything with a space (a tag, or a two-word name like "narin Mikure") is quoted.
function soloBotName(p){
  const t = p.team ? teamByName(p.team) : null;
  const nm = (t && t.tag) ? `${t.tag} ${p.name}` : p.name;
  return { text: /\s/.test(nm) ? `"${nm}"` : nm, tagged: !!(t && t.tag) };
}
// split the picked players into two teams of SOLO_HALF, keeping stack-mates together where they fit
function splitByStacks(players){
  const bySlug={}; players.forEach(p=>bySlug[p.slug]=p);
  const present=new Set(players.map(p=>p.slug));
  const adj={}; players.forEach(p=>adj[p.slug]=new Set());
  (DATA.stacks||[]).forEach(st=>{ const inn=(st.players||[]).filter(s=>present.has(s));
    for(let i=0;i<inn.length;i++) for(let j=i+1;j<inn.length;j++){ adj[inn[i]].add(inn[j]); adj[inn[j]].add(inn[i]); } });
  const seen=new Set(), comps=[];                 // connected components = groups that queue together
  players.forEach(p=>{ if(seen.has(p.slug)) return; const stk=[p.slug], members=[]; seen.add(p.slug);
    while(stk.length){ const x=stk.pop(); members.push(x); adj[x].forEach(y=>{ if(!seen.has(y)){ seen.add(y); stk.push(y); } }); }
    comps.push(members); });
  const H=SOLO_HALF, teams=[[],[]];
  comps.sort((a,b)=>b.length-a.length).forEach(m=>{
    const fits=[0,1].filter(t=>teams[t].length+m.length<=H).sort((x,y)=>teams[x].length-teams[y].length);
    if(fits.length){ m.forEach(s=>teams[fits[0]].push(s)); }
    else m.forEach(s=>{ const t=teams[0].length<=teams[1].length?0:1; (teams[t].length<H?teams[t]:teams[1-t]).push(s); });
  });
  while(teams[0].length>H) teams[1].push(teams[0].pop());   // force 5/5 if a big group overflowed
  while(teams[1].length>H) teams[0].push(teams[1].pop());
  return [teams[0].map(s=>bySlug[s].name), teams[1].map(s=>bySlug[s].name)];
}
// a random block of n similarly-ranked Solo Queue players -> a bot_add string + stack-aware teams
function soloRandomLineup(n){
  const ranked = soloLeague().filter(p=>p.rating!=null).sort((a,b)=>b.rating-a.rating);
  if(ranked.length < n) return null;
  const start = Math.floor(Math.random()*(ranked.length - n + 1));
  const pick = ranked.slice(start, start+n);
  const parts = pick.map(soloBotName);
  const [teamA, teamB] = splitByStacks(pick);
  return { str: parts.map(x=>`bot_add ${x.text};`).join(" "), names: pick.map(p=>p.name), teamA, teamB,
           rankLo: "#"+(start+1), rankHi: "#"+(start+n), teams: parts.filter(x=>x.tagged).length };
}
// snapshot of the solo-queue ranking (rated players, rating desc — mirrors parse.py's solo_ranked)
function soloRankSnapshot(){
  // the WHOLE Solo Queue board (solo-only + pro/amateur who also queue), same as the tab —
  // not just DATA.players.solo, or games between tournament players would look rank-neutral.
  const rated=soloLeague().filter(p=>p.rating!=null).slice().sort((a,b)=>b.rating-a.rating);
  const m={}; rated.forEach((p,i)=>{ m[normKey(p.name)]={rank:i+1, name:p.name, iso:p.iso}; });
  return m;
}
// after a solo scoreboard is recorded, pop out a summary of how the solo-queue ranks moved.
function showSoloRankSummary(before, after, participantKeys){
  const parts=participantKeys||[], keys=new Set(parts);
  Object.keys(after).forEach(k=>{ if(!before[k] || before[k].rank!==after[k].rank) keys.add(k); });
  Object.keys(before).forEach(k=>{ if(!after[k] || before[k].rank!==after[k].rank) keys.add(k); });
  const rows=[...keys].map(k=>{
    const a=after[k], b=before[k]; if(!a) return null;       // no longer rated (won't happen on add)
    let move, cls;
    if(!b){ move="NEW"; cls="new"; }
    else { const d=b.rank-a.rank; if(d>0){move="▲"+d;cls="up";} else if(d<0){move="▼"+(-d);cls="down";} else {move="—";cls="same";} }
    return {a, b, move, cls, part:parts.includes(k)};
  }).filter(Boolean).sort((x,y)=>x.a.rank-y.a.rank);
  const moved=rows.filter(r=>r.cls!=="same").length;
  const body=rows.map(r=>`<div class="sqsum-row${r.part?' part':''}">
      <span class="sqsum-rank">#${r.a.rank}</span>
      <span class="sqsum-name">${flag(r.a.iso)}${esc(r.a.name)}</span>
      <span class="sqsum-prev">${r.b?"was #"+r.b.rank:"first game"}</span>
      <span class="sqm ${r.cls}">${r.move}</span></div>`).join("");
  let ov=$("#sqsum-ov");
  if(!ov){ ov=document.createElement("div"); ov.id="sqsum-ov"; document.body.appendChild(ov); }
  ov.innerHTML=`<div class="sqsum-card">
      <div class="sqsum-head"><span>Solo rank changes</span><button class="sqsum-x" aria-label="Close">✕</button></div>
      <div class="sqsum-body">${body||'<p class="muted" style="padding:14px">No ranked players affected.</p>'}</div>
      <div class="sqsum-foot muted">${moved} player${moved===1?"":"s"} moved${rows.length>moved?" · "+(rows.length-moved)+" unchanged":""}</div></div>`;
  ov.style.display="flex";
  const close=()=>{ ov.style.display="none"; };
  ov.querySelector(".sqsum-x").onclick=close;
  ov.onclick=e=>{ if(e.target===ov) close(); };
  document.addEventListener("keydown", function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown", esc); } });
}

// ---- event wrap-up (build/wrapup.py): the event's end-of-event rules in one go, previewed before saving ----
async function setupWrapUp(slug, reload, box){
  box = box || $("#ae-wrap"); if(!box) return;
  const r=await fetch("/api/wrapup/"+slug).then(x=>x.json()).catch(()=>null);
  if(!r||!r.ok){ box.innerHTML=''; return; }
  const R=r.rules, st=r.standings, nonPro=s=>s.status!=="pro";
  const champ=st.find(s=>s.rank===1)||{name:r.champion,status:"pro"};
  box.innerHTML=`<details class="hl-fix" ${r.wrapped?'':'open'}><summary><b>Wrap up this event</b> <span class="muted">· ${r.wrapped?`wrapped up on ${esc(r.wrapped.date)}; running it again only applies what's left`:`apply the end-of-event rules in one go: preview first, nothing saves until you apply`}</span></summary>
    <div class="wu-rules">
      <label class="rs-check"><input type="checkbox" id="wu-cp" ${R.champion_pro&&nonPro(champ)?'checked':''} ${nonPro(champ)?'':'disabled'}> <b>Champion turns pro</b> <span class="muted">· ${esc(champ.name)}${nonPro(champ)?'':' are already a pro team'}</span></label>
      <div class="wu-sub" id="wu-cp-f">${nonPro(champ)?`<input id="wu-cp-tag" class="adm-in" placeholder="in-game tag, e.g. PD" style="max-width:180px"> <input id="wu-cp-logo" type="file" accept="image/*" class="adm-in" style="max-width:260px"> <span class="muted" style="font-size:11px">line-up: ${esc(champ.players.join(", "))}</span>`:''}</div>
      <label class="rs-check"><input type="checkbox" id="wu-tp" ${R.top_pro?'checked':''}> <b>Top <input id="wu-tp-n" class="adm-in wu-n" type="number" min="1" value="${(R.top_pro&&R.top_pro.n)||8}"> turn pro</b> <span class="muted">· teams without a pro page; each needs a tag</span></label>
      <div class="wu-sub" id="wu-tp-list"></div>
      <label class="rs-check"><input type="checkbox" id="wu-dr" ${R.disband_rest?'checked':''}> <b>Disband everyone outside the top <input id="wu-dr-n" class="adm-in wu-n" type="number" min="1" value="${(R.disband_rest&&R.disband_rest.n)||8}"></b> <span class="muted">· only teams without a full pro page; their players become free agents</span></label>
      <div class="wu-sub muted" id="wu-dr-list" style="font-size:11px"></div>
      <label class="rs-check"><input type="checkbox" id="wu-sd" ${R.seeds?'checked':''}> <b>Seed the next event</b></label>
      <div class="wu-sub"><input id="wu-sd-t" class="adm-in" placeholder="next event's exact name" value="${esc((R.seeds&&R.seeds.target)||'')}" style="max-width:280px"> top <input id="wu-sd-n" class="adm-in wu-n" type="number" min="1" value="${(R.seeds&&R.seeds.count)||Math.min(10,st.length)}"> <span class="muted" style="font-size:11px">by final placement</span></div>
      <label class="rs-check"><input type="checkbox" id="wu-rc" ${R.recap?'checked':''}> <b>Write a recap draft</b> <span class="muted">· final, run, MVP, prize money and upset; goes to Drafts</span></label>
    </div>
    <button id="wu-prev" class="adm-btn" style="max-width:220px;margin-top:8px">Preview wrap-up</button><span id="wu-msg" class="muted" style="font-size:12px;margin-left:10px"></span>
    <div id="wu-out"></div></details>`;
  let cpLogo=null; const lg=$("#wu-cp-logo");
  if(lg) lg.onchange=()=>{ const f=lg.files[0]; if(!f){cpLogo=null;return;} const fr=new FileReader(); fr.onload=()=>{cpLogo=fr.result;}; fr.readAsDataURL(f); };
  const drawLists=()=>{ const n=+$("#wu-tp-n").value||0, k=+$("#wu-dr-n").value||0;
    const ups=st.filter(s=>s.rank<=n && nonPro(s) && !($("#wu-cp").checked && s.rank===1));
    $("#wu-tp-list").innerHTML = $("#wu-tp").checked ? (ups.length ? ups.map(s=>`<div class="wu-team"><span>${s.rank}. ${esc(s.name)}</span><input class="adm-in wu-tag" data-team="${esc(s.name)}" placeholder="tag"></div>`).join("") : '<span class="muted" style="font-size:11px">Every team in the top '+n+' already has a pro page.</span>') : '';
    const out=st.filter(s=>s.rank>k && s.status!=="pro");
    $("#wu-dr-list").textContent = $("#wu-dr").checked ? (out.length ? 'Would disband: '+out.map(s=>s.name).join(", ") : 'No teams outside the top '+k+' to disband.') : ''; };
  ["wu-tp","wu-tp-n","wu-dr","wu-dr-n","wu-cp"].forEach(id=>$("#"+id).addEventListener("input", drawLists)); drawLists();
  const collect=()=>{ const rules={};
    if($("#wu-cp").checked) rules.champion_pro={tag:($("#wu-cp-tag")||{}).value||"", logo:cpLogo};
    if($("#wu-tp").checked){ const teams={}; document.querySelectorAll(".wu-tag").forEach(i=>teams[i.dataset.team]={tag:i.value}); rules.top_pro={n:+$("#wu-tp-n").value, teams}; }
    if($("#wu-dr").checked) rules.disband_rest={n:+$("#wu-dr-n").value};
    if($("#wu-sd").checked) rules.seeds={target:$("#wu-sd-t").value, count:+$("#wu-sd-n").value};
    if($("#wu-rc").checked) rules.recap=true;
    return rules; };
  $("#wu-prev").onclick=async ()=>{
    const msg=$("#wu-msg"), rules=collect(); msg.style.color=""; msg.textContent="Checking…";
    const res=await apiPost("/api/wrapup",{slug, rules, dryRun:true});
    if(!res.ok){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent=res.error||"Something went wrong."; $("#wu-out").innerHTML=""; return; }
    msg.textContent=""; $("#wu-out").innerHTML=rsPreviewHtml(res,false);
    $("#rs-cancel").onclick=()=>{ $("#wu-out").innerHTML=""; };
    $("#rs-apply").onclick=async ()=>{ $("#rs-apply").disabled=true; $("#rs-apply").textContent="Saving…";
      const a=await apiPost("/api/wrapup",{slug, rules, dryRun:false});
      if(!a.ok){ msg.style.color="var(--accent2,#ff6b6b)"; msg.textContent=a.error||a.msg||"Failed."; $("#rs-apply").disabled=false; $("#rs-apply").textContent="Apply changes"; return; }
      await reload(); const o=$("#wu-out"); if(o) o.innerHTML=rsPreviewHtml(a,true); };
  };
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
    if(st.format==="single_elim"||st.format==="ext_gsl"){
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
        <span class="muted" style="font-size:12px;text-transform:capitalize">${st.format==="ext_gsl"?"Extended GSL":st.format.replace("_"," ")}</span>
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
    <div class="ae-head"><strong style="font-family:Chakra Petch;font-size:18px">${esc(man.name)}</strong>
      ${r.champion?`<span class="ae-champ">🏆 ${esc(r.champion)}</span>`:'<span class="muted">in progress</span>'}
      <a href="#/tournament/${esc(slug)}" class="muted" style="margin-left:auto;font-size:12px">open event page →</a></div>
    ${r.champion?'<div id="ae-wrap" class="ae-wrap"></div>':''}
    ${stagesHtml || '<p class="muted">No stages yet — add one below.</p>'}
    <div class="ae-addstage">
      <div class="ib-title" style="margin-bottom:10px">Add Stage</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><label class="adm-l">Stage name</label><input id="as-name" class="adm-in" placeholder="Playoffs / Group A / Swiss Stage"></div>
        <div><label class="adm-l">Format</label><select id="as-fmt" class="adm-in">
          <option value="single_elim">Single Elim (bracket)</option>
          <option value="round_robin">Round Robin</option>
          <option value="swiss">Swiss (add matches by hand)</option>
          <option value="ext_gsl">Extended GSL (group of 6, in seed order)</option></select></div>
        <div><label class="adm-l">Best of</label><input id="as-bo" class="adm-in" type="number" min="1" value="1" style="width:70px"></div>
      </div>
      <label class="adm-l">Teams — one per line (seed order for a bracket)</label>
      <div id="as-seeds"></div>
      <textarea id="as-teams" class="adm-in" rows="5" placeholder="Aimpunch&#10;Cosmos&#10;…"></textarea>
      <button id="as-add" class="adm-btn" style="max-width:200px">Add stage</button>
    </div>`;

  // ---- wiring ----
  if(r.champion) setupWrapUp(slug, reload);
  fetch("/api/seeds?name="+encodeURIComponent(man.name)).then(x=>x.json()).then(x=>{
    const box=$("#as-seeds"); if(!box || !x.ok || !x.seeds) return;
    box.innerHTML = `<button type="button" class="loadmore as-seedbtn">Fill with the ${x.seeds.teams.length} seeds from ${esc(x.seeds.from)}</button>`;
    box.querySelector("button").onclick=()=>{ $("#as-teams").value = x.seeds.teams.join("\n"); };
  }).catch(()=>{});
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
    if(fmt==="ext_gsl" && teams.length!==6){ alert("An Extended GSL group needs exactly 6 teams, in seed order."); return; }
    await apiPost("/api/stage/add",{slug, name, format:fmt, teams, bestOf:+$("#as-bo").value||1}); reload(); };
}

const TIER_CLASS = {major:"et-major", s:"et-s", a:"et-a"};
// prize money (build/prizes.py): S-Tier sub-tiers come from the prize pool
const PRIZE_HINT = "S-Tier events: $1,000,000+ is S-Tier 1 (2.5x points), $250,000+ is S-Tier 2 (1.75x), less is S-Tier 3 (1.25x). Majors and A-Tier aren't split.";
function fmtUSD(v){ return v==null ? '—' : (v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US'); }
function fmtUSDc(v){ if(v==null) return '—'; const a=Math.abs(v), sg=v<0?'-':'';
  return a>=1e6 ? `${sg}$${(a/1e6).toFixed(2).replace(/\.?0+$/,'')}M` : a>=1e3 ? `${sg}$${Math.round(a/1e3)}k` : `${sg}$${Math.round(a)}`; }
function valueTip(p){ const v=p.valueParts; if(!v) return '';
  return `Market value from Rating Points (${fmtUSD(v.base)} base)`+(v.titles?`, +${v.titles*5}% for ${v.titles} title${v.titles===1?'':'s'} in the last year`:'')
    +(v.recentPrize?`, up to +15% for ${fmtUSD(v.recentPrize)} prize money in the last year`:'')+(v.active?'':', -30% for no events in the last year')+'.'; }
function parseUSD(v){ const n=parseFloat(String(v||'').replace(/[$,\s]/g,'')); return isFinite(n)&&n>0 ? Math.round(n) : 0; }
function subTierFor(tier, pool){ if(tier!=='s'||!pool) return ''; return pool>=1000000?'S-Tier 1':pool>=250000?'S-Tier 2':'S-Tier 3'; }
function placeOrd(n){ const v=n%100; return n+(v>=11&&v<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'); }
function tierBadgeEvent(tr){ return `<span class="event-tier ${TIER_CLASS[tr.tier]}">${esc(tr.tierLabel.toUpperCase())}</span>`; }
function fmtDate(iso){ if(!iso) return ""; const [y,m,d]=iso.split("-"); const mo=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]; return `${mo} ${+d}, ${y}`; }
function champLabel(tr){ return (/elimination/.test(tr.type) || tr.leaderboard) ? "Champion" : "1st Place"; }
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
      <td class="mono">${tr.prizePool?fmtUSD(tr.prizePool):'<span class="muted">—</span>'}</td>
    </tr>`).join("");
  const tab=(k,l)=>`<button data-tf="${k}" class="${k===tourneyFilter?'active':''}">${l} <span style="opacity:.7">${counts[k]}</span></button>`;
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Tournaments</h2>
    <div class="tabs">${tab("all","All")}${tab("major","Majors")}${tab("s","S-Tier")}${tab("a","A-Tier")}</div>
    <div class="tablewrap"><table class="data">
      <thead><tr><th class="no-sort">Date</th><th class="no-sort">Tier</th><th class="no-sort">Event</th>
        <th class="no-sort">Format</th><th class="no-sort">Teams</th><th class="no-sort">Winner</th><th class="no-sort">Prize pool</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  app.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{tourneyFilter=b.dataset.tf;renderTournaments();});
}

// ---------- playoff chances (Swiss groups still being played) ----------
// Plays the rest of a group CHANCE_RUNS times: the matches already drawn (a series under way starts
// from the maps already played), then each round still to come, drawn the way the admin's auto-draft
// does it (build/manual.py swiss_next_pairs: wins, then map difference, then losses, no rematches).
// Each map is priced like the match odds (line-up Rating Points, build/elo.py expect) and its score
// is drawn from the maps this event has recorded. A team's finish uses the event's tiebreaks
// (manual.py _rank_teams). When few matches are left, every way they can go is also checked, so a
// team that's through (or out) whatever happens is shown as such rather than as a rounded 100%.
const CHANCE_RUNS = 10000;
const _chanceCache = new Map();
function chanceRng(seed){ return ()=>{ seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function strHash(s){ let h = 2166136261; for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h>>>0; }
function groupChances(tr, st){
  if(st.format !== 'swiss' || tr.champion) return null;
  const nAdv = tr.leaderboard ? tr.leaderboard.perGroup : tr.advancePerGroup;
  if(!nAdv) return null;
  const total = st.swissRounds || 5;
  const ms = [];
  (st.rounds||[]).forEach(rd=>(rd.matches||[]).forEach(m=>{ if(m.a && m.b && m.a!=='(bye)' && m.b!=='(bye)') ms.push({m, r: rd.round}); }));
  if(!ms.length) return null;
  const teams = [...new Set(ms.flatMap(x=>[x.m.a, x.m.b]).concat((st.standings||[]).map(s=>s.name)))];
  if(teams.length <= nAdv) return null;
  const lastRound = Math.max(...ms.map(x=>x.r));
  if(lastRound >= total && ms.every(x=>x.m.w===1 || x.m.w===2)) return null;   // finished: the table's Q marks take over
  const smaps = m=>(m.stats && m.stats.maps) || [];
  const key = JSON.stringify([tr.slug, st.id, total, nAdv, tr.groupTiebreak, tr.chanceModel,
    ms.map(x=>[x.r, x.m.a, x.m.b, x.m.sa, x.m.sb, x.m.w, x.m.bo, smaps(x.m).map(p=>[p.scoreA, p.scoreB])])]);
  if(_chanceCache.has(key)) return _chanceCache.get(key);
  // map scores to draw from: [winner's rounds, loser's rounds] of every map this event has recorded
  const scores = [];
  (tr.stages||[]).forEach(s=>(s.rounds||[]).forEach(rd=>(rd.matches||[]).forEach(m=>smaps(m).forEach(p=>{
    if(p.scoreA!=null && p.scoreB!=null && p.scoreA!==p.scoreB) scores.push([Math.max(p.scoreA,p.scoreB), Math.min(p.scoreA,p.scoreB)]); }))));
  const res = simulateGroup({tr, st, teams, ms, total, nAdv, lastRound, key,
    scores: scores.length >= 12 ? scores : [[13,11],[13,10],[13,9],[13,8],[13,7],[13,6],[13,5],[13,3],[16,14],[13,9],[13,7],[13,10]]});
  _chanceCache.set(key, res);
  return res;
}
function simulateGroup({tr, st, teams, ms, total, nAdv, lastRound, key, scores}){
  const N = teams.length, idx = new Map(teams.map((t,i)=>[t,i])), lower = teams.map(t=>t.toLowerCase());
  const cm = tr.chanceModel || {}, scale = cm.scale || 2000, pts = cm.pts || {};
  const known = teams.map(t=>pts[t]).filter(v=>v!=null);
  const avg = known.length ? known.reduce((a,b)=>a+b, 0)/known.length : 1500;
  const str = teams.map(t=>pts[t]!=null ? pts[t] : avg);
  const pMap = (i,j)=>1/(1+Math.pow(10, (str[j]-str[i])/scale));
  const mapsFirst = tr.groupTiebreak !== 'rounds';
  const futureBo = st.bestOf || 1;
  const pk = (i,j)=> i<j ? i*N+j : j*N+i;
  const fresh = ()=>({w:new Int16Array(N), l:new Int16Array(N), mw:new Int16Array(N), ml:new Int16Array(N),
    rf:new Int32Array(N), ra:new Int32Array(N), diff:new Int32Array(N), h2h:new Int16Array(N*N), byes:new Int16Array(N), unk:new Uint8Array(N)});
  const copy = S=>({w:S.w.slice(), l:S.l.slice(), mw:S.mw.slice(), ml:S.ml.slice(), rf:S.rf.slice(), ra:S.ra.slice(),
    diff:S.diff.slice(), h2h:S.h2h.slice(), byes:S.byes.slice(), unk:S.unk.slice()});
  // a finished series: maps (a Bo1 counts 1-0), rounds, and the draw's "diff" (score difference: maps, or a Bo1's rounds)
  const record = (S, i, j, ga, gb, ra, rb, bo)=>{
    const aWon = ga > gb, win = aWon ? i : j, lose = aWon ? j : i;
    const [ma, mb] = bo > 1 ? [ga, gb] : (aWon ? [1,0] : [0,1]);
    S.w[win]++; S.l[lose]++;
    S.mw[i] += ma; S.ml[i] += mb; S.mw[j] += mb; S.ml[j] += ma;
    S.rf[i] += ra; S.ra[i] += rb; S.rf[j] += rb; S.ra[j] += ra;
    const d = bo > 1 ? ga - gb : ra - rb;
    S.diff[i] += d; S.diff[j] -= d;
    S.h2h[win*N+lose]++;
  };
  // where things stand
  const base = fresh(), met = new Set(), pending = [];
  const playing = {};
  ms.forEach(({m, r})=>{
    const i = idx.get(m.a), j = idx.get(m.b);
    met.add(pk(i,j)); (playing[r] = playing[r] || new Set()).add(i).add(j);
    const mp = (m.stats && m.stats.maps) || [];
    let ra = mp.reduce((s,p)=>s+(p.scoreA||0), 0), rb = mp.reduce((s,p)=>s+(p.scoreB||0), 0);
    if(m.w===1 || m.w===2){
      const sa = m.sa!=null ? m.sa : (m.w===1 ? 1 : 0), sb = m.sb!=null ? m.sb : (m.w===2 ? 1 : 0);
      const aWon = m.w===1, win = aWon ? i : j, lose = aWon ? j : i;
      const [ma, mb] = Math.max(sa, sb) <= 5 ? [sa, sb] : (aWon ? [1,0] : [0,1]);
      if(!ra && !rb && Math.max(sa, sb) >= 13){ ra = sa; rb = sb; }
      base.w[win]++; base.l[lose]++;
      base.mw[i] += ma; base.ml[i] += mb; base.mw[j] += mb; base.ml[j] += ma;
      base.rf[i] += ra; base.ra[i] += rb; base.rf[j] += rb; base.ra[j] += ra;
      base.diff[i] += sa - sb; base.diff[j] -= sa - sb;
      base.h2h[win*N+lose]++;
    } else {
      let ga = 0, gb = 0;
      mp.forEach(p=>{ if(p.scoreA > p.scoreB) ga++; else if(p.scoreB > p.scoreA) gb++; });
      pending.push({i, j, bo: m.bo || futureBo, ga, gb, ra, rb});
    }
  });
  Object.values(playing).forEach(set=>{ for(let t=0;t<N;t++) if(!set.has(t)) base.byes[t]++; });
  const need = bo=>Math.floor(bo/2) + 1;
  // the next round's pairs, exactly as manual.py drafts them
  const matchUp = (list, metS)=>{
    if(!list.length) return [];
    const a = list[0];
    for(let k=1;k<list.length;k++){
      if(metS.has(pk(a, list[k]))) continue;
      const sub = matchUp(list.slice(1, k).concat(list.slice(k+1)), metS);
      if(sub) return [[a, list[k]], ...sub];
    }
    return null;
  };
  const draft = (S, metS)=>{
    let order = [...Array(N).keys()].sort((x,y)=>(S.w[y]-S.w[x]) || (S.diff[y]-S.diff[x]) || (S.l[x]-S.l[y]) || (lower[x]<lower[y] ? -1 : lower[x]>lower[y] ? 1 : 0));
    if(N % 2){
      let bye = [...order].reverse().find(t=>S.byes[t]===0); if(bye===undefined) bye = order[N-1];
      S.byes[bye]++; order = order.filter(t=>t!==bye);
    }
    let pairs = matchUp(order, metS);
    if(!pairs){ pairs = []; for(let k=0;k+1<order.length;k+=2) pairs.push([order[k], order[k+1]]); }
    return pairs;
  };
  // ---- Monte Carlo ----
  const rnd = chanceRng(strHash(key));
  const play = (S, i, j, bo, ga, gb, ra, rb)=>{
    const p = pMap(i, j), n = need(bo);
    while(ga < n && gb < n){
      const sc = scores[(rnd()*scores.length)|0];
      if(rnd() < p){ ga++; ra += sc[0]; rb += sc[1]; } else { gb++; ra += sc[1]; rb += sc[0]; }
    }
    record(S, i, j, ga, gb, ra, rb, bo);
  };
  const md = (S,t)=>S.mw[t]-S.ml[t], rd = (S,t)=>S.rf[t]-S.ra[t];
  const finish = (S, tie)=>{
    const order = [...Array(N).keys()].sort((x,y)=>(S.w[y]-S.w[x]) || (S.l[x]-S.l[y]));
    const out = [];
    for(let i=0;i<N;){
      let j = i; while(j<N && S.w[order[j]]===S.w[order[i]] && S.l[order[j]]===S.l[order[i]]) j++;
      const block = order.slice(i, j);
      if(mapsFirst) block.sort((x,y)=>(md(S,y)-md(S,x)) || (rd(S,y)-rd(S,x)) || (tie[x]-tie[y]));
      else {
        const metAll = block.length > 1 && block.every(x=>block.every(y=>x===y || S.h2h[x*N+y] || S.h2h[y*N+x]));
        const hw = t=>metAll ? block.reduce((s,o)=>s+(o!==t ? S.h2h[t*N+o] : 0), 0) : 0;
        block.sort((x,y)=>(hw(y)-hw(x)) || (rd(S,y)-rd(S,x)) || (md(S,y)-md(S,x)) || (tie[x]-tie[y]));
      }
      out.push(...block); i = j;
    }
    return out;
  };
  const made = new Float64Array(N), tie = new Float64Array(N);
  for(let run=0; run<CHANCE_RUNS; run++){
    const S = copy(base), metS = new Set(met);
    pending.forEach(x=>play(S, x.i, x.j, x.bo, x.ga, x.gb, x.ra, x.rb));
    for(let r=lastRound+1; r<=total; r++)
      draft(S, metS).forEach(([i,j])=>{ metS.add(pk(i,j)); play(S, i, j, futureBo, 0, 0, 0, 0); });
    for(let t=0;t<N;t++) tie[t] = rnd();
    const o = finish(S, tie);
    for(let k=0;k<nAdv;k++) made[o[k]]++;
  }
  // ---- through / out whatever happens: every way the remaining series can end ----
  const left = pending.length + (total - lastRound) * Math.floor(N/2);
  const exact = left <= 8 && (total === lastRound || (futureBo > 1 && pending.every(x=>x.bo > 1)));
  const through = new Uint8Array(N).fill(exact ? 1 : 0), out = new Uint8Array(N).fill(exact ? 1 : 0);
  if(exact){
    const ends = (bo, ga, gb)=>{ const n = need(bo), e = [];
      if(ga < n && gb < n){ for(let k=gb;k<n;k++) e.push([n, k]); for(let k=ga;k<n;k++) e.push([k, n]); }
      return e; };
    const settle = (S, i, j, ga, gb, bo)=>{
      // rounds are unknown from here on: only maps and the draw's diff are exact (a Bo1 here is the last round, so its diff doesn't matter)
      const aWon = ga > gb, win = aWon ? i : j, lose = aWon ? j : i;
      const [ma, mb] = bo > 1 ? [ga, gb] : (aWon ? [1,0] : [0,1]);
      S.w[win]++; S.l[lose]++; S.mw[i] += ma; S.ml[i] += mb; S.mw[j] += mb; S.ml[j] += ma;
      S.diff[i] += ga - gb; S.diff[j] -= ga - gb; S.h2h[win*N+lose]++; S.unk[i] = 1; S.unk[j] = 1;
    };
    const better = (S,o,t)=>S.w[o]>S.w[t] || (S.w[o]===S.w[t] && S.l[o]<S.l[t]);
    const same = (S,o,t)=>S.w[o]===S.w[t] && S.l[o]===S.l[t];
    const leaf = S=>{
      for(let t=0;t<N;t++){
        if(!through[t] && !out[t]) continue;
        let sure = 0, might = 0;
        for(let o=0;o<N;o++){ if(o===t) continue;
          if(better(S,o,t)){ sure++; might++; continue; }
          if(!same(S,o,t)) continue;
          if(!mapsFirst){ might++; continue; }
          const dm = md(S,o) - md(S,t);
          if(dm > 0){ sure++; might++; }
          else if(dm === 0){
            if(S.unk[o] || S.unk[t]){ might++; continue; }
            const dr = rd(S,o) - rd(S,t);
            if(dr > 0){ sure++; might++; } else if(dr === 0) might++;
          }
        }
        if(might >= nAdv) through[t] = 0;
        if(sure < nAdv) out[t] = 0;
      }
    };
    const walk = (S, metS, list, k, r)=>{
      if(k < list.length){
        const x = list[k];
        for(const [ga, gb] of ends(x.bo, x.ga, x.gb)){
          const S2 = copy(S); settle(S2, x.i, x.j, ga, gb, x.bo); walk(S2, metS, list, k+1, r);
        }
        return;
      }
      if(r > total){ leaf(S); return; }
      const S2 = copy(S), metS2 = new Set(metS);
      const pairs = draft(S2, metS2); pairs.forEach(([i,j])=>metS2.add(pk(i,j)));
      walk(S2, metS2, pairs.map(([i,j])=>({i, j, bo: futureBo, ga: 0, gb: 0})), 0, r+1);
    };
    walk(copy(base), new Set(met), pending, 0, lastRound+1);
  }
  const res = new Map();
  teams.forEach((t,i)=>res.set(t, {p: made[i]/CHANCE_RUNS, through: !!through[i], out: !!out[i]}));
  return res;
}
function chanceCell(c){
  if(!c) return '<td></td>';
  if(c.through) return `<td class="gc gc-in" title="Through to the playoffs whatever happens in the matches left"><span class="gc-tag">✓ In</span></td>`;
  if(c.out) return `<td class="gc gc-out" title="Can't finish in the top places any more"><span class="gc-tag">Out</span></td>`;
  const v = c.p*100, txt = v >= 99.5 ? '>99%' : v < 0.5 ? '<1%' : Math.round(v)+'%';
  return `<td class="gc"><span class="gc-bar"><i style="width:${Math.max(2, Math.min(100, v)).toFixed(1)}%"></i></span><span class="gc-v">${txt}</span></td>`;
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
    const badge = nationCrest(name,18) || (t&&t.logo?`<img src="${esc(t.logo)}" alt="">`:'');
    return `<span class="team-inline"${rAttr(name, teamSlug)}>${badge}${inner}</span>`;
  };
  const seedTag = (name, teamSlug)=>{ const s = tr.seeds && (tr.seeds[teamSlug] || tr.seeds[name]); return s ? `<span class="seed-tag" title="Seed ${s}">${s}</span>` : ''; };
  const bteamName = (name, teamSlug, hov)=>{
    if(!name) return '<span class="muted">TBD</span>';
    const inner = teamSlug ? `<a href="#/team/${teamSlug}" style="color:inherit">${esc(name)}</a>` : esc(name);
    return `<span${hov!=null?hov:rAttr(name, teamSlug)}>${seedTag(name,teamSlug)}${inner}</span>`;
  };

  // prize money sits in the standings rows themselves (build/prizes.py): team prize + per-player share
  const prizeBy = {}; (tr.prizes||[]).forEach(x=>{ prizeBy[x.rank+'|'+normKey(x.name)] = x; });
  const hasPrizes = !!(tr.prizes&&tr.prizes.length);
  const prizeCell = s => { if(!hasPrizes) return ''; const x = prizeBy[s.rank+'|'+normKey(s.name)];
    return x ? `<td class="prize-cell" title="${esc(`Prize money: ${fmtUSD(x.amount)} for the team${x.perPlayer!=null?`, ${fmtUSD(x.perPlayer)} per player`:''}`)}"><b>${fmtUSD(x.amount)}</b>${x.perPlayer!=null?`<span>${fmtUSD(x.perPlayer)} each</span>`:''}</td>`
      : '<td class="prize-cell"><span class="muted">—</span></td>'; };
  const prizeNote = hasPrizes ? `<span class="muted" style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0"> · ${fmtUSD(tr.prizePool)} prize pool</span>` : '';
  const standRows = tr.standings.map(s=>`<tr>
      <td class="rankcol">${s.rank}</td>
      <td class="name-cell">${crest(s.name, s.teamSlug)}</td>
      <td class="mono">${s.w}-${s.l}</td>${prizeCell(s)}
    </tr>`).join("");

  const isElim = /elimination/.test(tr.type);

  // bracket matches: no hover popup — clicking the match opens an HLTV-style card instead
  const hovAttr = ()=> '';
  // --- tree bracket (single/double elim) ---
  const treeTeam = (m, side, gsl)=>{
    const name = side==='a'?m.a:m.b, teamSlug = side==='a'?m.aTeam:m.bTeam;
    const score = side==='a'?m.sa:m.sb, win = m.w===(side==='a'?1:2);
    const t = teamSlug ? teamBySlug(teamSlug) : null;
    const logo = nationCrest(name,15) || (t&&t.logo ? `<img class="bt-logo" src="${esc(t.logo)}" alt="">` : '');
    const nm = name ? (teamSlug ? `<a href="#/team/${teamSlug}">${esc(name)}</a>` : esc(name)) : `<span class="muted">${esc((gsl&&gsl.tbd&&gsl.tbd[side==='a'?0:1])||'TBD')}</span>`;
    const sc = score!=null ? score : '';
    const cls = win || (gsl&&gsl.box&&name) ? 'win' : gsl&&(m.w===1||m.w===2) ? 'lose' : '';
    return `<div class="bkt-team ${cls}"${hovAttr(m, side, name, teamSlug)}>${logo}${name?seedTag(name,teamSlug):''}<span class="bt-name">${nm}</span><span class="bt-score">${sc}</span></div>`;
  };
  const mref = (m, pfx)=> (m.i!=null ? ` data-match="${pfx}${m.i}"` : '');
  const treeMatch = (m, pfx="", slot, round, gsl)=>`<div class="bkt-match"${mref(m,pfx)}${slot!=null?` data-round="${round}" data-slot="${slot}"`:''}>${treeTeam(m,'a',gsl)}${treeTeam(m,'b',gsl)}</div>`;
  const isByeMatch = m => m.a==="(bye)" || m.b==="(bye)";
  // placement deciders (3rd place, 5th-8th, 9th...) float on their own, pulled out of the main
  // tree and grouped under their label in match order
  const isPlacementMatch = m => m.tp || m.pl;
  const thirdPlaceBox = (rounds, pfx="")=>{
    const pms = (rounds||[]).flatMap(rd=>rd.matches.filter(isPlacementMatch)).sort((x,y)=>(x.i||0)-(y.i||0));
    if(!pms.length) return '';
    const groups = [];
    pms.forEach(m=>{ const t = m.plt || "Third Place Match";
      let g = groups.find(x=>x.t===t); if(!g){ g={t, ms:[]}; groups.push(g); } g.ms.push(m); });
    return groups.map(g=>`<div class="bkt-third">
      <div class="bkt-third-title">${esc(g.t)}</div>
      ${g.ms.map(m=>`<div class="bkt-third-match">${treeMatch(m,pfx)}</div>`).join("")}</div>`).join("");
  };
  const treeSection = (title, rounds, pfx="", tagged)=>{
    if(!rounds.length) return '';
    // drop first-round byes: a seeded team with a bye is shown waiting in the next round.
    // when `tagged`, stamp each match with its real round + full-round slot so connectors
    // link to the true parent (match at round r, slot s feeds round r+1, slot floor(s/2)).
    const cols = rounds.map((rd,ri)=>{
        const matches = rd.matches.map((m,slot)=>({m,slot})).filter(x=>!isByeMatch(x.m) && !isPlacementMatch(x.m));
        if(!matches.length) return '';
        return `<div class="bkt-round">
        <div class="bkt-round-title">${esc(rd.title)}</div>
        <div class="bkt-round-matches">${matches.map(x=>treeMatch(x.m,pfx, tagged?x.slot:null, ri)).join("")}</div>
      </div>`;
      }).join("");
    return `${title?`<div class="bkt-section-title">${title}</div>`:''}
      <div class="bkt-wrap"><div class="bkt"><svg class="bkt-svg"></svg>${cols}</div></div>`;
  };
  const listRounds = (rounds, pfx="")=>`<div class="bracket">${rounds.map(rd=>{
      const ms = rd.matches.map(m=>`<div class="bmatch"${mref(m,pfx)}>
          <div class="bteam ${m.w===1?'bw':''}">${bteamName(m.a, m.aTeam, hovAttr(m,'a',m.a,m.aTeam))}<span class="bscore">${m.sa!=null?m.sa:''}</span></div>
          <div class="bteam ${m.w===2?'bw':''}">${bteamName(m.b, m.bTeam, hovAttr(m,'b',m.b,m.bTeam))}<span class="bscore">${m.sb!=null?m.sb:''}</span></div>
        </div>`).join("");
      return `<div class="bround"><div class="brtitle">${esc(rd.title)}</div>${ms}</div>`;
    }).join("")}</div>`;
  const stageStandings = st => {
    if(!st.standings.length) return '';
    // once every match in the group is decided, the top 2 (or the event's advancePerGroup) have booked their playoff spots
    const allM = (st.rounds||[]).flatMap(rd=>rd.matches||[]);
    const done = allM.length>0 && allM.every(m=> m.w===1 || m.w===2);
    const nAdv = tr.leaderboard ? tr.leaderboard.perGroup : (tr.advancePerGroup || 2);
    const ch = groupChances(tr, st);            // null once the group is finished (or has no playoff cut)
    const fin = done && !ch;
    const rows = st.standings.map(s=>{
      const adv = fin && s.rank<=nAdv;
      return `<tr class="${adv?'grp-adv':''}"><td class="rankcol">${s.rank}</td>
        <td class="name-cell">${nameOrTeamCrest(s.name,s.teamSlug)}${adv?`<span class="grp-q" title="${tr.leaderboard?'On the final leaderboard':'Qualified for the playoffs'}">Q</span>`:''}</td>
        <td class="mono">${s.w}</td><td class="mono">${s.l}</td>${ch?chanceCell(ch.get(s.name)):''}</tr>`;
    }).join("");
    const chHead = tr.leaderboard ? `Top ${nAdv}` : 'Playoffs';
    return `<div class="tablewrap" style="max-width:${ch?560:460}px;margin-bottom:12px"><table class="data">
      <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Team</th><th class="no-sort">W</th><th class="no-sort">L</th>${ch?`<th class="no-sort gc-h" title="Chance to finish in the top ${nAdv} of the group">${chHead}</th>`:''}</tr></thead>
      <tbody>${rows}</tbody></table>${fin?`<div class="grp-adv-note">${tr.leaderboard?`Top ${nAdv} go onto the final leaderboard`:`Top ${nAdv} advance to the playoffs`}</div>`:''}
      ${ch?`<div class="gc-note">${tr.leaderboard?`Top ${nAdv} chance`:'Playoff chance'}: the group's remaining matches played ${CHANCE_RUNS.toLocaleString('en-US')} times, each map priced from the two line-ups' Rating Points like the match odds. <b>✓ In</b>: through whatever happens. <b>Out</b>: can't make the top ${nAdv}.</div>`:''}</div>`;
  };
  const fmtLabel = f => ({single_elim:"Single Elimination",round_robin:"Round Robin",swiss:"Swiss",ext_gsl:"Extended GSL"}[f]||f);
  // Extended GSL group (build/manual.py gen_ext_gsl, fixed match ids): rounds 1 and 3 are the upper bracket, 2, 4 and 5 the lower
  const GSL_TBD = {4:['Upper R1 loser','Upper R1 loser'],5:['Upper R1 winner','Upper R1 winner'],6:['Lower R1 winner','Lower R1 winner'],7:['Lower R2 winner','Upper Final loser']};
  const gslRound = (rd, pfx, drop)=>`<div class="bkt-round"><div class="bkt-round-title${drop?' gsl-drop':''}">${esc(rd.title)}</div>
      <div class="bkt-round-matches">${rd.matches.map(m=>treeMatch(m,pfx,null,null,{tbd:GSL_TBD[m.i]})).join("")}</div></div>`;
  // one group's card: upper bracket and who's through on top, the lower bracket under it (the arrows mark rounds teams drop into)
  const gslCard = st=>{ const pfx=st.id+"-", rd=n=>(st.rounds||[]).find(r=>r.round===n),
      won=x=>{ const m=x.matches[0]; return m.w===1?[m.a,m.aTeam]:m.w===2?[m.b,m.bTeam]:['',null]; },
      [up,upT]=won(rd(3)), [lo,loT]=won(rd(5)), box={tbd:['Upper Final winner','Lower Final winner'], box:true};
    return `<section class="gsl-card"><div class="gsl-card-h">${esc(st.name)}</div>
      <div class="bkt-wrap"><div class="bkt"><svg class="bkt-svg"></svg>${gslRound(rd(1),pfx)}${gslRound(rd(3),pfx)}
        <div class="bkt-round"><div class="bkt-round-title">To Playoffs</div><div class="bkt-round-matches"><div class="bkt-match gsl-qbox">${treeTeam({a:up,aTeam:upT},'a',box)}${treeTeam({b:lo,bTeam:loT},'b',box)}</div></div></div></div></div>
      <div class="bkt-wrap"><div class="bkt"><svg class="bkt-svg"></svg>${gslRound(rd(2),pfx,true)}${gslRound(rd(4),pfx)}${gslRound(rd(5),pfx,true)}</div></div></section>`; };

  let bracketBlock;
  if(tr.stages && tr.stages.length){
    bracketBlock = (tr.formatNote&&tr.stages.some(s=>s.format==="ext_gsl")?`<div class="gsl-note">${esc(tr.formatNote)}</div>`:'') + tr.stages.map(st=>{
      const pfx = st.id + "-";
      const head = `<h2 class="section-title" style="margin-top:20px"><span class="accent-bar"></span>${esc(st.name)}
        <span class="muted" style="font-size:11px">${fmtLabel(st.format)}${st.bestOf>1?' · Bo'+st.bestOf:''}</span></h2>`;
      if(st.format==="single_elim") return head + treeSection("", st.rounds, pfx, true) + thirdPlaceBox(st.rounds, pfx);
      if(st.format==="ext_gsl"){ const gs=tr.stages.filter(s=>s.format==="ext_gsl"); if(st!==gs[0]) return '';   // all the groups share one grid
        return `<h2 class="section-title" style="margin-top:20px"><span class="accent-bar"></span>Group Stage
          <span class="muted" style="font-size:11px">${fmtLabel(st.format)}${st.bestOf>1?' · Bo'+st.bestOf:''}</span></h2><div class="gsl-grid">${gs.map(gslCard).join("")}</div>`; }
      return head + stageStandings(st) + listRounds(st.rounds, pfx);
    }).join("");
  } else if(isElim){
    const pos = tr.bracket.filter(r=>r.round>0), neg = tr.bracket.filter(r=>r.round<0);
    bracketBlock = neg.length
      ? treeSection("Upper Bracket", pos) + treeSection("Lower Bracket", neg)   // double-elim: positional connectors
      : treeSection("", pos, "", true);
  } else {
    bracketBlock = listRounds(tr.bracket);
  }

  // teams-attending logo wall
  const wall = (tr.attending||[]).map(row=>{
    // a slot still to be decided: another event's place-N team (e.g. Challengers Stage #3)
    if(row.tbc) return `<a class="aw-tile aw-tbc" href="#/tournament/${esc(row.tbc.slug)}"${rAttr(row.team,null)}>
        <span class="aw-noimg">?</span><span class="aw-txt"><span class="aw-name">TBC</span><span class="aw-from">${esc(row.tbc.short)} #${row.tbc.place}</span></span></a>`;
    const t = row.teamSlug ? teamBySlug(row.teamSlug) : null;
    const logo = nationCrest(row.team,22) || (t&&t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span class="aw-noimg">${initials(row.team)}</span>`);
    const sub = row.via ? `<span class="aw-from" title="${esc(`The #${row.via.place} team of the ${row.via.name}`)}">via ${esc(row.via.short)} #${row.via.place}</span>`
      : row.inviteRank ? `<span class="aw-from" title="Invited as BPL ranking #${row.inviteRank}">BPL #${row.inviteRank}</span>` : '';
    const inner = `${logo}${sub?`<span class="aw-txt"><span class="aw-name">${esc(row.team)}</span>${sub}</span>`:`<span class="aw-name">${esc(row.team)}</span>`}`;
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
      <td><span class="fs-result ${fsResultCls(s.result)}">${esc(s.result)}</span></td>${prizeCell(s)}</tr>`;
  // final leaderboard (no playoff games): the top teams of every group ranked on their group results
  const lb = tr.leaderboard;
  const lbSection = (lb && lb.rows && lb.rows.length) ? (()=>{
    const fsBy = {}; fs.forEach(s=>fsBy[normKey(s.name)]=s);
    const rdiff = r=>r.rf-r.ra, sgn = v=>v>0?'+'+v:String(v);
    const mapTb = r=>r.tiebreak==='map difference';
    const rows = lb.rows.map(r=>{ const st = fsBy[normKey(r.name)] || {rank:r.rank, name:r.name};
      const badge = lb.complete ? (r.rank===1?'<span class="fs-result fs-champ">Champion</span>':'') : '';
      return `<tr class="${r.rank===1&&lb.complete?'lb-champ':''}">
        <td class="rankcol fs-rank">${lb.complete&&r.rank<=3?fsMedal(r.rank)+' ':''}${r.rank}</td>
        <td class="name-cell">${crest(r.name, r.teamSlug)} ${badge}</td>
        <td class="muted">${esc(r.group)} · ${placeOrd(r.groupPlace)}</td>
        <td class="mono lb-rec">${r.w}-${r.l}</td>
        <td class="mono" title="${r.mw} maps won, ${r.ml} lost${mapTb(r)?' · tie broken by map difference':''}">${r.mw}-${r.ml}${mapTb(r)?' <span class="lb-tb">TB</span>':''}</td>
        <td class="mono" style="color:${rdiff(r)>0?'var(--good)':rdiff(r)<0?'var(--accent2)':'var(--muted)'}" title="${r.rf} rounds won, ${r.ra} lost${r.tiebreak&&!mapTb(r)?` · tie broken by ${r.tiebreak}`:''}">${sgn(rdiff(r))}${r.tiebreak&&!mapTb(r)?' <span class="lb-tb">TB</span>':''}</td>
        ${lb.complete&&hasPrizes?prizeCell({rank:st.rank, name:st.name}):''}</tr>`; }).join("");
    return `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>${lb.complete?'Final Leaderboard':'Projected Leaderboard'}
        <span class="muted" style="font-size:11px">${lb.complete?`top ${lb.perGroup} of each group, ranked on their group results · #1 is the champion${hasPrizes?' · '+fmtUSD(tr.prizePool)+' prize pool':''}`
          :`the current top ${lb.perGroup} of each group · updates with every result · final once all groups finish`}</span></h2>
      <div class="tablewrap fs-wrap lb-wrap"><table class="data fs-table lb-table">
        <thead><tr><th class="no-sort">#</th><th class="no-sort">Team</th><th class="no-sort">Group</th><th class="no-sort">Record</th><th class="no-sort">Maps</th><th class="no-sort" title="Round difference across all their group games">Rounds</th>${lb.complete&&hasPrizes?'<th class="no-sort" style="text-align:right">Prize</th>':''}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${!lb.complete&&lb.pending&&lb.pending.length?`<div class="muted" style="font-size:12px;margin-top:6px">${esc(lb.pending.join(", ").replace(/, ([^,]*)$/," and $1"))} ${lb.pending.length===1?"hasn't":"haven't"} started yet: their top ${lb.perGroup} join the table once they play.</div>`:''}
      <div class="muted" style="font-size:11px;margin-top:6px">${lb.tiebreak==='maps'
        ?'Ranked by wins, then losses, then map difference, then round difference. The group tables use the same order. TB = tie broken.'
        :'Ranked by wins, then losses, then round difference. Tied teams from the same group keep their group order (head-to-head, then rounds). TB = tie broken.'}</div>`; })()
    // no group has played yet: say up front that the event ends on one leaderboard, not a playoff bracket
    : lb ? `<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Final Leaderboard</h2>
      <div class="notice" style="text-align:left">No playoffs: the top ${lb.perGroup} of each group (${lb.perGroup*(tr.stages||[]).filter(s=>s.format==='swiss').length} teams) go onto one leaderboard, ranked on their group results. #1 is the champion. It fills in from the first result.</div>` : '';
  const fsPlayoff = fs.filter(s=>s.result!=='Group Stage');
  const fsGroup = fs.filter(s=>s.result==='Group Stage');
  const finalStandingsSection = lb ? (lbSection + (fsGroup.length&&lb.complete?`<details class="fs-details"><summary>Group stage — ${fsGroup.length} teams that didn't qualify</summary>
       <div class="tablewrap fs-wrap${hasPrizes?' fs-prize':''}"><table class="data fs-table"><tbody>${fsGroup.map(fsRow).join("")}</tbody></table></div></details>`:'')) : fs.length ? `
    <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Final Standings${hasPrizes?`
      <span class="muted" style="font-size:11px">${fmtUSD(tr.prizePool)} prize pool · split equally between each team's players</span>`:''}</h2>
    <div class="tablewrap fs-wrap${hasPrizes?' fs-prize':''}"><table class="data fs-table"><tbody>${fsPlayoff.map(fsRow).join("")}</tbody></table></div>
    ${fsGroup.length?`<details class="fs-details"><summary>Group stage — ${fsGroup.length} teams that didn't advance</summary>
       <div class="tablewrap fs-wrap${hasPrizes?' fs-prize':''}"><table class="data fs-table"><tbody>${fsGroup.map(fsRow).join("")}</tbody></table></div></details>`:''}` : '';

  const upcoming = !!(tr.field&&tr.field.length) && !(tr.stages&&tr.stages.length);
  const tbcLeft = (tr.attending||[]).filter(r=>r.tbc);
  const upcomingSection = upcoming ? `<div class="ev-upcoming">
      <div class="evu-head"><span class="evu-pill">Upcoming</span> Starts ${fmtDate(tr.date)}</div>
      ${tr.formatNote?`<p>${esc(tr.formatNote)}</p>`:''}
      ${tbcLeft.length?`<p class="muted">${tbcLeft.length} place${tbcLeft.length===1?'':'s'} still to be decided: ${[...new Set(tbcLeft.map(r=>r.tbc.slug))].map(sl=>{
        const r=tbcLeft.find(x=>x.tbc.slug===sl); const n=tbcLeft.filter(x=>x.tbc.slug===sl).length;
        return `the top ${n} of the <a href="#/tournament/${esc(sl)}">${esc(r.tbc.name)}</a>`; }).join(' and ')} (marked TBC below, filled in when it ends).</p>`:''}
    </div>` : '';
  app.innerHTML = `
    <div class="crumb"><a href="#/tournaments">Tournaments</a><span class="sep">/</span>${esc(tr.name)}</div>
    <div class="profile-head">
      <div class="ph-main">
        <h1>${esc(tr.name)} ${tierBadgeEvent(tr)}</h1>
        <div class="ph-sub">${fmtDate(tr.date)} · ${tr.format} · ${tr.participantCount} teams${LIVE.seen[tr.slug]?' · '+livePill(tr.slug):''}</div>
        ${tr.prizePool||_adminOn?`<div class="tp-prize">Prize pool: <b>${tr.prizePool?fmtUSD(tr.prizePool):'<span class="muted">not set</span>'}</b>
          ${_adminOn?`<span class="tp-edit"><input id="tp-prize" class="adm-in" inputmode="numeric" value="${tr.prizePool||''}" placeholder="$ prize pool" title="${esc(PRIZE_HINT)}"><button id="tp-prize-save" class="loadmore">Save</button><span id="tp-prize-msg" class="muted"></span></span>`:''}</div>`:''}
        ${upcoming ? '' : `<div style="margin-top:12px;font-size:15px">${champLabel(tr)}:
          <strong style="font-size:18px;font-family:'Chakra Petch'">${crest(tr.champion, tr.championTeam)}</strong></div>`}
        ${tr.mvp ? `<div class="tourn-mvp">⭐ <span class="muted">${tr.champion?'Tournament MVP':'MVP so far'}:</span>
          <a href="#/player/${tr.mvp.slug}" class="tm-mvp-name">${flag(tr.mvp.iso)}${esc(tr.mvp.name)}</a>
          <span class="muted" style="font-size:12px">${tr.mvp.rating!=null?`${tr.mvp.rating.toFixed(2)} rating over ${tr.mvp.maps} maps`:`${tr.mvp.mvpRounds} MVP round${tr.mvp.mvpRounds===1?'':'s'}`}${tr.mvp.team&&tr.mvp.team!=='—'?' · '+esc(tr.mvp.team):''}</span></div>` : ''}
        ${predSupported(tr) ? `<a class="predict-btn" href="#/predict/${tr.slug}">🔮 ${tr.champion?'Predictions & leaderboard'
          :predPlayoffsOnly(tr)&&!predSeeds(tr,{}).length?'Playoff predictions open after the groups':'Make your predictions'}</a>` : ''}
        ${fantasySupported(tr) ? `<a class="predict-btn fy-btn" href="#/fantasy/${tr.slug}">⚡ ${fantasyLock(tr).locked?'Fantasy leaderboard':'Pick your fantasy team'}</a>` : ''}
      </div>
      ${champT&&champT.logo?`<img class="crest" src="${esc(champT.logo)}" alt="">`:''}
    </div>
    ${tr.stages ? '' : `<div class="profile-grid${hasPrizes?' pg-prize':''}">
      <div class="infobox">
        <div class="ib-title">Final Standings${prizeNote}</div>
        <div class="tablewrap" style="border:0;border-radius:0"><table class="data">
          <tbody>${standRows}</tbody></table></div>
      </div>
      <div>${wallSection || (tr.manual?'':'<div class="muted">No roster data.</div>')}</div>
    </div>
    <h2 class="section-title" style="margin-top:24px"><span class="accent-bar"></span>${isElim?'Bracket':'Match Results'}</h2>`}
    ${upcomingSection}
    ${tr.stages ? finalStandingsSection : ''}
    ${tr.stages ? wallSection : ''}
    ${upcoming ? '' : bracketBlock}`;

  // draw bracket connector lines once laid out
  drawAllConnectors(document);
  const tps = $("#tp-prize-save");
  if(tps) tps.onclick = async ()=>{
    $("#tp-prize-msg").textContent = "Saving…";
    const r = await apiPost("/api/prizepools", {pools:{[tr.slug]: parseUSD($("#tp-prize").value)||null}});
    if(r.ok){ await reloadData(); renderTournament(slug); } else $("#tp-prize-msg").textContent = "Error: "+(r.error||r.msg||"failed");
  };
  // click a match: played matches open an HLTV-style card; unplayed jump to the match page.
  // (team-name links still work; they navigate to the team page.)
  app.querySelectorAll("[data-match]").forEach(el=>el.addEventListener("click", e=>{
    if(e.target.closest("a")) return;
    const ref = el.dataset.match;
    const {match} = findMatchByRef(tr, ref);
    if(match && match.stats && (match.stats.maps||[]).length){
      showMatchCard(matchCardHTML(tr, match, ref));
    } else {
      location.hash = `#/match/${slug}/${ref}`;
    }
  }));
}

function drawConnectors(bkt){
  const svg = bkt.querySelector(".bkt-svg");
  if(!svg) return;
  const brect = bkt.getBoundingClientRect();
  const px = el=>{ const r=el.getBoundingClientRect(); return {x1:r.left-brect.left, x2:r.right-brect.left, y:r.top-brect.top+r.height/2}; };
  const seg = (a,b)=>{ const midX=(a.x2+b.x1)/2; return `<path d="M${a.x2} ${a.y} H${midX} V${b.y} H${b.x1}" fill="none" stroke="var(--border2)" stroke-width="2"/>`; };
  let paths = "";
  if(bkt.querySelector(".bkt-match[data-round]")){
    // slot-aware: match at (round r, slot s) feeds (round r+1, slot floor(s/2)).
    // correct even when byes are hidden and rounds don't halve on screen.
    const byRS = {};
    bkt.querySelectorAll(".bkt-match[data-round]").forEach(el=>{ byRS[el.dataset.round+":"+el.dataset.slot]=el; });
    bkt.querySelectorAll(".bkt-match[data-round]").forEach(el=>{
      const parent = byRS[(+el.dataset.round+1)+":"+Math.floor(+el.dataset.slot/2)];
      if(parent) paths += seg(px(el), px(parent));
    });
  } else {
    // positional fallback (double-elim losers brackets)
    const rounds = [...bkt.querySelectorAll(".bkt-round-matches")];
    for(let c=0;c<rounds.length-1;c++){
      const cur = [...rounds[c].querySelectorAll(".bkt-match")];
      const nxt = [...rounds[c+1].querySelectorAll(".bkt-match")];
      if(!nxt.length) continue;
      const oneToOne = nxt.length === cur.length;
      cur.forEach((m,i)=>{ const target = nxt[oneToOne ? i : Math.floor(i/2)]; if(target) paths += seg(px(m), px(target)); });
    }
  }
  svg.style.width = bkt.scrollWidth + "px";
  svg.style.height = bkt.scrollHeight + "px";
  svg.innerHTML = paths;
}
// draw connectors reliably: after layout settles (double rAF) + a delayed retry for late layout
function drawAllConnectors(root){
  const run=()=>(root||document).querySelectorAll(".bkt").forEach(drawConnectors);
  requestAnimationFrame(()=>{ run(); requestAnimationFrame(run); });
  setTimeout(run, 140);
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
    // humans and league admins (Solo Queue only): found by name, by their in-game name, or by typing "admin" / "human"
    ...(DATA.soloHumans||[]).map(h=>({name:h.name, type:h.kind==="admin"?"Admin":"Human", href:`#/human/${h.slug}`, iso:h.iso,
      sub:h.ingame&&h.ingame.length?`plays as ${h.ingame.join(", ")}`:"Solo Queue",
      terms:[h.name, ...(h.ingame||[]), h.kind==="admin"?"admin":"human"]})),
  ];
  const seen=new Set(); const uniq=index.filter(x=>{const k=x.href;if(seen.has(k))return false;seen.add(k);return true;});
  function run(){
    const q = input.value.trim().toLowerCase();
    if(q.length<2){ box.classList.remove("show"); return; }
    const match = x=>(x.terms||[x.name]).some(t=>String(t).toLowerCase().includes(q));
    const starts = x=>(x.terms||[x.name]).some(t=>String(t).toLowerCase().startsWith(q)) ? 0 : 1;
    const hits = uniq.filter(match).map((x,i)=>({x,i,s:starts(x)})).sort((a,b)=>a.s-b.s||a.i-b.i).map(o=>o.x).slice(0,8);
    if(!hits.length){ box.innerHTML=`<a class="muted" style="pointer-events:none">No matches</a>`; box.classList.add("show"); return; }
    box.innerHTML = hits.map(h=>`<a href="${h.href}">${h.logo?`<img src="${esc(h.logo)}" style="height:20px;width:20px;object-fit:contain">`:h.iso?flag(h.iso):''}
      <span>${esc(h.name)}${h.sub?` <span class="muted" style="font-size:11px">${esc(h.sub)}</span>`:''}</span>
      <span class="sr-type${h.type==="Admin"?" sr-admin":h.type==="Human"?" sr-human":""}">${h.type}</span></a>`).join("");
    box.classList.add("show");
  }
  input.addEventListener("input", run);
  input.addEventListener("focus", run);
  document.addEventListener("click", e=>{ if(!e.target.closest(".search")) box.classList.remove("show"); });
  box.addEventListener("click", ()=>{ box.classList.remove("show"); input.value=""; });
}

// ================= FIREBASE (shared loader) =================
// Predictions, fantasy and live scores share one Firebase app. The SDK is only loaded when a page needs it.
const FB_V = "10.12.2";
let _fbReady = null, _fbAuthReady = null;
function fbScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
function fbLoad(){
  if(_fbReady) return _fbReady;
  const cfg = window.BPL_FIREBASE || {};
  _fbReady = !(cfg.apiKey && cfg.projectId) ? Promise.resolve(null)
    : fbScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-app-compat.js`)
        .then(()=>fbScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-firestore-compat.js`))
        .then(()=>{ if(!firebase.apps.length) firebase.initializeApp(cfg); return firebase.firestore(); });
  return _fbReady;
}
function fbAuth(){
  if(_fbAuthReady) return _fbAuthReady;
  _fbAuthReady = fbLoad().then(db=>db ? fbScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-auth-compat.js`).then(()=>firebase.auth()) : null);
  return _fbAuthReady;
}
function fbUser(auth){ return new Promise(r=>{ const un=auth.onAuthStateChanged(u=>{ un(); r(u); }); }); }

// ================= LIVE SCORES =================
// A score entered in admin reaches the public site within seconds, without a Publish. After each change the
// admin page writes that event's freshly built tournament (from its local data.json) to Firestore live/<slug>.
// Every open page swaps it in while it is newer than the published data.json (builtAt), so brackets, group
// tables and the leaderboard all move. The next Publish makes data.json newer again and the live copy is ignored.
// Player and team stats, Elo and rankings still update at Publish.
const LIVE = {seen:{}, pending:false};
const LIVE_PATHS = /^\/api\/(score|matchstats|match\/|stage\/|round\/|complete|predlock)/;
const LIVE_ROUTES = ["home","matches","results","tournament","match"];
function liveStart(){
  if(_adminOn) return;                                    // admin has the fresh local data already
  const slugs = (DATA.tournaments||[]).filter(t=>t.stages && !t.champion).map(t=>t.slug);
  if(!slugs.length) return;
  fbLoad().then(db=>{ if(!db) return;
    slugs.forEach(s=>db.collection('live').doc(s).onSnapshot(snap=>liveApply(snap.exists?snap.data():null), ()=>{}));
  }).catch(()=>{});
}
function liveApply(doc){
  if(!doc || !doc.json || !doc.slug) return;
  if((doc.builtAt||0) <= (DATA.builtAt||0)) return;      // the published data.json already has this
  if((LIVE.seen[doc.slug]||0) >= doc.builtAt) return;
  let tr; try{ tr = JSON.parse(doc.json); }catch(e){ return; }
  const i = DATA.tournaments.findIndex(t=>t.slug===doc.slug); if(i<0) return;
  if(doc.noStats) liveKeepStats(DATA.tournaments[i], tr);
  liveKeepModel(DATA.tournaments[i], tr);
  DATA.tournaments[i] = tr; LIVE.seen[doc.slug] = doc.builtAt;
  _allMatches = null; _allMapScores = null; _rivals = null;
  liveRerender();
}
// a very large event is sent without its scoreboards: keep the ones this page already has
function liveKeepStats(old, tr){
  const key = (st,m)=>st.id+'-'+m.i, had = {};
  (old.stages||[]).forEach(st=>st.rounds.forEach(rd=>rd.matches.forEach(m=>{ if(m.stats) had[key(st,m)] = m.stats; })));
  (tr.stages||[]).forEach(st=>st.rounds.forEach(rd=>rd.matches.forEach(m=>{ if(!m.stats && had[key(st,m)]) m.stats = had[key(st,m)]; })));
}
// an admin page on an older build sends the event without the playoff-chance inputs: keep this page's
function liveKeepModel(old, tr){
  for(const k of ['chanceModel', 'groupTiebreak']) if(tr[k]==null && old[k]!=null) tr[k] = old[k];
  const rounds = {}; (old.stages||[]).forEach(st=>{ if(st.swissRounds) rounds[st.id] = st.swissRounds; });
  (tr.stages||[]).forEach(st=>{ if(!st.swissRounds && rounds[st.id]) st.swissRounds = rounds[st.id]; });
}
function liveRerender(){
  const {route, arg} = parseHash();
  if(!LIVE_ROUTES.includes(route)) return;
  const a = document.activeElement;
  if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){ LIVE.pending = true; return; }   // don't wipe what they're typing
  LIVE.pending = false;
  const y = window.scrollY;
  PAGE_ROSTERS = []; PAGE_MAPSCORES = [];
  (routes[route]||renderHome)(arg);
  liveMarkUpdate();
  window.scrollTo(0, y);
}
document.addEventListener("focusout", ()=>setTimeout(()=>{ if(LIVE.pending) liveRerender(); }, 50));
function livePill(slug){
  const at = LIVE.seen[slug]; if(!at) return '';
  const mins = Math.max(0, Math.round((Date.now()-at)/60000));
  return `<span class="live-pill" title="Scores on this page update live, ahead of the next full site update">● LIVE</span><span class="live-ago">updated ${mins<1?'just now':mins+' min ago'}</span>`;
}

// ---- admin side: send changed events live ----
const LivePush = {dirty:new Set()};
function livePushOn(){ try{ return localStorage.getItem('bpl_live_send')!=='0'; }catch(e){ return true; } }
function liveToast(msg, bad){
  let el = $("#live-toast");
  if(!el){ el = document.createElement("div"); el.id = "live-toast"; document.body.appendChild(el); }
  el.className = bad ? "bad show" : "show"; el.textContent = msg;
  clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove("show"), bad?6000:2600);
}
async function livePushDirty(){
  if(!_adminOn || !LivePush.dirty.size) return;
  const slugs = [...LivePush.dirty]; LivePush.dirty.clear();
  if(!livePushOn()) return;
  let auth, user;
  try{ auth = await fbAuth(); if(!auth) return; user = await fbUser(auth); }catch(e){ return; }
  if(!user) return;                                       // not signed in: nothing goes live
  const db = await fbLoad();
  for(const slug of slugs){
    const tr = (DATA.tournaments||[]).find(t=>t.slug===slug); if(!tr) continue;
    let json = JSON.stringify(tr), noStats = false;
    if(json.length > 900000){
      const lite = JSON.parse(json);
      (lite.stages||[]).forEach(st=>st.rounds.forEach(rd=>rd.matches.forEach(m=>{ delete m.stats; })));
      json = JSON.stringify(lite); noStats = true;
    }
    if(json.length > 1000000){ liveToast(`${tr.name} is too big to send live`, true); continue; }
    try{
      await db.collection('live').doc(slug).set({slug, builtAt: DATA.builtAt||Date.now(), json, noStats,
        at: firebase.firestore.FieldValue.serverTimestamp()});
      liveToast(`● Sent live: ${tr.name}`);
      LIVE.lastPush = {name: tr.name, at: Date.now()};
      const st = $("#lv-last"); if(st) st.textContent = `Last sent: ${tr.name}, just now`;
    }catch(e){
      liveToast(/permission/i.test(e.message||'') ? "Live send blocked: finish step 2 in Admin → Live scores" : "Live send failed: "+(e.message||e), true);
    }
  }
}
// ---- live map scores from the BPL Bots app (round by round) ----
// The app (http://127.0.0.1:8760) knows the score of a BPL match being played in CS:GO. While this
// signed-in admin page is open it relays that to Firestore live/m--<slug>--<ref>; the match page
// shows it as a LIVE panel. When the app sends a finished map to the match page, the event is
// pushed live as usual, so the series score and map scoreboards update too.
const LiveRelay = {key:null, statsKey:null, at:0, doc:null, upload:0, seen:false, timer:null, state:'', busy:0};
function liveRelayOn(){ try{ return localStorage.getItem('bpl_live_relay')!=='0'; }catch(e){ return true; } }
function botsPort(){ try{ return +localStorage.getItem('bpl_bots_port') || 8760; }catch(e){ return 8760; } }
function liveRelayShow(text){ LiveRelay.state = text; const el = $("#lv-relay-state"); if(el) el.textContent = text; }
async function liveRelayTick(){
  if(!_adminOn) return;
  let lv = null;
  try{ lv = await (await fetch(`http://127.0.0.1:${botsPort()}/api/live`, {cache:'no-store'})).json(); }catch(e){}
  const localKey = lv && lv.live ? JSON.stringify([lv.slug, lv.ref, lv.mapNo, lv.scoreA, lv.scoreB, lv.seriesA, lv.seriesB]) : '';
  if(localKey !== LIVE_M.localKey){ LIVE_M.localKey = localKey; LIVE_M.local = localKey ? lv : null; liveMarkUpdate(); }
  if(!lv){ liveRelayShow('BPL Bots app not running'); return; }
  // a finished map just reached a match page: reload and push that event live
  const upAt = lv.lastUpload ? lv.lastUpload.at : 0;
  if(!LiveRelay.seen){ LiveRelay.seen = true; LiveRelay.upload = upAt; }       // ignore uploads from before this page opened
  else if(upAt > LiveRelay.upload){
    LiveRelay.upload = upAt;
    if(livePushOn()){ LivePush.dirty.add(lv.lastUpload.slug); reloadData(); }
  }
  if(!livePushOn() || !liveRelayOn()){ liveRelayShow(lv.live ? 'BPL match running, relay paused' : 'Relay paused'); return; }
  if(!lv.live && !LiveRelay.doc){ liveRelayShow(lv.game ? 'Game running, not a BPL match' : 'Waiting for a BPL match in the app'); return; }
  let db = null;
  try{ const auth = await fbAuth(); const u = auth && await fbUser(auth); db = u ? await fbLoad() : null; }catch(e){}
  if(!db){ liveRelayShow('Sign in above to relay live scores'); return; }
  const now = Date.now();
  try{
    if(lv.live){
      const key = JSON.stringify([lv.mapNo, lv.scoreA, lv.scoreB, lv.seriesA, lv.seriesB, lv.mapOver, lv.warmup, lv.aSide]);
      const statsKey = JSON.stringify(lv.players);
      // the score: straight away; kills/deaths: at most every 10 s; otherwise a heartbeat each minute
      if(key===LiveRelay.key && (statsKey===LiveRelay.statsKey || now-LiveRelay.at<10000) && now-LiveRelay.at<60000) return;
      const id = `m--${lv.slug}--${lv.ref}`;
      await db.collection('live').doc(id).set({kind:'match', slug:lv.slug, ref:lv.ref, ended:false, sent:now,
        json: JSON.stringify(lv), at: firebase.firestore.FieldValue.serverTimestamp()});
      Object.assign(LiveRelay, {key, statsKey, at:now, doc:id});
      liveRelayShow(`Sending ${lv.a} vs ${lv.b} · map ${lv.mapNo} (${lv.map}) ${lv.scoreA}–${lv.scoreB}`);
    }else{
      await db.collection('live').doc(LiveRelay.doc).set({ended:true, sent:now, at: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
      Object.assign(LiveRelay, {key:null, statsKey:null, doc:null});
      liveRelayShow('Match no longer live');
    }
  }catch(e){
    liveRelayShow(/permission/i.test(e.message||'') ? 'Blocked: do step 2 below' : 'Relay failed: '+(e.message||e));
  }
}
// Chrome and Edge run a page's own timers only once a minute after it has been hidden for 5 minutes (say, CS:GO
// in front of the admin window on a one-screen laptop), which stalled the relay. A worker's timer isn't slowed
// like that, so a tiny worker sets the pace and the page does the work when it hears from it.
function liveRelayStart(){
  if(!_adminOn || LiveRelay.timer) return;
  const tick = ()=>{
    if(LiveRelay.busy && Date.now()-LiveRelay.busy < 30000) return;     // the last one is still waiting on the network
    LiveRelay.busy = Date.now();
    liveRelayTick().catch(()=>{}).finally(()=>{ LiveRelay.busy = 0; });
  };
  try{
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0), 4000)'], {type:'text/javascript'})));
    w.onmessage = tick; LiveRelay.timer = w;
  }catch(e){ LiveRelay.timer = setInterval(tick, 4000); }
}

// public match page: the LIVE panel
let _liveMatchUnsub = null;
function liveMatchWatch(slug, ref){
  if(_liveMatchUnsub){ _liveMatchUnsub(); _liveMatchUnsub = null; }
  if(!slug) return;
  fbLoad().then(db=>{ if(!db) return;
    const want = location.hash;
    _liveMatchUnsub = db.collection('live').doc(`m--${slug}--${ref}`).onSnapshot(snap=>{
      if(location.hash !== want) return;
      liveMatchRender(snap.exists ? snap.data() : null);
    }, ()=>{});
  }).catch(()=>{});
}
function liveMatchRender(doc){
  const box = $("#m-live"); if(!box) return;
  let lv = null;
  // stale after 3 minutes without an update (the relay sends at least once a minute)
  if(doc && !doc.ended && doc.json && Date.now()-(doc.sent||0) < 180000){ try{ lv = JSON.parse(doc.json); }catch(e){} }
  streamBoxUpdate(lv);
  if(!lv){ box.innerHTML = ''; return; }
  const sideTag = s=>`<span class="ml-side ${s==='CT'?'ct':'t'}">${s}</span>`;
  const bSide = lv.aSide==='CT' ? 'T' : 'CT';
  const team = k=>{
    const rows = lv.players.filter(p=>p.team===k).map(p=>`<tr class="${p.alive?'':'ml-dead'}"><td><span class="ml-dot ${p.alive?'on':''}"></span>${esc(p.name)}</td><td>${p.k}</td><td>${p.a}</td><td>${p.d}</td></tr>`).join('');
    return `<table class="ml-sb"><thead><tr><th>${esc(k==='a'?lv.a:lv.b)}</th><th>K</th><th>A</th><th>D</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  const done = (lv.maps||[]).map((m,i)=>`<span class="ml-map">Map ${i+1} ${esc(m.map)} <b>${m.scoreA}–${m.scoreB}</b></span>`).join('');
  box.innerHTML = `<div class="m-live">
    <div class="ml-head"><span class="live-pill">● LIVE</span>
      <span>Map ${lv.mapNo}${lv.bestOf>1?' of '+lv.bestOf:''} · ${esc(lv.map)}</span>
      <span class="muted">${lv.mapOver ? 'map over' : lv.warmup ? 'warmup' : 'round '+lv.round}</span>
      ${lv.bestOf>1?`<span class="muted ml-series">Series ${lv.seriesA}–${lv.seriesB}</span>`:''}</div>
    <div class="ml-score"><span class="ml-team">${esc(lv.a)} ${sideTag(lv.aSide)}</span><b>${lv.scoreA}</b><span class="ml-colon">:</span><b>${lv.scoreB}</b><span class="ml-team r">${sideTag(bSide)} ${esc(lv.b)}</span></div>
    ${done?`<div class="ml-maps">${done}</div>`:''}
    <div class="ml-sbs">${team('a')}${team('b')}</div>
  </div>`;
}

// ---- the stream, on the page of the match being played ----
// While a match is live (the relay above), its page loads the Twitch player out of sight. The player
// says straight away whether the channel is on air (ONLINE / OFFLINE, checked 2026-11-06), and the
// box only opens while it is: no stream, no box. The channel is the one connected in the BPL Bots
// app (lv.twitch, sent with the live score), else the BPL channel.
const STREAM_CHANNEL = 'cgrycei';
let _twitchJs = null;
function twitchPlayerJs(){
  if(window.Twitch && window.Twitch.Player) return Promise.resolve();
  return _twitchJs || (_twitchJs = new Promise((ok, bad)=>{
    const s = document.createElement('script'); s.src = 'https://player.twitch.tv/js/embed/v1.js'; s.async = true;
    s.onload = ()=>ok(); s.onerror = ()=>{ _twitchJs = null; bad(new Error('Twitch player blocked')); };
    document.head.appendChild(s);
  }));
}
let _streamOn = '';      // the channel last seen on air: a redrawn match page (after each map) reopens it at once
function streamBoxUpdate(lv){
  const box = $("#m-stream"); if(!box) return;
  // not on the admin page: that runs on the PC that is streaming
  const ch = lv && !_adminOn ? String(lv.twitch || STREAM_CHANNEL).toLowerCase().replace(/[^a-z0-9_]/g, '') : '';
  if(box.dataset.channel === ch) return;            // already set up (or already empty)
  box.dataset.channel = ch;
  const show = on=>{ box.classList.toggle('on', on); box.inert = !on; };
  show(false); box.innerHTML = '';
  if(!ch){ _streamOn = ''; return; }
  const wasOn = _streamOn === ch;
  box.innerHTML = `<div class="ms-head"><span class="live-pill">● LIVE</span><span>On stream now</span>
      <a class="ms-open" href="https://www.twitch.tv/${ch}" target="_blank" rel="noopener">twitch.tv/${ch} ↗</a></div>
    <div class="ms-frame"><div id="ms-player"></div></div>`;
  if(wasOn) show(true);
  twitchPlayerJs().then(()=>{
    if(!box.isConnected || box.dataset.channel !== ch) return;
    const P = window.Twitch.Player;
    const player = new P('ms-player', {channel: ch, parent: [location.hostname], width: '100%', height: '100%', muted: true, autoplay: wasOn});
    player.addEventListener(P.ONLINE, ()=>{
      _streamOn = ch;
      if(!box.isConnected || box.dataset.channel !== ch) return;
      show(true);
      try{ player.setMuted(true); player.play(); }catch(e){}
    });
    player.addEventListener(P.OFFLINE, ()=>{
      if(_streamOn === ch) _streamOn = '';
      if(!box.isConnected || box.dataset.channel !== ch) return;
      show(false);
      try{ player.pause(); }catch(e){}
    });
  }).catch(()=>{ if(box.isConnected) show(false); });
}

// ---- live matches in round lists and brackets ----
// Matches being played right now in the BPL Bots app (Firestore live/m--…, written by the admin
// relay above; the admin page also knows its own relay directly). Tournament pages mark them with a
// LIVE bar, and the match page header says LIVE instead of "not played".
const LIVE_M = {fs: new Map(), local: null, localKey: '', started: false};
function liveMatchesStart(){
  if(LIVE_M.started) return; LIVE_M.started = true;
  if(!(DATA.tournaments||[]).some(t=>t.stages && !t.champion)) return;
  fbLoad().then(db=>{ if(!db) return;
    db.collection('live').where('kind','==','match').onSnapshot(qs=>{
      const fs = new Map();
      qs.forEach(d=>{ const x = d.data();
        if(x && !x.ended && x.json){ try{ fs.set(`${x.slug}|${x.ref}`, {sent:x.sent||0, lv:JSON.parse(x.json)}); }catch(e){} } });
      LIVE_M.fs = fs; liveMarkUpdate();
    }, ()=>{});
  }).catch(()=>{});
  setInterval(liveMarkUpdate, 30000);   // a relay that stopped without saying so goes stale after 3 min
}
function liveMatchesNow(){
  const now = Date.now(), out = new Map();
  LIVE_M.fs.forEach((v,k)=>{ if(now - v.sent < 180000) out.set(k, v.lv); });
  if(LIVE_M.local) out.set(`${LIVE_M.local.slug}|${LIVE_M.local.ref}`, LIVE_M.local);
  return out;
}
function liveMarkUpdate(){
  const {route, arg} = parseHash();
  if(route !== 'tournament' && route !== 'match') return;
  const live = liveMatchesNow();
  if(route === 'tournament'){
    // HLTV-style: a red LIVE strip on top, each team's score on the current map on its own row
    // (green ahead, red behind) with maps won in brackets.
    app.querySelectorAll('[data-match]').forEach(el=>{
      const lv = live.get(`${arg}|${el.dataset.match}`);
      const scores = [...el.querySelectorAll('.bscore, .bt-score')];   // team a's row, then team b's
      let head = el.querySelector('.bm-livehead');
      el.classList.toggle('is-live', !!lv);
      if(!lv){
        if(head) head.remove();
        scores.forEach(sp=>{ if(sp.dataset.was!=null){ sp.innerHTML = sp.dataset.was; delete sp.dataset.was; } });
        return;
      }
      if(!head){ head = document.createElement('div'); head.className = 'bm-livehead'; el.prepend(head); }
      head.innerHTML = `<span class="bm-lh-live"><span class="bm-live-dot"></span>LIVE</span>
        <span class="bm-lh-map">Map ${lv.mapNo}${lv.map?' · '+esc(lv.map):''}</span>
        <a class="bm-lh-watch" href="#/match/${esc(arg)}/${esc(el.dataset.match)}">Watch ▸</a>`;
      const rows = [[lv.scoreA, lv.scoreB, lv.seriesA], [lv.scoreB, lv.scoreA, lv.seriesB]];
      scores.slice(0, 2).forEach((sp, i)=>{
        const [mine, theirs, maps] = rows[i];
        if(sp.dataset.was==null) sp.dataset.was = sp.innerHTML;
        sp.innerHTML = `<span class="lv-rs ${mine>theirs?'lead':mine<theirs?'trail':''}">${mine}</span>${lv.bestOf>1?`<span class="lv-ms">(${maps})</span>`:''}`;
      });
      el.title = `${lv.a} vs ${lv.b}: live now`;
    });
  } else {
    const parts = location.hash.replace(/^#\/?/,"").split("/");
    const lv = live.get(`${parts[1]}|${parts.slice(2).join("/")}`);
    const tag = app.querySelector('.m-mid .m-livetag');
    if(lv && !tag){
      const sub = app.querySelector('.m-mid .muted');      // "not played"
      if(sub){ LIVE_M.wasSub = sub.outerHTML; sub.outerHTML = `<div class="m-livetag"><span class="live-pill">● LIVE</span></div>`; }
    } else if(!lv && tag && LIVE_M.wasSub){ tag.outerHTML = LIVE_M.wasSub; }
    // the maps won so far, straight from the relay (ahead of the next site update)
    const card = app.querySelector('.m-card[data-open]');
    const sc = card ? card.querySelectorAll('.m-side .m-score') : [];
    if(sc.length === 2){
      if(lv && lv.seriesA!=null && lv.seriesB!=null){
        sc.forEach((el, i)=>{ if(el.dataset.was==null) el.dataset.was = el.textContent; el.textContent = i ? lv.seriesB : lv.seriesA; });
      } else sc.forEach(el=>{ if(el.dataset.was!=null){ el.textContent = el.dataset.was; delete el.dataset.was; } });
    }
  }
}

function liveRulesBlock(uid){
  return `    match /live/{doc} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == "${uid}";
    }`;
}
// Always show Google's account picker, so a different account can be chosen (otherwise the popup
// silently reuses whichever Google account the browser is signed in to).
function liveSignIn(auth){
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({prompt: "select_account"});
  return auth.signInWithPopup(p);
}
async function setupLivePanel(){
  const box = $("#adm-live"); if(!box) return;
  const cfg = window.BPL_FIREBASE || {};
  if(!(cfg.apiKey && cfg.projectId)){ box.innerHTML = `<div class="lv-head">📡 Live scores <span class="muted">· needs the Firebase config in js/firebase-config.js</span></div>`; return; }
  box.innerHTML = `<div class="lv-head">📡 Live scores <span class="muted">· connecting…</span></div>`;
  let auth;
  try{ auth = await fbAuth(); }catch(e){ box.innerHTML = `<div class="lv-head">📡 Live scores <span class="muted">· couldn't load Firebase (offline?)</span></div>`; return; }
  const user = await fbUser(auth);
  const on = livePushOn();
  if(!user){
    box.innerHTML = `<div class="lv-head">📡 Live scores <span class="lv-state off">off</span></div>
      <div class="lv-body">
        <p class="muted" style="margin:0 0 10px">Sign in once and every score you save here shows on the public site within seconds, before you Publish. Brackets, groups and the leaderboard update; player stats and rankings wait for Publish.</p>
        <button id="lv-signin" class="adm-btn" style="max-width:230px">Sign in with Google</button>
        <div id="lv-msg" class="muted" style="font-size:12px;margin-top:8px"></div>
        <details class="lv-setup"><summary>First time? One step in the Firebase console</summary>
          <ol><li>Open <a href="https://console.firebase.google.com/project/${esc(cfg.projectId)}/authentication/providers" target="_blank" rel="noopener">Firebase → Authentication → Sign-in method</a> (press <b>Get started</b> if asked), choose <b>Google</b>, switch it on and Save.</li>
          <li>Then come back and press <b>Sign in with Google</b>. Use <b>localhost</b> in the address bar, not 127.0.0.1.</li></ol></details>
      </div>`;
    $("#lv-signin").onclick = async ()=>{
      $("#lv-msg").textContent = "Opening Google sign-in…";
      try{ await liveSignIn(auth); setupLivePanel(); }
      catch(e){
        const c = e.code||'';
        $("#lv-msg").innerHTML = c==='auth/operation-not-allowed' || c==='auth/configuration-not-found' ? "Google sign-in isn't switched on yet: do the step under <b>First time?</b> below."
          : c==='auth/unauthorized-domain' ? "This address isn't allowed: open the admin at <b>http://localhost:8098</b>."
          : c==='auth/popup-closed-by-user' ? "Sign-in window closed."
          : /requests-from-referer/.test(c+(e.message||'')) ? `Your Firebase key only allows certain websites. In <a href="https://console.cloud.google.com/apis/credentials?project=${esc(cfg.projectId)}" target="_blank" rel="noopener">Google Cloud → Credentials</a>, open <b>Browser key (auto created by Firebase)</b>, add <code>${esc(location.origin)}/*</code> and <code>https://${esc(cfg.authDomain||cfg.projectId+'.firebaseapp.com')}/*</code> under Website restrictions, Save, wait ~5 minutes, then try again.`
          : esc(e.message||String(e));
      }
    };
    return;
  }
  box.innerHTML = `<div class="lv-head">📡 Live scores <span class="lv-state ${on?'on':'off'}">${on?'on':'paused'}</span>
      <span class="lv-who">Signed in as <b>${esc(user.email||user.displayName||'?')}</b>
        <button id="lv-switch" class="loadmore">Switch account</button><button id="lv-signout" class="loadmore">Sign out</button></span></div>
    <div class="lv-body">
      <label class="lv-toggle"><input type="checkbox" id="lv-on" ${on?'checked':''}> Send every score I save to the public site straight away</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button id="lv-test" class="loadmore">Test the connection</button>
        <button id="lv-now" class="loadmore">Send running events now</button>
      </div>
      <div id="lv-last" class="muted" style="font-size:12px;margin-top:8px">${LIVE.lastPush?`Last sent: ${esc(LIVE.lastPush.name)}`:''}</div>
      <label class="lv-toggle" style="margin-top:12px"><input type="checkbox" id="lv-relay" ${liveRelayOn()?'checked':''}> Relay BPL matches played in the BPL Bots app, round by round (keep this page open)</label>
      <div id="lv-relay-state" class="muted" style="font-size:12px;margin-top:4px">${esc(LiveRelay.state||'Checking for the BPL Bots app…')}</div>
      <details class="lv-setup" id="lv-rules"><summary>Step 2 (once): let only you send live scores</summary>
        <ol><li>Open <a href="https://console.firebase.google.com/project/${esc(cfg.projectId)}/firestore/rules" target="_blank" rel="noopener">Firestore → Rules</a>.</li>
        <li>Paste this block on a new line just <b>above</b> the last two <code>}</code> lines (keep your predictions rules as they are), then press <b>Publish</b>:</li></ol>
        <pre class="lv-pre" id="lv-pre">${esc(liveRulesBlock(user.uid))}</pre>
        <button id="lv-copy" class="loadmore">Copy block</button>
        <p class="muted" style="font-size:12px">The long code is your account's ID, so nobody else can post scores. Press <b>Test the connection</b> afterwards.</p></details>
    </div>`;
  $("#lv-on").onchange = e=>{ try{ localStorage.setItem('bpl_live_send', e.target.checked?'1':'0'); }catch(_){}; setupLivePanel(); };
  $("#lv-relay").onchange = e=>{ try{ localStorage.setItem('bpl_live_relay', e.target.checked?'1':'0'); }catch(_){}; liveRelayTick().catch(()=>{}); };
  $("#lv-signout").onclick = async e=>{ e.preventDefault(); await auth.signOut(); setupLivePanel(); };
  $("#lv-switch").onclick = async e=>{ e.preventDefault();
    try{ await auth.signOut(); await liveSignIn(auth); }catch(_){ /* closed the picker: stays signed out */ }
    setupLivePanel(); };
  $("#lv-copy").onclick = ()=>{ navigator.clipboard && navigator.clipboard.writeText(liveRulesBlock(user.uid)); $("#lv-copy").textContent = "Copied ✓"; };
  $("#lv-test").onclick = async ()=>{
    const msg = $("#lv-last"); msg.textContent = "Testing…";
    try{ const db = await fbLoad(); await db.collection('live').doc('_test').set({slug:'_test', at: firebase.firestore.FieldValue.serverTimestamp()});
      msg.innerHTML = `<span style="color:var(--good)">✓ Connected. Scores you save will go live.</span>`; }
    catch(e){ msg.innerHTML = /permission/i.test(e.message||'') ? `<span style="color:var(--accent2)">Blocked: do Step 2 below, then test again.</span>` : esc(e.message||String(e));
      if(/permission/i.test(e.message||'')) $("#lv-rules").open = true; }
  };
  $("#lv-now").onclick = ()=>{
    (DATA.tournaments||[]).filter(t=>t.stages && !t.champion).forEach(t=>LivePush.dirty.add(t.slug));
    if(!LivePush.dirty.size){ $("#lv-last").textContent = "No running events to send."; return; }
    const was = livePushOn(); if(!was){ $("#lv-last").textContent = "Live sending is paused: tick the box first."; LivePush.dirty.clear(); return; }
    livePushDirty();
  };
}

// ================= TROPHY CABINET =================
// Real trophies on a shelf: Major gold, S-Tier silver, A-Tier bronze. Bigger events get bigger trophies
// (Major, then S-Tier 1/2/3 from the prize pool, then A-Tier).
const TROPHY_KIND = {
  major:{h:84, c:["#7a5a0c","#ffe58a","#ffc72e","#8f6a10"], star:true},
  s1:{h:70, c:["#5d6880","#ffffff","#c9d3e6","#6e7a93"]},
  s2:{h:63, c:["#5d6880","#f4f7fd","#bcc7dc","#6e7a93"]},
  s3:{h:58, c:["#5d6880","#eef2f9","#b3bed3","#6e7a93"]},
  a:{h:50, c:["#6b3d1c","#f2b98a","#c98a5a","#7a4a26"]},
};
function trophyKind(tier, sub){ return tier==='major' ? 'major' : tier==='s' ? (sub===2?'s2':sub===3?'s3':'s1') : 'a'; }
function trophySvg(kind){
  const k = TROPHY_KIND[kind], id = 'tg-'+kind, g = `url(#${id})`;
  return `<svg class="trophy" viewBox="0 0 64 84" height="${k.h}" width="${Math.round(k.h*64/84)}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${k.c[0]}"/><stop offset=".38" stop-color="${k.c[1]}"/>
      <stop offset=".62" stop-color="${k.c[2]}"/><stop offset="1" stop-color="${k.c[3]}"/></linearGradient></defs>
    <path d="M15 13h-6a8 8 0 0 0 0 16c3 0 5.5-1 7.5-2.6M49 13h6a8 8 0 0 1 0 16c-3 0-5.5-1-7.5-2.6" fill="none" stroke="${g}" stroke-width="4" stroke-linecap="round"/>
    <path d="M12 6h40v12c0 14-8.5 23-20 23S12 32 12 18z" fill="${g}"/>
    <path d="M18 9h5v9c0 7 2.5 13 6 16-6-2-11-8-11-16z" fill="#fff" opacity=".28"/>
    ${k.star?`<path d="M32 13l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff6cf" opacity=".9"/>`:''}
    <path d="M28.5 41h7l-1 9h-5z" fill="${g}"/>
    <path d="M23 50h18l2 5H21z" fill="${g}"/>
    <rect x="17" y="55" width="30" height="20" rx="2" fill="#1d2232" stroke="${g}" stroke-width="1.5"/>
    <rect x="22.5" y="60.5" width="19" height="9" rx="1.2" fill="${g}" opacity=".9"/>
  </svg>`;
}
// items: [{slug, name, year, tier, sub, team}]
function trophyShelfHtml(items, showTeam){
  if(!items.length) return '';
  const order = {major:0, s1:1, s2:2, s3:3, a:4};
  items = items.map(x=>({...x, kind:trophyKind(x.tier, x.sub)}))
    .sort((a,b)=>order[a.kind]-order[b.kind] || String(b.year).localeCompare(String(a.year)));
  return `<div class="tshelf">${items.map(x=>{
    const tierName = x.kind==='major'?'Major':x.kind==='a'?'A-Tier':`S-Tier ${x.kind.slice(1)}`;
    const tip = `${x.name} · ${tierName} · ${x.year}${showTeam&&x.team?' · with '+x.team:''}`;
    return `<a class="trophy-item k-${x.kind}" href="#/tournament/${esc(x.slug)}" title="${esc(tip)}">
      ${trophySvg(x.kind)}<span class="trophy-yr">${esc(String(x.year))}</span></a>`; }).join("")}</div>`;
}
function trophyTally(items){
  const n = k=>items.filter(x=>k(x)).length, parts = [];
  const mj = n(x=>x.tier==='major'), s = n(x=>x.tier==='s'), a = n(x=>x.tier!=='major'&&x.tier!=='s');
  if(mj) parts.push(`${mj} Major${mj>1?'s':''}`); if(s) parts.push(`${s} S-Tier`); if(a) parts.push(`${a} A-Tier`);
  return `${items.length} title${items.length===1?'':'s'} · ${parts.join(' · ')}`;
}
function teamTrophies(t){
  const trBy = {}; (DATA.tournaments||[]).forEach(x=>trBy[x.slug]=x);
  return (t.events||[]).filter(e=>e.isChampion).map(e=>({slug:e.slug, name:e.name, year:(e.date||'').slice(0,4),
    tier:e.tier, sub:(trBy[e.slug]||{}).subTier}));
}
function playerTrophies(p){
  const trBy = {}; (DATA.tournaments||[]).forEach(x=>trBy[x.slug]=x);
  return (p.titles||[]).map(tt=>({slug:tt.slug, name:tt.event, year:tt.year, tier:tt.tier, sub:(trBy[tt.slug]||{}).subTier, team:tt.team}));
}

// ================= BPL-dle =================
// Guess the mystery BPL player in 6 tries. Everyone gets the same player each day (Singapore time), from
// the schedule build/extras.py writes; practice mode picks a random one. Green = exact, yellow = close,
// arrows point toward the answer.
const DLE_TRIES = 6;
const DLE_REGION = {};
[["Southeast Asia","sg my id ph th vn bn kh mm la tl"],["East Asia","jp kr cn tw hk mo mn"],["Oceania","au nz"],
 ["North America","us ca mx"],["South America","br ar cl co pe uy ve"],["Central Asia","kz uz kg tj tm"],
 ["South Asia","in pk bd lk np"],["Middle East","ae sa tr il qa kw jo lb eg"],["Africa","za ng ke ma"],
 ["Europe","gb nl de se pl ua fr is it fi be gr ba cz ie es pt dk no ch at ru hu ro rs hr si sk bg lt lv ee by"]]
  .forEach(([r,isos])=>isos.split(" ").forEach(i=>DLE_REGION[i]=r));
let _dle = null;   // {mode, answer, guesses, date, num}
function sgtToday(){ return new Date(Date.now()+8*3600e3).toISOString().slice(0,10); }
function dayDiff(a, b){ return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/864e5); }
function dlePool(){ return (DATA.players.pro||[]).filter(p=>p.slug); }
function dleDebut(p){ return p.joined || null; }
function dleDaily(){
  const d = DATA.dle, today = sgtToday(), pool = dlePool();
  const num = d ? Math.max(1, dayDiff(d.start, today)+1) : 1;
  let slug = null, yslug = null;
  if(d){ try{
    const days = JSON.parse(atob(d.days.split("").reverse().join(""))).reverse();
    slug = days[num-1-d.from]; yslug = days[num-2-d.from];
  }catch(e){} }
  const by = s=>pool.find(p=>p.slug===s);
  let ans = slug && by(slug);
  if(!ans){ let h = 0; for(const c of today) h = (h*31 + c.charCodeAt(0))>>>0; ans = pool[h % pool.length]; }   // schedule ran out
  return {answer: ans, num, date: today, yesterday: yslug && by(yslug)};
}
function dleLoad(date){ try{ const s = JSON.parse(localStorage.getItem('bpl_dle_v1')||'null'); return s && s.date===date ? s.guesses : []; }catch(e){ return []; } }
function dleSave(){ if(_dle.mode!=='daily') return; try{ localStorage.setItem('bpl_dle_v1', JSON.stringify({date:_dle.date, guesses:_dle.guesses})); }catch(e){} }
function dleStatus(){
  const g = dleDaily(), gs = dleLoad(g.date);
  const won = gs.includes(g.answer.slug), lost = !won && gs.length>=DLE_TRIES;
  return {num: g.num, text: won ? `Solved in ${gs.length}/${DLE_TRIES} ✓` : lost ? 'Out of guesses today' : gs.length ? `${gs.length}/${DLE_TRIES} guesses so far` : 'Not played yet', done: won||lost};
}
function dleClues(g, a){
  const cmpNum = (gv, av, near)=>{
    if(gv==null || av==null) return {c: gv==null&&av==null ? 'g' : 'x', v: gv==null ? '—' : gv, arrow: ''};
    return {c: gv===av ? 'g' : Math.abs(gv-av)<=near ? 'y' : 'x', v: gv, arrow: gv===av ? '' : av>gv ? '↑' : '↓'};
  };
  const gTeam = g.team||'', aTeam = a.team||'';
  const played = new Set((a.teamHistory||[]).map(t=>normKey(t.team)));
  const team = {c: normKey(gTeam)===normKey(aTeam) ? 'g' : gTeam && played.has(normKey(gTeam)) ? 'y' : 'x', v: gTeam||'Free agent',
    tip: (gTeam||'Free agent') + (gTeam && normKey(gTeam)!==normKey(aTeam) && played.has(normKey(gTeam)) ? ': the mystery player has played for this team before' : '')};
  const nat = {c: g.iso===a.iso ? 'g' : DLE_REGION[g.iso] && DLE_REGION[g.iso]===DLE_REGION[a.iso] ? 'y' : 'x', v: flag(g.iso)+(g.iso||'?').toUpperCase(), html:true,
    tip: g.iso!==a.iso && DLE_REGION[g.iso]===DLE_REGION[a.iso] ? `Same region (${DLE_REGION[g.iso]})` : (g.nat||'')};
  const gr = new Set(String(g.role||'').split('/')), ar = new Set(String(a.role||'').split('/'));
  const role = {c: g.role===a.role ? 'g' : [...gr].some(r=>ar.has(r)) ? 'y' : 'x', v: g.role||'—'};
  return [team, nat, role, cmpNum(g.ratingPoints, a.ratingPoints, 60), cmpNum(dleDebut(g), dleDebut(a), 1), cmpNum((g.titles||[]).length, (a.titles||[]).length, 1)];
}
const DLE_COLS = ["Team","Nation","Role","Rating","Debut","Titles"];
function dleNewGame(mode){
  if(mode==='daily'){ const g = dleDaily(); _dle = {mode, answer:g.answer, num:g.num, date:g.date, yesterday:g.yesterday, guesses:dleLoad(g.date)}; }
  else { const pool = dlePool(); _dle = {mode, answer: pool[Math.floor(Math.random()*pool.length)], guesses:[]}; }
}
function renderDle(){
  if(!_dle || (_dle.mode==='daily' && _dle.date!==sgtToday())) dleNewGame('daily');
  const D = _dle, a = D.answer, by = s=>playerBySlug(s);
  const won = D.guesses.includes(a.slug), over = won || D.guesses.length>=DLE_TRIES;
  const rows = D.guesses.map(s=>{ const g = by(s); if(!g) return '';
    const cl = dleClues(g, a);
    return `<div class="dle-row${g.slug===a.slug?' win':''}${s===D.fresh?' fresh':''}"><div class="dle-name">${flag(g.iso)}${esc(g.name)}</div>
      <div class="dle-tiles">${cl.map((c,i)=>`<div class="dle-tile t-${c.c}"${c.tip?` title="${esc(c.tip)}"`:''}><span class="dle-lbl">${DLE_COLS[i]}</span>
        <span class="dle-v">${c.html?c.v:esc(String(c.v))}${c.arrow?`<b class="dle-ar">${c.arrow}</b>`:''}</span></div>`).join("")}</div></div>`; }).join("");
  D.fresh = null;                                          // only the newest guess animates in
  const left = DLE_TRIES - D.guesses.length;
  const endHtml = over ? `<div class="dle-end ${won?'won':'lost'}">
      <div class="dle-end-t">${won?`🎯 Got it in ${D.guesses.length}/${DLE_TRIES}!`:'Out of guesses'}</div>
      <div>The mystery player was <a href="#/player/${a.slug}">${flag(a.iso)}<b>${esc(a.name)}</b></a>${a.team?` <span class="muted">(${esc(a.team)})</span>`:''}</div>
      <div class="dle-end-btns">${D.mode==='daily'?`<button id="dle-share" class="adm-btn" style="max-width:190px">Copy result</button>
        <span class="muted" style="font-size:12px">Next player in <b id="dle-cd"></b></span>`:''}
        <button id="dle-again" class="loadmore">${D.mode==='daily'?'Play practice':'New practice player'}</button></div>
    </div>` : '';
  app.innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>BPL-dle <span class="muted" style="font-size:12px">${D.mode==='daily'?`#${D.num} · daily`:'practice'}</span>
      <span class="dle-modes"><button data-dmode="daily" class="${D.mode==='daily'?'active':''}">Daily</button><button data-dmode="practice" class="${D.mode==='practice'?'active':''}">Practice</button></span></h2>
    <p class="muted dle-intro">Guess the mystery BPL player in ${DLE_TRIES} tries. Any of the league's ${dlePool().length} pro players can be the answer.
      <span class="dle-key"><span class="t-g">exact</span><span class="t-y">close</span><span class="t-x">no</span> · arrows point toward the answer</span></p>
    ${!over?`<div class="dle-input"><input id="dle-in" type="text" autocomplete="off" placeholder="Type a player… (${left} ${left===1?'guess':'guesses'} left)"><div id="dle-sug" class="dle-sug"></div></div>`:''}
    ${endHtml}
    <div class="dle-board">${rows || '<p class="muted" style="text-align:center;padding:18px 0">Your guesses show up here.</p>'}</div>
    <details class="dle-help"><summary>How the clues work</summary><ul>
      <li><b>Team</b>: their current team. Yellow means the mystery player has played for that team before.</li>
      <li><b>Nation</b>: yellow means the same region (e.g. Southeast Asia).</li>
      <li><b>Role</b>: Rifler, Awper, IGL or Fill. Yellow means they share part of it (Rifler/IGL).</li>
      <li><b>Rating</b>: Rating Points. Yellow is within 60.</li>
      <li><b>Debut</b>: the year of their first BPL event. Yellow is one year off.</li>
      <li><b>Titles</b>: events they've won. Yellow is one off.</li></ul></details>
    ${D.mode==='daily' && D.yesterday && over ? `<p class="muted" style="font-size:12px;margin-top:10px">Yesterday's player: <a href="#/player/${D.yesterday.slug}">${esc(D.yesterday.name)}</a></p>`:''}`;
  app.querySelectorAll("[data-dmode]").forEach(b=>b.onclick=()=>{ dleNewGame(b.dataset.dmode); renderDle(); });
  const again = $("#dle-again"); if(again) again.onclick = ()=>{ dleNewGame('practice'); renderDle(); };
  const sh = $("#dle-share"); if(sh) sh.onclick = ()=>{
    const grid = D.guesses.map(s=>dleClues(by(s), a).map(c=>c.c==='g'?'🟩':c.c==='y'?'🟨':'⬛').join("")).join("\n");
    const txt = `BPL-dle #${D.num} ${won?D.guesses.length:'X'}/${DLE_TRIES}\n${grid}\n${location.origin}${location.pathname}#/dle`;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(()=>{ sh.textContent = "Copied ✓"; }, ()=>{ prompt("Copy your result:", txt); });
  };
  const cd = $("#dle-cd");
  if(cd){ const tick = ()=>{ if(!document.body.contains(cd)) return clearInterval(t);
      const now = Date.now()+8*3600e3, left = 864e5 - (now % 864e5), h = Math.floor(left/36e5), m = Math.floor(left%36e5/6e4), s = Math.floor(left%6e4/1e3);
      cd.textContent = `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`; if(left < 1500) renderDle(); };
    const t = setInterval(tick, 1000); tick(); }
  const inp = $("#dle-in"); if(!inp) return;
  const sug = $("#dle-sug"); let hits = [], sel = 0;
  const guess = p=>{ if(!p || D.guesses.includes(p.slug)) return; D.guesses.push(p.slug); D.fresh = p.slug; dleSave(); renderDle(); const n = $("#dle-in"); if(n) n.focus(); };
  const draw = ()=>{
    sug.innerHTML = hits.map((p,i)=>`<div class="dle-opt${i===sel?' sel':''}" data-i="${i}">${flag(p.iso)}<b>${esc(p.name)}</b><span class="muted">${esc(p.team||'Free agent')}</span></div>`).join("");
    sug.classList.toggle("show", hits.length>0);
    sug.querySelectorAll(".dle-opt").forEach(o=>o.onmousedown = e=>{ e.preventDefault(); guess(hits[+o.dataset.i]); });
  };
  inp.oninput = ()=>{
    const q = normKey(inp.value); sel = 0;
    if(!q){ hits = []; return draw(); }
    const names = p=>[p.name].concat(p.aka||[]).map(normKey);
    const pool = dlePool().filter(p=>!D.guesses.includes(p.slug));
    hits = pool.filter(p=>names(p).some(n=>n.startsWith(q))).concat(pool.filter(p=>!names(p).some(n=>n.startsWith(q)) && names(p).some(n=>n.includes(q)))).slice(0,8);
    draw();
  };
  inp.onkeydown = e=>{
    if(e.key==="ArrowDown"){ sel = Math.min(sel+1, hits.length-1); draw(); e.preventDefault(); }
    else if(e.key==="ArrowUp"){ sel = Math.max(sel-1, 0); draw(); e.preventDefault(); }
    else if(e.key==="Enter"){ guess(hits[sel]); }
    else if(e.key==="Escape"){ hits = []; draw(); }
  };
  inp.focus();
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
// ================= FANTASY BPL =================
// Per event, HLTV-style: pick 5 players from the teams attending, under a $1,000,000 budget, max 2 from one
// team. Prices come from each player's Rating Points before the event (cheapest $100k, best $300k). Picks lock
// when the event's first match is played; an entry saved after that moment doesn't count. Points come from
// the real scoreboards. Entries are stored with the predictions (same Firebase, "fantasy:<event>" keys).
const FANTASY = {budget:1000000, size:5, perTeam:2, minPrice:100000, maxPrice:300000,
  pts:{k:2, a:1, d:-1, mvp:4, win:10}};
const FANTASY_RULES = `Kill +${FANTASY.pts.k} · Assist +${FANTASY.pts.a} · Death ${FANTASY.pts.d} · MVP star +${FANTASY.pts.mvp} · Map won +${FANTASY.pts.win}`;
function fantasyMatches(tr){
  return tr.stages ? tr.stages.flatMap(st=>st.rounds.flatMap(rd=>rd.matches.map(m=>({m, ref:`${st.id}-${m.i}`}))))
    : (tr.bracket||[]).flatMap(rd=>rd.matches.map(m=>({m, ref:`${m.i}`})));
}
const fantasyPlayed = m => (m.w===1||m.w===2) && m.a!=="(bye)" && m.b!=="(bye)";
// picks lock at the first real result; ts = when it was recorded (null = locked, time unknown)
function fantasyLock(tr){
  const played=fantasyMatches(tr).map(x=>x.m).filter(fantasyPlayed);
  if(!played.length) return {locked:false, ts:null};
  const ts=played.map(m=>m.ts).filter(Boolean);
  return {locked:true, ts:ts.length?Math.min(...ts):null};
}
function fantasySupported(tr){
  if(!tr || /qualifier/i.test(tr.slug)) return false;
  if((tr.attending||[]).some(r=>r.tbc)) return false;                     // places still TBC: wait for the full field
  const att=(tr.attending||[]).filter(r=>(r.players||[]).filter(p=>p.slug).length>=3);
  if(att.length<4) return false;
  if(!tr.champion) return true;                                            // upcoming / live
  const played=fantasyMatches(tr).map(x=>x.m).filter(fantasyPlayed);       // finished: most matches have scoreboards
  return played.length>0 && played.filter(m=>m.stats&&m.stats.maps&&m.stats.maps.length).length >= played.length/2;
}
// the player pool with prices from Rating Points before the event (the first recorded match's "before")
function fantasyPool(tr){
  const before={};
  fantasyMatches(tr).map(x=>x.m).filter(m=>m.elo).sort((a,b)=>(a.ts||0)-(b.ts||0))
    .forEach(m=>Object.entries(m.elo).forEach(([s,path])=>{ if(!(s in before)) before[s]=path[0]; }));
  const pool=[];
  (tr.attending||[]).forEach(row=>(row.players||[]).forEach(pl=>{
    if(!pl.slug || pool.some(x=>x.slug===pl.slug)) return;
    const p=playerBySlug(pl.slug); if(!p) return;
    const rp = before[pl.slug]!=null ? before[pl.slug] : p.ratingPoints;
    if(rp==null) return;
    pool.push({slug:pl.slug, name:p.name, iso:p.iso, team:row.team, teamSlug:row.teamSlug, rp});
  }));
  const rs=pool.map(x=>x.rp).sort((a,b)=>a-b), q=f=>rs[Math.min(rs.length-1, Math.max(0, Math.round(f*(rs.length-1))))];
  const lo=q(0.05), hi=q(0.95);
  pool.forEach(x=>{
    const t = hi>lo ? Math.max(0, Math.min(1, (x.rp-lo)/(hi-lo))) : 0.5;
    x.price = Math.round((FANTASY.minPrice + t*(FANTASY.maxPrice-FANTASY.minPrice))/5000)*5000;
  });
  return pool;
}
// fantasy points per player from the event's recorded scoreboards
function fantasyPoints(tr){
  const out={}, P=FANTASY.pts;
  fantasyMatches(tr).forEach(({m})=>{
    ((m.stats&&m.stats.maps)||[]).forEach(mp=>{
      if(mp.scoreA==null||mp.scoreB==null) return;
      (mp.players||[]).forEach(pl=>{
        if(!pl.slug) return;
        const isA=normKey(pl.team)===normKey(m.a), won=isA ? mp.scoreA>mp.scoreB : mp.scoreB>mp.scoreA;
        const o=out[pl.slug]||(out[pl.slug]={pts:0, maps:0, k:0, a:0, d:0, mvp:0, wins:0});
        o.maps++; o.k+=pl.k||0; o.a+=pl.a||0; o.d+=pl.d||0; o.mvp+=pl.mvp||0; o.wins+=won?1:0;
        o.pts += (pl.k||0)*P.k + (pl.a||0)*P.a + (pl.d||0)*P.d + (pl.mvp||0)*P.mvp + (won?P.win:0);
      });
    });
  });
  return out;
}
function fantasyCheck(picks, pool){
  const by=Object.fromEntries(pool.map(x=>[x.slug,x])), sel=picks.map(s=>by[s]).filter(Boolean);
  const cost=sel.reduce((t,x)=>t+x.price,0), per={};
  sel.forEach(x=>per[x.team]=(per[x.team]||0)+1);
  const errs=[];
  if(cost>FANTASY.budget) errs.push(`Over budget by ${fmtMoney(cost-FANTASY.budget)}.`);
  Object.entries(per).forEach(([t,n])=>{ if(n>FANTASY.perTeam) errs.push(`Max ${FANTASY.perTeam} players from ${t}.`); });
  return {sel, cost, errs, full:sel.length===FANTASY.size};
}
function fmtMoney(v){ return v>=1000000 ? `$${(v/1000000).toFixed(v%1000000?2:0)}M` : `$${Math.round(v/1000)}k`; }
// best possible line-up under the rules (search over the top scorers; the optimum is always among them)
function fantasyPerfect(pool, pts){
  const cand=pool.filter(x=>pts[x.slug]).map(x=>({...x, pts:pts[x.slug].pts})).sort((a,b)=>b.pts-a.pts).slice(0,36);
  let best=null; const pick=[];
  (function go(i, cost, score, per){
    if(pick.length===FANTASY.size){ if(!best||score>best.score) best={score, picks:[...pick]}; return; }
    if(i>=cand.length) return;
    // bound: even the next best players can't beat the best found
    let ub=score; for(let j=i, n=pick.length; j<cand.length && n<FANTASY.size; j++, n++) ub+=Math.max(0,cand[j].pts);
    if(best && ub<=best.score) return;
    const c=cand[i];
    if(cost+c.price<=FANTASY.budget && (per[c.team]||0)<FANTASY.perTeam){
      pick.push(c); per[c.team]=(per[c.team]||0)+1;
      go(i+1, cost+c.price, score+c.pts, per);
      pick.pop(); per[c.team]--;
    }
    go(i+1, cost, score, per);
  })(0, 0, 0, {});
  return best;
}
const FantasyStore = {
  key: slug => 'fantasy:'+slug,
  async save(entry){ return PredictBackend.saveDoc(entry.event+'__'+entry.uid, entry, 'bpl_fant_'); },
  async loadAll(slug){ return PredictBackend.queryEvent(this.key(slug), 'bpl_fant_'); },
};

function renderFantasy(slug){
  if(slug) return renderFantasyEvent(slug);
  const evs=(DATA.tournaments||[]).filter(fantasySupported).sort((a,b)=>(a.date<b.date?1:-1));
  const card=tr=>{ const lk=fantasyLock(tr);
    const st = !lk.locked ? '<span class="fy-st open">Open for picks</span>' : !tr.champion ? '<span class="fy-st live">● Live</span>' : '<span class="fy-st done">Finished</span>';
    return `<a class="fy-ev" href="#/fantasy/${tr.slug}">${tierBadgeEvent(tr)}<span class="fy-evn">${esc(tr.name)}</span><span class="muted">${fmtDate(tr.date)}</span>${st}</a>`; };
  const open=evs.filter(t=>!fantasyLock(t).locked), rest=evs.filter(t=>fantasyLock(t).locked);
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Fantasy BPL
      <span class="muted" style="font-size:11px">${PredictBackend.isShared?'shared leaderboards':'saved in this browser'}</span></h2>
    <div class="fy-how">
      <div><b>1. Pick 5 players</b><span>from the teams at an event, with a ${fmtMoney(FANTASY.budget)} budget and at most ${FANTASY.perTeam} from one team. Better-rated players cost more.</span></div>
      <div><b>2. Picks lock</b><span>when the event's first match is played. Change your team as often as you like before that.</span></div>
      <div><b>3. Score points</b><span>from the real scoreboards: ${esc(FANTASY_RULES)}.</span></div>
    </div>
    <h3 class="rec-group">Open for picks</h3>
    <div class="fy-evs">${open.map(card).join("") || '<p class="muted">No event is open right now. The next one opens as soon as it is created, with its teams.</p>'}</div>
    <h3 class="rec-group" style="margin-top:22px">Live &amp; finished</h3>
    <div class="fy-evs">${rest.map(card).join("") || '<p class="muted">None yet.</p>'}</div>
    <div id="fy-season"></div>`;
  fantasySeason(rest);
}
// season leaderboard: every manager's points added up over the year's locked events (late entries don't count)
let _fySeasonYear = null;
async function fantasySeason(events){
  const box=$("#fy-season"); if(!box) return;
  const years=[...new Set(events.map(t=>(t.date||'').slice(0,4)))].filter(Boolean).sort((a,b)=>b-a);
  if(!years.length) return;
  const yr = _fySeasonYear && years.includes(_fySeasonYear) ? _fySeasonYear : years[0];
  box.innerHTML = `<h3 class="rec-group" style="margin-top:22px">Season leaderboard</h3><p class="muted">Loading…</p>`;
  const totals={};
  for(const tr of events.filter(t=>(t.date||'').startsWith(yr))){
    let entries=[]; try{ entries=await FantasyStore.loadAll(tr.slug); }catch(e){}
    if(!entries.length) continue;
    const lk=fantasyLock(tr), pts=fantasyPoints(tr);
    entries.filter(e=>Array.isArray(e.picks) && (!lk.ts || !e.savedAt || e.savedAt<=lk.ts*1000)).forEach(e=>{
      const t=e.picks.reduce((a,s)=>a+(pts[s]?pts[s].pts:0),0);
      const u=totals[e.uid]||(totals[e.uid]={name:e.name||'anon', total:0, events:0, best:null});
      u.name=e.name||u.name; u.total+=t; u.events++; if(!u.best||t>u.best.pts) u.best={pts:t, event:tr.name};
    });
  }
  const board=Object.entries(totals).map(([uid,u])=>({uid,...u})).sort((a,b)=>b.total-a.total), me=predUser().uid;
  if(!$("#fy-season")) return;
  $("#fy-season").innerHTML = `<h3 class="rec-group" style="margin-top:22px">Season leaderboard <span class="muted" style="font-size:11px">fantasy points added up over every event of the year</span></h3>
    ${years.length>1?`<div class="tabs">${years.map(y=>`<button data-fyy="${y}" class="${y===yr?'active':''}">${y}</button>`).join("")}</div>`:''}
    ${board.length?`<div class="tablewrap" style="max-width:720px"><table class="data"><thead><tr><th>#</th><th>Manager</th><th>Events</th><th>Best event</th><th>Points</th></tr></thead><tbody>
      ${board.map((u,i)=>`<tr class="${u.uid===me?'fy-me':''}"><td class="rankcol">${i===0?'👑':i+1}</td><td class="name-cell">${esc(u.name)}${u.uid===me?' <span class="muted">(you)</span>':''}</td>
        <td class="mono">${u.events}</td><td class="muted" style="font-size:12px">${u.best?`${u.best.pts} at ${esc(u.best.event)}`:''}</td><td class="mono fy-tot">${u.total}</td></tr>`).join("")}</tbody></table></div>`
      :`<p class="muted">No fantasy teams entered in ${yr} yet. The season champion is whoever scores the most across all of the year's events.</p>`}`;
  document.querySelectorAll("[data-fyy]").forEach(b=>b.onclick=()=>{ _fySeasonYear=b.dataset.fyy; fantasySeason(events); });
}
async function renderFantasyEvent(slug){
  const tr=(DATA.tournaments||[]).find(t=>t.slug===slug);
  if(!tr || !fantasySupported(tr)){ app.innerHTML=notFound("Fantasy event"); return; }
  const lk=fantasyLock(tr), pool=fantasyPool(tr), pts=fantasyPoints(tr), me=predUser();
  const head=`<div class="crumb"><a href="#/fantasy">Fantasy</a><span class="sep">/</span>${esc(tr.name)}</div>
    <div class="fy-head"><div><h1>${esc(tr.name)} ${tierBadgeEvent(tr)}</h1>
      <div class="muted" style="font-size:13px">${!lk.locked?'Open for picks: they lock when the first match is played.':tr.champion?'Finished.':'Live: picks are locked, points update with every scoreboard.'}
        · ${esc(FANTASY_RULES)}</div></div>
      <a class="predict-btn" href="#/tournament/${tr.slug}" style="margin:0">Event page →</a></div>`;
  app.innerHTML = head + `<div id="fy-body"><p class="muted">Loading…</p></div>`;
  let entries=[]; try{ entries=await FantasyStore.loadAll(slug); }catch(e){ entries=[]; }
  const mine=entries.find(e=>e.uid===me.uid);
  if(!lk.locked) fantasyPickUI(tr, pool, mine, entries);
  else fantasyResultsUI(tr, pool, pts, entries, lk, me);
}
function fantasyPickUI(tr, pool, mine, entries){
  const me=predUser();
  let picks = mine ? mine.picks.filter(s=>pool.some(x=>x.slug===s)) : [];
  let sort='team', q='';
  const body=$("#fy-body");
  const draw=()=>{
    const chk=fantasyCheck(picks, pool), left=FANTASY.budget-chk.cost;
    let list=pool.filter(x=>!q || normKey(x.name).includes(normKey(q)) || normKey(x.team).includes(normKey(q)));
    list = sort==='price' ? list.sort((a,b)=>b.price-a.price||b.rp-a.rp) : sort==='cheap' ? list.sort((a,b)=>a.price-b.price||b.rp-a.rp)
      : list.sort((a,b)=>a.team.localeCompare(b.team)||b.price-a.price);
    const teamCount={}; chk.sel.forEach(x=>teamCount[x.team]=(teamCount[x.team]||0)+1);
    const cheapest=Math.min(...pool.map(x=>x.price));
    const row=x=>{ const on=picks.includes(x.slug);
      // also keep enough money for the cheapest player in every slot still open after this one
      const reserve=Math.max(0, FANTASY.size-picks.length-1)*cheapest;
      const blocked=!on && (picks.length>=FANTASY.size || x.price>left-reserve || (teamCount[x.team]||0)>=FANTASY.perTeam);
      return `<div class="fy-p ${on?'on':''} ${blocked?'blocked':''}" data-s="${esc(x.slug)}">
        <span class="fy-pn">${flag(x.iso)}${esc(x.name)}</span><span class="fy-pt muted">${esc(x.team)}</span>
        <span class="fy-rp mono">${x.rp}</span><span class="fy-pr">${fmtMoney(x.price)}</span>
        <span class="fy-add">${on?'✓':'+'}</span></div>`; };
    const groups = sort==='team' ? Object.entries(list.reduce((g,x)=>((g[x.team]=g[x.team]||[]).push(x),g),{}))
        .map(([t,xs])=>`<div class="fy-tg">${esc(t)}</div>${xs.map(row).join("")}`).join("") : list.map(row).join("");
    const slots=[...Array(FANTASY.size)].map((_,i)=>{ const x=chk.sel[i];
      return x ? `<div class="fy-slot"><span>${flag(x.iso)}<b>${esc(x.name)}</b><i class="muted">${esc(x.team)}</i></span><span class="fy-pr">${fmtMoney(x.price)}</span><button class="fy-rm" data-s="${esc(x.slug)}" title="Remove">×</button></div>`
        : `<div class="fy-slot empty">Player ${i+1}</div>`; }).join("");
    const pct=Math.min(100, chk.cost/FANTASY.budget*100);
    body.innerHTML=`<div class="fy-grid">
      <div class="fy-pool"><div class="fy-tools"><input id="fy-q" class="adm-in" placeholder="Search players or teams…" value="${esc(q)}">
          <select id="fy-sort" class="adm-in"><option value="team">By team</option><option value="price">Most expensive</option><option value="cheap">Cheapest</option></select></div>
        <div class="fy-ph"><span>Player</span><span>Team</span><span>Rating</span><span>Price</span><span></span></div>
        <div class="fy-list">${groups||'<p class="muted" style="padding:10px">No players match.</p>'}</div></div>
      <div class="fy-side"><div class="fy-card"><div class="fy-ct">Your team</div>${slots}
        <div class="fy-budget"><div class="fy-bar"><i style="width:${pct}%" class="${chk.cost>FANTASY.budget?'over':''}"></i></div>
          <div class="fy-bt"><span>Spent <b>${fmtMoney(chk.cost)}</b></span><span>Left <b class="${left<0?'neg':''}">${fmtMoney(Math.abs(left))}${left<0?' over':''}</b></span></div></div>
        ${chk.errs.map(e=>`<div class="qe-i qe-bad">✗ ${esc(e)}</div>`).join("")}
        <input id="fy-name" class="adm-in" maxlength="40" placeholder="Your name (shown on the leaderboard)" value="${esc(me.name||(mine&&mine.name)||'')}">
        <button id="fy-save" class="adm-btn" style="margin-top:8px" ${chk.full&&!chk.errs.length?'':'disabled'}>${mine?'Update my team':'Save my team'}</button>
        <div id="fy-msg" class="muted" style="font-size:12px;margin-top:6px">${mine?`Saved ${new Date(mine.savedAt).toLocaleString()}. You can change it until the first match.`:''}</div></div>
        ${entries.length?`<div class="fy-card"><div class="fy-ct">${entries.length} team${entries.length===1?'':'s'} entered</div>
          <div class="muted" style="font-size:12px">${entries.map(e=>esc(e.name||'anon')).join(", ")}. Picks stay hidden until they lock.</div></div>`:''}</div></div>`;
    body.querySelectorAll(".fy-p").forEach(el=>el.onclick=()=>{
      const s=el.dataset.s;
      if(picks.includes(s)) picks=picks.filter(x=>x!==s); else if(!el.classList.contains("blocked")) picks.push(s);
      draw();
    });
    body.querySelectorAll(".fy-rm").forEach(b=>b.onclick=()=>{ picks=picks.filter(x=>x!==b.dataset.s); draw(); });
    const qi=$("#fy-q"); qi.oninput=()=>{ q=qi.value; const pos=qi.selectionStart; draw(); const n=$("#fy-q"); n.focus(); n.setSelectionRange(pos,pos); };
    $("#fy-sort").value=sort; $("#fy-sort").onchange=e=>{ sort=e.target.value; draw(); };
    $("#fy-name").oninput=e=>{ try{ localStorage.setItem('bpl_pname', e.target.value); }catch(_){} };
    $("#fy-save").onclick=async ()=>{
      const name=$("#fy-name").value.trim();
      if(!name){ $("#fy-msg").textContent="Add your name first."; $("#fy-msg").style.color="var(--accent2)"; return; }
      const c=fantasyCheck(picks, pool); if(!c.full||c.errs.length) return;
      const entry={kind:'fantasy', event:FantasyStore.key(tr.slug), uid:me.uid, name:name.slice(0,40), picks:[...picks], cost:c.cost, savedAt:Date.now()};
      $("#fy-save").disabled=true; $("#fy-msg").textContent="Saving…";
      try{ await FantasyStore.save(entry); mine=entry; const i=entries.findIndex(e=>e.uid===me.uid); if(i>=0) entries[i]=entry; else entries.push(entry);
        draw(); $("#fy-msg").textContent="Saved! Your team is in."; $("#fy-msg").style.color="var(--good)"; }
      catch(e){ $("#fy-save").disabled=false; $("#fy-msg").textContent="Couldn't save: "+e.message; $("#fy-msg").style.color="var(--accent2)"; }
    };
  };
  draw();
}
function fantasyResultsUI(tr, pool, pts, entries, lk, me){
  const by=Object.fromEntries(pool.map(x=>[x.slug,x]));
  const pp=s=>pts[s]?pts[s].pts:0;
  const valid=entries.filter(e=>Array.isArray(e.picks) && (!lk.ts || !e.savedAt || e.savedAt<=lk.ts*1000));
  const late=entries.length-valid.length;
  const board=valid.map(e=>({...e, total:e.picks.reduce((t,s)=>t+pp(s),0)})).sort((a,b)=>b.total-a.total||(a.savedAt||0)-(b.savedAt||0));
  const pRow=s=>{ const x=by[s]||{name:(playerBySlug(s)||{}).name||s}, o=pts[s];
    return `<span class="fy-chip">${flag(x.iso)}<a href="#/player/${esc(s)}">${esc(x.name)}</a> <b>${o?o.pts:0}</b></span>`; };
  const boardHtml = board.length ? `<div class="tablewrap"><table class="data fy-board"><thead><tr><th>#</th><th>Manager</th><th>Team</th><th>Points</th></tr></thead><tbody>
      ${board.map((e,i)=>`<tr class="${e.uid===me.uid?'fy-me':''}"><td class="rankcol">${i+1}</td><td class="name-cell">${esc(e.name||'anon')}${e.uid===me.uid?' <span class="muted">(you)</span>':''}</td>
        <td>${e.picks.map(pRow).join("")}</td><td class="mono fy-tot">${e.total}</td></tr>`).join("")}</tbody></table></div>
      ${late?`<p class="muted" style="font-size:12px">${late} team${late===1?' was':'s were'} saved after picks locked and ${late===1?"doesn't":"don't"} count.</p>`:''}`
    : `<p class="muted">Nobody entered a fantasy team for this event${tr.champion?'':' before picks locked'}.</p>`;
  const top=pool.filter(x=>pts[x.slug]).map(x=>({...x, ...pts[x.slug]})).sort((a,b)=>b.pts-a.pts);
  const value=[...top].filter(x=>x.maps>=2).sort((a,b)=>b.pts/b.price-a.pts/a.price).slice(0,5);
  const perfect=fantasyPerfect(pool, pts);
  const topHtml = top.length ? `<div class="tablewrap"><table class="data"><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Price</th><th>Maps</th><th>K</th><th>D</th><th>MVP</th><th>Points</th></tr></thead><tbody>
      ${top.slice(0,15).map((x,i)=>`<tr><td class="rankcol">${i+1}</td><td class="name-cell">${flag(x.iso)}<a href="#/player/${x.slug}">${esc(x.name)}</a></td><td class="muted">${esc(x.team)}</td>
        <td>${fmtMoney(x.price)}</td><td class="mono">${x.maps}</td><td class="mono">${x.k}</td><td class="mono">${x.d}</td><td class="mono">${x.mvp}</td><td class="mono fy-tot">${x.pts}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="muted">No scoreboards recorded yet.</p>';
  $("#fy-body").innerHTML = `
    <h2 class="section-title"><span class="accent-bar"></span>Leaderboard</h2>${boardHtml}
    ${perfect?`<h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>${tr.champion?'The perfect team':'The perfect team so far'}
        <span class="muted" style="font-size:11px">best possible 5 under the budget and team limit</span></h2>
      <div class="fy-perfect">${perfect.picks.map(x=>`<div class="fy-pf">${flag(x.iso)}<a href="#/player/${x.slug}">${esc(x.name)}</a><span class="muted">${esc(x.team)} · ${fmtMoney(x.price)}</span><b>${x.pts}</b></div>`).join("")}
        <div class="fy-pf tot"><span>Total</span><span class="muted">${fmtMoney(perfect.picks.reduce((t,x)=>t+x.price,0))}</span><b>${perfect.score}</b></div></div>`:''}
    ${value.length?`<h3 class="rec-group" style="margin-top:18px">Best value <span class="muted" style="font-size:11px">points per $100k</span></h3>
      <div class="fy-perfect">${value.map(x=>`<div class="fy-pf">${flag(x.iso)}<a href="#/player/${x.slug}">${esc(x.name)}</a><span class="muted">${fmtMoney(x.price)} · ${x.pts} pts</span><b>${(x.pts/x.price*100000).toFixed(1)}</b></div>`).join("")}</div>`:''}
    <h2 class="section-title" style="margin-top:22px"><span class="accent-bar"></span>Top fantasy scorers</h2>${topHtml}`;
}
// ================= PREDICTIONS =================
const PredictBackend = (function(){
  const cfg = window.BPL_FIREBASE || {};
  const isShared = !!(cfg.apiKey && cfg.projectId);
  let db = null, ready = null;
  function load(){
    if(ready) return ready;
    ready = fbLoad().then(d=>{ db = d; return d; });
    return ready;
  }
  const lkey = p => `bpl_pred_${p.event}_${p.uid}`;
  return {
    isShared,
    async save(pred){
      if(isShared){ await load(); await db.collection('predictions').doc(pred.event+'__'+pred.uid).set(pred); }
      else { localStorage.setItem(lkey(pred), JSON.stringify(pred)); }
    },
    async loadAll(event){
      if(isShared){ await load(); const snap=await db.collection('predictions').where('event','==',event).get(); return snap.docs.map(d=>d.data()); }
      const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.indexOf('bpl_pred_'+event+'_')===0){ try{ out.push(JSON.parse(localStorage.getItem(k))); }catch(e){} } } return out;
    },
    async loadMine(event, uid){
      if(isShared){ await load(); const d=await db.collection('predictions').doc(event+'__'+uid).get(); return d.exists?d.data():null; }
      const v=localStorage.getItem('bpl_pred_'+event+'_'+uid); return v?JSON.parse(v):null;
    },
    async saveDoc(id, doc, localPrefix){
      if(isShared){ await load(); await db.collection('predictions').doc(id).set(doc); }
      else { localStorage.setItem(localPrefix+id, JSON.stringify(doc)); }
    },
    async queryEvent(event, localPrefix){
      if(isShared){ await load(); const snap=await db.collection('predictions').where('event','==',event).get(); return snap.docs.map(d=>d.data()); }
      const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.indexOf(localPrefix+event+'__')===0){ try{ out.push(JSON.parse(localStorage.getItem(k))); }catch(e){} } } return out;
    },
    async loadEverything(){
      if(isShared){ await load(); const snap=await db.collection('predictions').get(); return snap.docs.map(d=>d.data()).filter(d=>d.kind!=='fantasy'); }
      const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.indexOf('bpl_pred_')===0){ try{ out.push(JSON.parse(localStorage.getItem(k))); }catch(e){} } } return out;
    }
  };
})();
function predUser(){
  let uid=localStorage.getItem('bpl_uid');
  if(!uid){ uid='u'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); localStorage.setItem('bpl_uid',uid); }
  return { uid, name: localStorage.getItem('bpl_pname')||'' };
}
const BR16 = [1,16,8,9,5,12,4,13,3,14,6,11,7,10,2,15];
// standard bracket seed order for N teams. Keep BR16 verbatim for 16 so existing saved
// group-stage predictions (keyed by match position) don't shift.
function seedOrder(n){
  if(n===16) return BR16;
  let order=[1,2];
  while(order.length<n){ const m=order.length*2+1; order=order.flatMap(s=>[s, m-s]); }
  return order;
}
function predGroups(tr){ return predPlayoffsOnly(tr) ? [] : (tr.stages||[]).filter(s=>s.format!=='single_elim'); }
// "playoffs only" events (predictionsMode "playoffs", Conquerors 2026): no group picks. Predictions are
// closed until the playoff bracket is added, then cover it alone, and lock at its first result (or ▶ Start).
function predPlayoffsOnly(tr){ return !!(tr && tr.predictionsMode==='playoffs'); }
function predPlayoffStage(tr){ return (tr.stages||[]).find(s=>s.format==='single_elim') || null; }
function predPlayoffStarted(tr){
  const st=predPlayoffStage(tr);
  return !!(st && (st.rounds||[]).some(rd=>(rd.matches||[]).some(m=>m.w===1||m.w===2)));
}
// leaderboard events (no playoff, e.g. Challengers/Legends): pick the top N of every group, then rank
// all the qualifiers on one predicted final leaderboard (#1 = champion) instead of filling a bracket
function predIsBoard(tr){ return !!(tr && tr.leaderboard); }
function predPerGroup(tr){ return predIsBoard(tr) ? (tr.leaderboard.perGroup||2) : 2; }
// the predicted leaderboard: the saved order first, then any newly picked qualifiers (group winners
// first). null until every group has all its picks.
function predBoard(tr, pred){
  const gs=predGroups(tr), per=predPerGroup(tr), quals=[];
  for(let i=0;i<per;i++) gs.forEach(g=>quals.push(((pred.groups||{})[g.name]||[])[i]||null));
  if(!quals.length || quals.some(t=>!t) || new Set(quals).size!==quals.length) return null;
  const qs=new Set(quals), seen=new Set();
  const out=(pred.board||[]).filter(t=>qs.has(t) && !seen.has(t) && seen.add(t));
  quals.forEach(t=>{ if(!seen.has(t)){ seen.add(t); out.push(t); } });
  return out;
}
// predicted champ / runner-up / top 4 / top 8: from the leaderboard on leaderboard events, else the bracket.
// (Leaderboard events predicted before the leaderboard existed fall back to their old bracket.)
function predPicks(tr, pred){
  if(predIsBoard(tr) && pred.board && pred.board.length){
    const b=predBoard(tr,pred)||pred.board;
    return {champ:b[0]||null, ru:b[1]||null, sf:b.slice(2,4), qf:b.slice(4,8), board:b};
  }
  return predPlacements(bracketRounds(predSeeds(tr,pred), pred.bracket||{}));
}
// seed list for the prediction bracket: from group picks (winners 1-8, runners 9-16),
// or — for a pure single-elim event — the bracket's own seed-ordered teams.
function predSeeds(tr, pred){
  const gs=predGroups(tr);
  if(!gs.length){
    const st=predPlayoffStage(tr) || (predPlayoffsOnly(tr) ? null : (tr.stages||[])[0]);
    const seeds=((st&&st.teams)||[]).map(t=>Array.isArray(t)?t[0]:t);
    // a self-seeding playoff (autoSeed) is all TBD slots until the groups finish: not open yet
    return predPlayoffsOnly(tr) && seeds.some(t=>!t) ? [] : seeds;
  }
  const w=[],r=[];
  gs.forEach(g=>{ const p=(pred.groups||{})[g.name]||[]; w.push(p[0]||null); r.push(p[1]||null); });
  return w.concat(r);
}
// events that support predictions: group-stage events, or clean power-of-2 single-elim brackets
function predSupported(tr){
  if(predPlayoffsOnly(tr)) return true;            // before the bracket, the page says when they open
  if(!tr || !tr.stages || !tr.stages.length) return false;
  if(predGroups(tr).length) return true;
  return predSeeds(tr,{groups:{}}).length>=2;     // any single-elim (byes padded to power of 2)
}
function roundLabels(nRounds){
  const out=[];
  for(let r=0;r<nRounds;r++){ const fe=nRounds-1-r;
    out.push(fe===0?'Final':fe===1?'Semifinals':fe===2?'Quarterfinals':('Round of '+Math.pow(2,fe+1))); }
  return out;
}
const PBYE='(bye)';   // seed padding for non-power-of-2 single-elim brackets — auto-advances
function bracketRounds(seeds, picks){
  let list=(seeds||[]).slice();
  if(list.length<2) return null;
  let n=1; while(n<list.length) n*=2;              // pad up to a power of 2 with byes
  while(list.length<n) list.push(PBYE);
  if(list.some(s=>s==null)) return null;           // group picks not fully made yet
  const ord=seedOrder(n);
  let matches=[]; for(let i=0;i<n;i+=2) matches.push([list[ord[i]-1], list[ord[i+1]-1]]);
  const rounds=[]; let r=1;
  while(true){
    const wk = matches.map((m,i)=>{
      const a=m[0], b=m[1]; let pick=picks[`r${r}m${i}`]||null, auto=false;
      if(a===PBYE && b!==PBYE){ pick=b; auto=true; }        // bye: the real team advances
      else if(b===PBYE && a!==PBYE){ pick=a; auto=true; }
      else if(a===PBYE && b===PBYE){ pick=PBYE; auto=true; }
      else if(pick && pick!==a && pick!==b) pick=null;      // stale pick (matchup changed)
      return {a,b,key:`r${r}m${i}`,pick,auto};
    });
    rounds.push(wk);
    if(matches.length===1) break;
    const win = wk.map(m=>m.pick);
    const nxt=[]; for(let i=0;i<win.length;i+=2) nxt.push([win[i],win[i+1]]);
    matches=nxt; r++;
  }
  return rounds;
}
function prunePicks(rounds, picks){                // drop picks whose team is no longer in its matchup
  let changed=false;
  (rounds||[]).forEach(rd=>rd.forEach(m=>{
    if(m.pick && m.pick!==m.a && m.pick!==m.b){ delete picks[m.key]; changed=true; }
  }));
  return changed;
}
// render a prediction bracket as an aligned tree with connector lines (reuses the .bkt layout).
// `inner(m)` returns the two team cells for a match. Call drawConnectors afterwards.
function predBracketTree(rounds, RL, inner, extraCls){
  return `<div class="bkt-wrap"><div class="bkt ${extraCls||''}"><svg class="bkt-svg"></svg>${rounds.map((rd,ri)=>{
    const ms=rd.filter(m=>m.a!==PBYE && m.b!==PBYE);
    if(!ms.length) return '';
    return `<div class="bkt-round"><div class="bkt-round-title">${RL[ri]||('Round '+(ri+1))}</div>`+
      `<div class="bkt-round-matches">${ms.map(m=>{const s=+String(m.key).split('m')[1]; return `<div class="bkt-match" data-round="${ri}" data-slot="${s}">${inner(m,ri)}</div>`;}).join("")}</div></div>`;
  }).join("")}</div></div>`;
}
function predPlacements(rounds){                   // predicted champ / runner-up / SF losers / QF losers
  if(!rounds) return {champ:null,ru:null,sf:[],qf:[]};
  const nb=t=>(t&&t!==PBYE)?t:null;               // ignore bye padding
  const R=rounds.length; const fin=rounds[R-1][0];
  const champ=nb(fin.pick), ru=champ?nb(champ===fin.a?fin.b:fin.a):null;
  const loser=m=>m.pick&&m.pick!==PBYE?nb(m.pick===m.a?m.b:m.a):null;
  const sf=R>=2?rounds[R-2].map(loser).filter(Boolean):[];
  const qf=R>=3?rounds[R-3].map(loser).filter(Boolean):[];
  return {champ, ru, sf, qf};
}
function actualResults(tr){
  if(!tr.champion) return null;
  const per=predPerGroup(tr), lb=tr.leaderboard;
  const groups={}; predGroups(tr).forEach(g=>{ groups[g.name]=(g.standings||[]).slice(0,per).map(s=>s.name); });
  const fs=tr.finalStandings||[];
  return { groups, champ:(fs.find(s=>s.result==='Champion')||{}).name,
           board: lb&&lb.complete ? (lb.rows||[]).map(r=>r.name) : null,
           ru:(fs.find(s=>s.result==='Runner-up')||{}).name,
           // by final rank, so bracket events and leaderboard events (no playoff games) score the same way
           f4:fs.filter(s=>s.result!=='Group Stage' && s.rank<=4).map(s=>s.name),
           f8:fs.filter(s=>s.result!=='Group Stage' && s.rank<=8).map(s=>s.name) };
}
function scorePrediction(pred, tr, actual){
  if(!actual) return null;
  let pts=0;
  Object.entries(pred.groups||{}).forEach(([g,picks])=>{
    const act=actual.groups[g]||[];
    (picks||[]).forEach((team,i)=>{ if(team && act.includes(team)){ pts+=3; if(act[i]===team) pts+=1; } });
  });
  const pl=predPicks(tr,pred);
  if(pl.champ && pl.champ===actual.champ) pts+=10;
  if(pl.ru && (pl.ru===actual.champ||pl.ru===actual.ru)) pts+=6;
  pl.sf.forEach(t=>{ if(actual.f4.includes(t)) pts+=4; });
  // a playoff-only bracket of 8: every team in it finishes top 8, so quarterfinalist picks earn nothing
  if(!(predPlayoffsOnly(tr) && predSeeds(tr,pred).length<=8)) pl.qf.forEach(t=>{ if(actual.f8.includes(t)) pts+=2; });
  if(pl.board && actual.board) pl.board.forEach((t,i)=>{ if(t && actual.board[i]===t) pts+=1; });   // exact leaderboard spot
  return pts;
}

let _pred = null, _predTr = null, _predRosters = {};
function predRAttr(name){ const i = _predRosters[normKey(name||'')]; return i!=null ? ` data-roster="${i}"` : ''; }
async function renderPredict(slug){
  const tr = (DATA.tournaments||[]).find(t=>t.slug===slug);
  if(!tr){ app.innerHTML = notFound("Event"); return; }
  if(!predSupported(tr)){ app.innerHTML = `<div class="notice">Predictions aren't available for this event's format.</div>`; return; }
  if(predPlayoffsOnly(tr) && !predSeeds(tr,{}).length){
    app.innerHTML = `<div class="crumb"><a href="#/tournament/${tr.slug}">${esc(tr.name)}</a><span class="sep">/</span>Predictions</div>
      <h2 class="section-title"><span class="accent-bar"></span>Predictions · ${esc(tr.name)}</h2>
      <div class="notice" style="text-align:left">🔒 <strong>Predictions open for the playoffs.</strong>
        They're closed during the group stage. Once the groups are over and the playoff bracket is set, you pick every playoff winner through to the champion.
        Predictions then lock when the first playoff match is played.</div>`;
    return;
  }
  _predTr = tr; _predAll = null;
  _predRosters = {};                        // team -> PAGE_ROSTERS index (hover shows the line-up)
  (tr.attending||[]).forEach(row=>{ if(row.players && row.players.length) _predRosters[normKey(row.team)] = rosterIdx({team:row.team, teamSlug:row.teamSlug, players:row.players}); });
  const u = predUser();
  _pred = await PredictBackend.loadMine(slug, u.uid) || { event:slug, uid:u.uid, name:u.name, groups:{}, bracket:{} };
  if(u.name && !_pred.name) _pred.name = u.name;
  drawPredict();
}
function drawPredict(){
  const tr=_predTr, pred=_pred; const gs=predGroups(tr);
  const u=predUser();
  const isBoard=predIsBoard(tr), per=predPerGroup(tr);
  // a team already picked in another slot of the same group can't be picked again
  const teamOpt=(sel, list, taken)=>`<option value="">—</option>`+list.map(t=>`<option value="${esc(t[0])}" ${sel===t[0]?'selected':''}${sel!==t[0]&&taken.includes(t[0])?' disabled':''}>${esc(t[0])}</option>`).join("");
  const groupCards = gs.map(g=>{
    const pk=(pred.groups[g.name]||[]);
    const chips = g.teams.map(t=>{ const nm=t[0]; const tm=teamByName(nm);
      return `<span class="pg-team"${predRAttr(nm)}>${tm&&tm.logo?`<img class="pg-tlogo" src="${esc(tm.logo)}" alt="">`:''}${esc(nm)}</span>`; }).join("");
    return `<div class="pg-card"><div class="pg-h">${esc(g.name)}</div>
      <div class="pg-teams">${chips}</div>
      ${Array.from({length:per},(_,i)=>`<label class="pg-l"><span class="pg-pos">${placeOrd(i+1)}</span> <select class="pg-sel" data-g="${esc(g.name)}" data-pos="${i}">${teamOpt(pk[i], g.teams, pk)}</select></label>`).join("")}</div>`;
  }).join("");
  let rounds=null, bracketHtml='', boardHtml='', pl;
  if(isBoard){
    const board=predBoard(tr,pred);
    if(board) pred.board=board;                     // keep the saved order in step with the group picks
    const where={}; gs.forEach(g=>(pred.groups[g.name]||[]).forEach((t,i)=>{ if(t) where[t]=[g.name.replace('Group ',''), i+1]; }));
    const tier=i=>i===0?'Champion':i===1?'Runner-up':i===2?'Top 4':i===4?'Top 8':'';
    boardHtml = !board
      ? `<p class="muted">Pick the top ${per} of all ${gs.length} groups to unlock the leaderboard.</p>`
      : `<div class="plb" style="--plb-rows:${Math.ceil(board.length/2)}">${board.map((t,i)=>`<div class="plb-row${i===0?' plb-champ':''}${[0,1,3,7].includes(i)?' plb-cut':''}" draggable="true" data-i="${i}"${predRAttr(t)}>
          <span class="plb-rk">${i+1}</span>${crestMini(t)}
          ${where[t]?`<span class="plb-g" title="Your ${placeOrd(where[t][1])} pick in Group ${esc(where[t][0])}">${esc(where[t][0])}${where[t][1]}</span>`:''}
          ${tier(i)?`<span class="plb-tier">${tier(i)}</span>`:''}
          <span class="plb-mvs"><button class="plb-mv" data-i="${i}" data-d="-1"${i===0?' disabled':''} title="Move up">▲</button><button class="plb-mv" data-i="${i}" data-d="1"${i===board.length-1?' disabled':''} title="Move down">▼</button></span></div>`).join("")}</div>
        <div class="muted" style="font-size:11px;margin-top:6px">Scoring: your #1 is the champion +10 · your #2 finishes top 2 +6 · each of your #3-4 finishes top 4 +4 · each of your #5-8 finishes top 8 +2 · every team on its exact spot +1. Group qualifiers: +3 each, +1 for the exact group placing.</div>`;
    pl=predPicks(tr,pred);
  } else {
    const seeds=predSeeds(tr,pred);
    rounds=bracketRounds(seeds, pred.bracket);
    if(rounds && prunePicks(rounds, pred.bracket)) rounds=bracketRounds(seeds, pred.bracket);
    const RL=roundLabels(rounds?rounds.length:0);
    bracketHtml = !rounds
      ? `<p class="muted">Pick a 1st and 2nd for all ${gs.length} groups to unlock the bracket.</p>`
      : predBracketTree(rounds, RL, m=>{
          const bt=(t)=>`<div class="pbk-team ${m.pick===t?'pk':''} ${t?'':'tbd'}" data-key="${m.key}" data-team="${esc(t||'')}"${t?predRAttr(t):''}>${t?crestMini(t):'<span class=muted>TBD</span>'}</div>`;
          return `${bt(m.a)}${bt(m.b)}`;
        });
    pl=predPlacements(rounds);
  }
  const actual=actualResults(tr);
  const myScore = actual ? scorePrediction(pred, tr, actual) : null;
  const poStarted = predPlayoffsOnly(tr) && predPlayoffStarted(tr);
  const locked = !!(tr.champion || tr.predictionsLocked || poStarted);
  const statusMsg = tr.champion ? 'Results are in — predictions locked.'
    : poStarted ? 'The playoffs have started — predictions are locked.'
    : tr.predictionsLocked ? 'The tournament has started — predictions are locked.'
    : isBoard ? 'Pick your group qualifiers and rank the final leaderboard, then Save.'
    : gs.length ? 'Pick your group qualifiers and bracket, then Save.'
    : 'Pick the bracket winners through to the champion, then Save.';
  app.innerHTML = `
    <div class="crumb"><a href="#/tournament/${tr.slug}">${esc(tr.name)}</a><span class="sep">/</span>Predictions</div>
    <h2 class="section-title"><span class="accent-bar"></span>Predictions · ${esc(tr.name)}
      <span class="muted" style="font-size:11px">${PredictBackend.isShared?'shared leaderboard':'saved in your browser'}</span></h2>
    <div class="notice" style="text-align:left;margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <strong>Your name:</strong>
        <input id="pred-name" class="adm-in" style="max-width:220px;margin:0" placeholder="e.g. Alice" value="${esc(pred.name||'')}">
        <span id="pred-status" class="muted" style="font-size:12px">${statusMsg}</span>
      </div>
    </div>
    ${locked?`<div class="notice" style="text-align:left;margin-bottom:14px;border-color:var(--accent)">
      🔒 <strong>${tr.champion?'This event is over.':poStarted?'The playoffs are underway.':'This tournament is underway.'}</strong>
      Predictions are locked — no new entries or edits. See the standings below.</div>`
    :`${gs.length?`<h3 class="rec-group">Group Qualifiers <span class="muted" style="font-size:11px">top ${per} advance${isBoard?' to the final leaderboard':''}</span></h3>
    <div class="pg-grid">${groupCards}</div>
    <h3 class="rec-group" style="margin-top:18px">${isBoard
      ?`Final Leaderboard <span class="muted" style="font-size:11px">rank your ${gs.length*per} qualifiers · drag or use the arrows · #1 is the champion</span>`
      :'Playoff Bracket'}</h3>`:`<h3 class="rec-group">${predPlayoffsOnly(tr)?'Playoff Bracket':'Bracket'} <span class="muted" style="font-size:11px">pick every winner</span></h3>`}
    ${isBoard?boardHtml:bracketHtml}
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
      <button id="pred-save" class="adm-btn" style="max-width:220px">Save prediction</button>
      <span class="muted" style="font-size:12px">Your champion: <strong>${pl.champ?esc(pl.champ):'—'}</strong></span>
      <span id="pred-savemsg" class="muted" style="font-size:12px"></span>
    </div>`}
    ${myScore!=null?`<div class="notice" style="margin-top:14px"><strong>Your score: ${myScore} pts</strong></div>`:''}
    <h2 class="section-title" style="margin-top:24px"><span class="accent-bar"></span>Leaderboard</h2>
    <div id="pred-board"><p class="muted">Loading…</p></div>`;
  // group selects
  app.querySelectorAll('.pg-sel').forEach(sel=>sel.onchange=()=>{
    const g=sel.dataset.g, pos=+sel.dataset.pos;
    const arr=(pred.groups[g]=pred.groups[g]||[]), old=arr[pos];
    arr[pos]=sel.value||null;
    // swapping a qualifier keeps its spot on the predicted leaderboard
    if(pred.board && old && sel.value){ const k=pred.board.indexOf(old); if(k>=0 && !pred.board.includes(sel.value)) pred.board[k]=sel.value; }
    drawPredict();
  });
  // leaderboard reordering: arrows, or drag a row onto another spot
  app.querySelectorAll('.plb-mv').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation(); const b=pred.board, i=+btn.dataset.i, j=i+(+btn.dataset.d);
    if(!b || j<0 || j>=b.length) return;
    [b[i],b[j]]=[b[j],b[i]]; drawPredict();
  });
  let dragI=null;
  app.querySelectorAll('.plb-row').forEach(row=>{
    row.ondragstart=e=>{ dragI=+row.dataset.i; row.classList.add('drag'); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', String(dragI)); }catch(_){} };
    row.ondragend=()=>{ row.classList.remove('drag'); app.querySelectorAll('.plb-row.over').forEach(x=>x.classList.remove('over')); };
    row.ondragover=e=>{ if(dragI==null) return; e.preventDefault(); row.classList.add('over'); };
    row.ondragleave=()=>row.classList.remove('over');
    row.ondrop=e=>{ e.preventDefault(); const to=+row.dataset.i, b=pred.board;
      if(dragI==null || dragI===to || !b) return;
      const [t]=b.splice(dragI,1); b.splice(to,0,t); dragI=null; drawPredict(); };
  });
  // bracket clicks
  app.querySelectorAll('.pbk-team').forEach(el=>el.onclick=()=>{
    const t=el.dataset.team; if(!t) return;
    pred.bracket[el.dataset.key]=t; drawPredict();
  });
  const nameInput=$("#pred-name"); if(nameInput) nameInput.oninput=()=>{ pred.name=nameInput.value; localStorage.setItem('bpl_pname', nameInput.value.trim()); };
  const saveBtn=$("#pred-save");
  if(saveBtn) saveBtn.onclick=async ()=>{
    if(!(pred.name||'').trim()){ $("#pred-savemsg").textContent="Enter a name first."; return; }
    if((pred.name||'').trim().length>40){ $("#pred-savemsg").style.color="var(--accent2,#ff6b6b)"; $("#pred-savemsg").textContent="Name too long — max 40 characters."; return; }
    saveBtn.disabled=true; $("#pred-savemsg").textContent="Saving…";
    pred.name=pred.name.trim(); pred.ts=Date.now();
    try{ await PredictBackend.save(pred); $("#pred-savemsg").style.color="var(--good)"; $("#pred-savemsg").textContent="Saved!"; loadPredBoard(true); }
    catch(e){ $("#pred-savemsg").style.color="var(--accent2,#ff6b6b)"; $("#pred-savemsg").textContent="Save failed: "+e.message; }
    saveBtn.disabled=false;
  };
  drawAllConnectors(app);
  loadPredBoard();
}
function crestMini(name){ const t=teamByName(name); return `${t?`<img class="pbk-logo" src="${esc(t.logo||'')}" alt="">`:''}<span class="pbk-nm">${esc(name)}</span>`; }
// every saved prediction for the open event, fetched once per visit (and again after a save), so
// redrawing the page while you pick doesn't re-query the backend on every click
let _predAll = null;
async function loadPredBoard(refresh){
  const box=$("#pred-board"); if(!box) return; const tr=_predTr;
  if(refresh || !_predAll || _predAll.slug!==tr.slug){
    try{ _predAll={slug:tr.slug, list:await PredictBackend.loadAll(tr.slug)}; }
    catch(e){ box.innerHTML=`<p class="muted">Couldn't load leaderboard: ${esc(e.message)}</p>`; return; }
  }
  const all=_predAll.list;
  if(!all.length){ box.innerHTML='<p class="muted">No predictions yet — be the first!</p>'; return; }
  const actual=actualResults(tr);
  const rows=all.map(p=>({p, name:p.name||'anon', champ:predPicks(tr,p).champ,
                          score: actual?scorePrediction(p,tr,actual):null}))
    .sort((a,b)=> (b.score||0)-(a.score||0) || (a.name||'').localeCompare(b.name||''));
  box.innerHTML=`<div class="tablewrap" style="max-width:520px"><table class="data">
    <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Predictor</th><th class="no-sort">Champion pick</th>${actual?'<th class="no-sort">Score</th>':''}</tr></thead>
    <tbody>${rows.map((r,i)=>`<tr class="pred-row" data-pi="${i}"><td class="rankcol">${i+1}</td><td>${esc(r.name)}</td>
      <td>${r.champ?teamCell(r.champ):'<span class="muted">—</span>'}</td>
      ${actual?`<td class="mono">${r.score!=null?r.score:'—'}</td>`:''}</tr>`).join("")}</tbody></table></div>
    <div class="muted" style="font-size:11px;margin-top:4px">Click a name to see their full prediction.</div>
    ${actual?'':'<p class="muted" style="font-size:12px;margin-top:4px">Scores appear once the event finishes.</p>'}
    <div id="pred-detail" style="margin-top:14px"></div>`;
  box.querySelectorAll('.pred-row').forEach(row=>row.onclick=()=>{
    box.querySelectorAll('.pred-row').forEach(x=>x.classList.remove('sel')); row.classList.add('sel');
    renderPredDetail(rows[+row.dataset.pi].p);
  });
}
// after an event finishes, grade a prediction against the real results.
const _STAGE_REMAIN = {'Champion':1,'Runner-up':2,'Semifinals':4,'3rd Place':4,'4th Place':4,
  'Quarterfinals':8,'Round of 8':8,'Round of 16':16,'Round of 32':32,'Round of 64':64,'Round of 128':128};
function actualReach(tr){   // team -> smallest "teams remaining" stage it reached (1 = champion)
  const m={}; (tr.finalStandings||[]).forEach(s=>{ const r=_STAGE_REMAIN[s.result]; if(r!=null) m[normKey(s.name)]=r; });
  return m;
}
function renderPredDetail(pred){
  const box=$("#pred-detail"); if(!box) return; const tr=_predTr;
  const gs=predGroups(tr), per=predPerGroup(tr);
  const actual=actualResults(tr);                 // null until the event finishes
  const reach=actual?actualReach(tr):null;
  const groupHtml=`<div class="pd-groups">${gs.map(g=>{ const pk=(pred.groups||{})[g.name]||[];
    const cls=(team,pos)=>{ if(!actual||!team) return ''; const act=actual.groups[g.name]||[];
      return act.includes(team)?(act[pos]===team?' correct exact':' correct'):' wrong'; };
    const q=(team,pos)=>`<span class="pd-q${pos?' pd-q2':''}${cls(team,pos)}">${pos+1} ${team?esc(team):'—'}</span>`;
    return `<div class="pd-g"><span class="pd-gh">${esc(g.name.replace('Group ',''))}</span>${Array.from({length:per},(_,i)=>q(pk[i],i)).join("")}</div>`; }).join("")}</div>`;
  const pl=predPicks(tr,pred);
  let finalHtml, finalLabel;
  if(pl.board){
    // leaderboard event: their ranked qualifiers, graded on the real final leaderboard
    finalLabel='Final leaderboard';
    const actRank={}; (actual&&actual.board||[]).forEach((t,i)=>actRank[normKey(t)]=i+1);
    const need=i=>i===0?1:i===1?2:i<4?4:i<8?8:null;   // the finish each scored spot has to reach
    const grade=(t,i)=>{ if(!actual||!actual.board) return ''; const r=actRank[normKey(t)];
      if(r===i+1) return ' correct exact'; const n=need(i);
      return (n && r && r<=n) ? ' correct' : (n || !r) ? ' wrong' : ''; };
    finalHtml=`<div class="plb plb-ro" style="--plb-rows:${Math.ceil(pl.board.length/2)}">${pl.board.map((t,i)=>{ const r=actRank[normKey(t)];
      return `<div class="plb-row${i===0?' plb-champ':''}${[0,1,3,7].includes(i)?' plb-cut':''}${grade(t,i)}"${predRAttr(t)}>
        <span class="plb-rk">${i+1}</span>${crestMini(t)}${actual&&actual.board?`<span class="plb-act" title="Their real finish">${r?'#'+r:'out'}</span>`:''}</div>`; }).join("")}</div>`;
  } else {
    finalLabel='Playoff bracket';
    const rounds=bracketRounds(predSeeds(tr,pred), pred.bracket||{});
    const RL=roundLabels(rounds?rounds.length:0);
    const R=rounds?rounds.length:0;
    const grade=(team,ri)=>{ if(!reach||!team) return ''; const need=Math.pow(2, R-ri-1);
      return (reach[normKey(team)]!=null && reach[normKey(team)]<=need)?' correct':' wrong'; };
    finalHtml = rounds ? predBracketTree(rounds, RL, (m,ri)=>{
        const cell=x=>`<div class="pbk-team ${m.pick===x?'pk':''} ${x?'':'tbd'}${(x&&m.pick===x)?grade(x,ri):''}"${x?predRAttr(x):''}>${x?crestMini(x):'<span class=muted>TBD</span>'}</div>`;
        return `${cell(m.a)}${cell(m.b)}`; }, 'pbk-ro')
      : `<p class="muted">${predIsBoard(tr)?'Leaderboard':'Bracket'} not filled in.</p>`;
  }
  box.innerHTML=`<h3 class="rec-group" style="margin-top:0">${esc(pred.name||'anon')}'s prediction
    <span class="muted" style="font-size:11px">champion: ${pl.champ?esc(pl.champ):'—'}</span>
    ${actual?`<span class="pd-legend"><span class="pd-key correct">correct</span><span class="pd-key wrong">wrong</span></span>`:''}</h3>
    ${gs.length?`<div class="pd-sub muted">Group qualifiers</div>${groupHtml}<div class="pd-sub muted" style="margin-top:10px">${finalLabel}</div>`:''}${finalHtml}`;
  drawAllConnectors(box);
  box.scrollIntoView({behavior:'smooth', block:'nearest'});
}

// ---- Prophets: all-time cross-event predictions leaderboard ----
async function renderProphets(){
  app.innerHTML = `<h2 class="section-title"><span class="accent-bar"></span>Prophets
      <span class="muted" style="font-size:11px">all-time prediction leaderboard · ${PredictBackend.isShared?'shared':'this browser'}</span></h2>
    <div id="proph-out"><p class="muted">Loading predictions…</p></div>`;
  let all=[]; try{ all=await PredictBackend.loadEverything(); }catch(e){ $("#proph-out").innerHTML=`<p class="muted">Couldn't load the leaderboard: ${esc(e.message)}</p>`; return; }
  if(!all.length){ $("#proph-out").innerHTML='<p class="muted">No predictions yet — open a group-stage tournament and make some!</p>'; return; }
  const trBySlug={}; (DATA.tournaments||[]).forEach(t=>trBySlug[t.slug]=t);
  const aCache={}; const actualFor=slug=>{ if(!(slug in aCache)){ const tr=trBySlug[slug]; aCache[slug]=tr?actualResults(tr):null; } return aCache[slug]; };
  const byUid={};
  all.forEach(p=>{
    const uid=p.uid||p.name; if(!uid) return;
    const tr=trBySlug[p.event]; if(!tr) return;
    const u=byUid[uid]||(byUid[uid]={name:p.name||'anon', total:0, scored:0, pending:0, best:0, bestEv:'', champHits:0, champTries:0, ts:0});
    if((p.ts||0)>=u.ts){ u.ts=p.ts||0; u.name=p.name||u.name; }
    const actual=actualFor(p.event);
    if(actual){
      const sc=scorePrediction(p,tr,actual)||0; u.total+=sc; u.scored++;
      if(sc>u.best){ u.best=sc; u.bestEv=tr.name; }
      const champ=predPicks(tr,p).champ;
      if(champ){ u.champTries++; if(champ===actual.champ) u.champHits++; }
    } else { u.pending++; }
  });
  const rows=Object.values(byUid).filter(u=>u.scored||u.pending)
    .sort((a,b)=> b.total-a.total || b.best-a.best || (a.name||'').localeCompare(b.name||''));
  const medal=i=> i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
  $("#proph-out").innerHTML = `<div class="tablewrap" style="max-width:720px"><table class="data">
    <thead><tr><th class="no-sort rankcol">#</th><th class="no-sort">Predictor</th><th class="no-sort" title="Total points across all finished events">Points</th>
      <th class="no-sort" title="Finished events scored">Events</th><th class="no-sort" title="Correct champion picks">Champ %</th>
      <th class="no-sort" title="Best single-event score">Best</th><th class="no-sort" title="Predictions on events not yet finished">Live</th></tr></thead>
    <tbody>${rows.map((u,i)=>`<tr>
      <td class="rankcol">${medal(i)}</td>
      <td>${esc(u.name)}</td>
      <td class="mono"><strong>${u.total}</strong></td>
      <td class="mono">${u.scored}</td>
      <td class="mono">${u.champTries?Math.round(100*u.champHits/u.champTries)+'%':'—'}</td>
      <td class="mono" title="${esc(u.bestEv||'')}">${u.best||'—'}</td>
      <td class="mono muted">${u.pending||'—'}</td>
    </tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:11px;margin-top:6px">${rows.length} predictor${rows.length===1?'':'s'} · scoring: correct qualifier +3 (exact spot +1), champion +10, finalist +6, semifinalist +4, quarterfinalist +2.
      On leaderboard events (no playoffs) your #1 is the champion pick, #2 the finalist, #3-4 the semifinalists and #5-8 the quarterfinalists, plus +1 for every team on its exact spot.</p>`;
}

// ---------- creator socials "sponsored" slot (randomized) ----------
const TW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>';
const PROMOS = [
  { net:'youtube', label:'YouTube', color:'#ff0033', cta:'Subscribe', ctaText:'#fff', handle:'@cgreyice',
    head:'Watch bot highlights, or my funny videos', url:'https://www.youtube.com/@cgreyice',
    icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
  { net:'twitch', label:'Twitch', color:'#9146ff', cta:'Follow', ctaText:'#fff', handle:'cgreyice',
    head:'I stream all sorts of content here', url:'https://www.twitch.tv/cgreyice', icon:TW_ICON },
  { net:'twitch', label:'Twitch', color:'#9146ff', cta:'Follow', ctaText:'#fff', handle:'cgrycei',
    head:'Catch our BPL games here', url:'https://www.twitch.tv/cgrycei', icon:TW_ICON },
  { net:'x', label:'X', color:'#d9dbdd', cta:'Follow', ctaText:'#0a0d16', handle:'@CGreyIce',
    head:'Follow my Twitter for more cool clips or funny posts', url:'https://x.com/CGreyIce',
    icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z"/></svg>' },
];
function renderPromo(){
  const slot = document.getElementById('promo-slot'); if(!slot) return;
  const p = PROMOS[Math.floor(Math.random()*PROMOS.length)];
  slot.innerHTML = `<div class="promo promo-${p.net}" style="--net:${p.color}">
      <span class="promo-tag">Ad</span>
      <span class="promo-ico">${p.icon}</span>
      <a class="promo-body" href="${p.url}" target="_blank" rel="noopener noreferrer">
        <span class="promo-head">${p.head}</span>
        <span class="promo-sub">${p.label} · <strong>${esc(p.handle)}</strong></span>
      </a>
      <a class="promo-cta" href="${p.url}" target="_blank" rel="noopener noreferrer" style="color:${p.ctaText}">${p.cta}</a>
    </div>`;
}

loadData().then(async d=>{
  DATA = d;
  try{ _adminOn = ((await (await fetch("/api/state")).json()).admin === true); }catch(e){ _adminOn = false; }
  setupSearch();
  setupRosterPop();
  setupFormTip();
  setupHistoryCharts();
  setupPeakTip();
  setupNav();
  window.addEventListener("hashchange", router);
  router();
  setTimeout(liveStart, 1200);   // live scores: only loads Firebase while an event is running
  setTimeout(liveMatchesStart, 1400);   // matches being played right now, for the LIVE bars
  liveRelayStart();              // admin only: relay live map scores from the BPL Bots app
}).catch(e=>{ app.innerHTML = `<div class="notice"><h2>Couldn't load data</h2><p>${esc(e.message)}</p>
  <p class="muted">If you opened index.html directly, run a local server instead (browsers block fetch on file://).</p></div>`; });

})();
