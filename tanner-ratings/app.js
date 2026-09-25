'use strict';
const $ = id => document.getElementById(id);
const state = { snapshots: [], cache: new Map(), current: null, history: [], expanded: false, sort: 'rating', direction: -1, token: 0 };
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value).toFixed(2);
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
const record = team => `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
const initials = name => name.split(/\s+/).map(word => word[0]).join('').slice(0,3).toUpperCase();
let logos = {};
function teamBadge(name, extra = '') {
  const logo = logos[name];
  return `<span class="team-badge ${extra}" aria-hidden="true"><span class="badge-fallback">${escapeHTML(initials(name))}</span>${logo ? `<img src="${escapeHTML(logo.path)}" alt="" width="40" height="40" loading="lazy">` : ''}</span>`;
}
document.addEventListener('error', event => {
  if (event.target.matches?.('.team-badge img')) event.target.remove();
}, true);
const divisionName = value => ({fbs:'FBS',fcs:'FCS',ii:'Division II',iii:'Division III',unknown:'Other / unclassified',all:'All divisions'}[value] || value);
const rankFor = (team, division = $('division').value) => division === 'all' ? team.rank : team.divisionRank;
const roundedMargin = value => Math.sign(value) * Math.round(Math.abs(value) * 2) / 2;
function prediction(home, away, margin) {
  if (margin === null || margin === undefined) return 'No line · team not yet rated';
  const rounded = roundedMargin(margin);
  return rounded === 0 ? "Pick’em" : `${rounded > 0 ? home : away} −${Math.abs(rounded).toFixed(1)}`;
}
async function fetchJSON(path) {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}
async function loadSnapshot(entry) {
  if (!state.cache.has(entry.path)) state.cache.set(entry.path, await fetchJSON(`data/${entry.path}`));
  return state.cache.get(entry.path);
}
function teamHistory(name) {
  const division = $('division').value;
  return state.history.map(snapshot => {
    const team = snapshot.teams.find(t => t.team === name);
    return { week: snapshot.week, rank: team && (division === 'all' || team.classification === division) ? rankFor(team) : null };
  });
}
function sparkline(history) {
  const values = history.map(h => h.rank).filter(rank => rank !== null);
  if (values.length < 2) return '<span class="neutral" title="Rank history is not yet available">—</span>';
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const points = history.map((h,i) => h.rank === null ? null : `${3 + i * 70 / Math.max(1,history.length - 1)},${3 + (h.rank - min) / range * 19}`);
  const segments = points.reduce((parts, point) => { if (point === null) parts.push([]); else parts[parts.length - 1].push(point); return parts; }, [[]]);
  return `<svg class="spark" viewBox="0 0 76 25" role="img" aria-label="Rank history: ${values.join(', ')}">${segments.filter(s => s.length).map(s => `<polyline fill="none" stroke="currentColor" stroke-width="1.8" points="${s.join(' ')}"/>`).join('')}</svg>`;
}
function populateConferences() {
  const old = $('conference').value, division = $('division').value;
  const conferences = [...new Set(state.current.teams.filter(t => division === 'all' || t.classification === division).map(t => t.conference))].sort();
  $('conference').replaceChildren(new Option('All conferences','all'), ...conferences.map(c => new Option(c,c)));
  if (conferences.includes(old)) $('conference').value = old;
}
function renderBoard() {
  const division = $('division').value, query = $('search').value.trim().toLocaleLowerCase(), conference = $('conference').value;
  let teams = state.current.teams.filter(t => (division === 'all' || t.classification === division) && (conference === 'all' || t.conference === conference) && t.team.toLocaleLowerCase().includes(query));
  teams.sort((a,b) => state.direction * (a[state.sort] - b[state.sort]) || a.rank - b.rank);
  const previous = state.history.at(-2);
  const oldTeams = new Map((previous?.teams || []).map(t => [t.team,t]));
  const maxRating = Math.max(...state.current.teams.map(t=>t.rating)), minRating = Math.min(...state.current.teams.map(t=>t.rating));
  $('ranking-body').innerHTML = (state.expanded ? teams : teams.slice(0,25)).map(team => {
    const old = oldTeams.get(team.team), comparable = old && (division === 'all' || old.classification === team.classification);
    const delta = comparable ? rankFor(old) - rankFor(team) : null;
    const move = !previous ? '<span class="neutral">—</span>' : delta === null ? '<span class="neutral">NEW</span>' : delta === 0 ? '<span class="neutral">—</span>' : `<span class="${delta > 0 ? 'positive':'negative'}">${delta > 0 ? '↑':'↓'} ${Math.abs(delta)}</span>`;
    return `<tr class="${rankFor(team) <= 3 ? 'rank-top':''}"><td>${String(rankFor(team)).padStart(2,'0')}</td><td class="movement">${move}</td><td><button class="team-button" data-team="${escapeHTML(team.team)}">${teamBadge(team.team)}<span>${escapeHTML(team.team)}<span class="team-conference">${escapeHTML(team.conference)}${division === 'all' ? ` · ${divisionName(team.classification)}`:''}</span></span></button></td><td>${record(team)}</td><td class="rating-value">${signed(team.rating)}<div class="rating-bar" aria-hidden="true"><span style="width:${20 + 80 * (team.rating - minRating) / (maxRating - minRating || 1)}%"></span></div></td><td>${signed(team.scheduleStrength)}</td><td>${sparkline(teamHistory(team.team))}</td></tr>`;
  }).join('');
  $('result-count').textContent = `${state.expanded ? teams.length : Math.min(25,teams.length)} of ${teams.length} teams · ${divisionName(division)}`;
  $('movement-note').textContent = previous ? `Movement vs. Week ${previous.week} · ${state.current.season}` : `First weekly ranking`;
  $('empty').hidden = teams.length > 0;
  $('show-more').hidden = teams.length <= 25;
  $('show-more').textContent = state.expanded ? 'Show top 25' : `Show all ${teams.length} teams`;
  $('sort-rating').textContent = `Rating ${state.sort === 'rating' ? state.direction === -1 ? '↓':'↑':'↕'}`;
  $('sort-sos').textContent = `Schedule ${state.sort === 'scheduleStrength' ? state.direction === -1 ? '↓':'↑':'↕'}`;
  $('sort-rating').closest('th').setAttribute('aria-sort',state.sort === 'rating' ? state.direction === -1 ? 'descending':'ascending':'none');
  $('sort-sos').closest('th').setAttribute('aria-sort',state.sort === 'scheduleStrength' ? state.direction === -1 ? 'descending':'ascending':'none');
}
function renderFixtures() {
  const division = $('division').value;
  const ratings = new Map(state.current.teams.map(team => [team.team, team.rating]));
  const combinedRating = game => ratings.has(game.home) && ratings.has(game.away)
    ? ratings.get(game.home) + ratings.get(game.away) : -Infinity;
  const fixtures = state.current.fixtures
    .filter(g => division === 'all' || g.classification === division || g.awayClassification === division)
    .sort((a, b) => combinedRating(b) - combinedRating(a) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  $('fixtures-title').textContent = `Week ${state.current.week} · predicted lines`;
  $('fixtures').innerHTML = fixtures.length ? fixtures.map(g => `<div class="fixture"><div><strong class="fixture-teams"><span class="fixture-team">${teamBadge(g.away)}${escapeHTML(g.away)}</span> <span class="neutral">${g.neutral ? 'vs.':'at'}</span> <span class="fixture-team">${teamBadge(g.home)}${escapeHTML(g.home)}</span></strong><small>${escapeHTML(new Date(g.date).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Denver'}))}${g.neutral ? ' · Neutral site':''}</small></div><span class="fixture-edge">${escapeHTML(prediction(g.home,g.away,g.homeEdge))}</span></div>`).join('') : '<p class="fine-print">No upcoming games available for this division this week.</p>';
}
function renderComparison() {
  const a = state.current.teams.find(t => t.team === $('team-a').value), b = state.current.teams.find(t => t.team === $('team-b').value);
  if (!a || !b) { $('comparison').textContent = 'Choose two rated teams.'; return; }
  $('comparison').innerHTML = `<span class="edge-label">PROJECTED LINE / NEUTRAL FIELD</span><strong>${escapeHTML(a.team === b.team ? 'Choose two different teams' : prediction(a.team,b.team,a.rating - b.rating))}</strong><p>Rating difference rounded to the nearest half-point. No home-field adjustment.</p>`;
}
function populateComparison() {
  const teams = [...state.current.teams].sort((a,b) => a.team.localeCompare(b.team));
  const fbs = state.current.teams.filter(t=>t.classification === 'fbs');
  ['team-a','team-b'].forEach((id,i) => {
    const old = $(id).value;
    $(id).replaceChildren(...teams.map(t=>new Option(t.team,t.team)));
    $(id).value = teams.some(t=>t.team === old) ? old : (fbs[i] || teams[i] || teams[0])?.team || '';
  });
  renderComparison();
}
function openTeam(name) {
  const team = state.current.teams.find(t=>t.team === name);
  if (!team) return;
  const history = teamHistory(name), values = history.filter(h=>h.rank !== null);
  let chart = '<p class="history-list">Rank history will appear as the season progresses.</p>';
  if (values.length > 1) {
    const min = Math.min(...values.map(h=>h.rank)), max = Math.max(...values.map(h=>h.rank)), range = max - min || 1;
    const coords = history.map((h,i)=>h.rank === null ? null : {x:35 + i * 550 / Math.max(1,history.length - 1),y:25 + (h.rank - min) / range * 80,h});
    const paths = coords.reduce((parts,p)=>{if (!p) parts.push([]); else parts[parts.length-1].push(p);return parts;},[[]]);
    chart = `<svg class="history-chart" viewBox="0 0 620 150" role="img" aria-label="Weekly rank history">${paths.filter(p=>p.length).map(points=>`<polyline points="${points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#327144" stroke-width="2"/>`).join('')}${coords.filter(Boolean).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#d94e2a"/><text x="${p.x}" y="${p.y-10}" text-anchor="middle">#${p.h.rank}</text><text x="${p.x}" y="140" text-anchor="middle">W${p.h.week}</text>`).join('')}</svg><p class="history-list">${values.map(h=>`Week ${h.week}: #${h.rank}`).join(' · ')}</p>`;
  }
  $('team-detail').innerHTML = `<h2>${escapeHTML(name)}</h2><p class="detail-meta">${escapeHTML(team.conference)} · ${divisionName(team.classification)} · ${state.current.season} Week ${state.current.week}</p><div class="detail-stats"><div><span>RANK</span><strong>#${rankFor(team)}</strong></div><div><span>RATING</span><strong>${signed(team.rating)}</strong></div><div><span>RECORD</span><strong>${record(team)}</strong></div></div><h3>Season trajectory</h3>${chart}<h3>Games in the model</h3><div class="table-wrap"><table><thead><tr><th>Week</th><th>Opponent</th><th>Result</th><th>Score</th></tr></thead><tbody>${team.games.map(g=>`<tr><td>${g.week}</td><td>${g.venue === 'A' ? 'at ' : g.venue === 'N' ? 'vs. ' : ''}${escapeHTML(g.opponent)}</td><td class="${g.result === 'W' ? 'positive':g.result === 'L' ? 'negative':'neutral'}">${g.result}</td><td>${g.scored}–${g.allowed}</td></tr>`).join('')}</tbody></table></div>`;
  $('team-dialog').showModal();
}
let selectedShare = 'top10';
function renderShareGraphic() {
  const snapshot = state.current;
  if (!snapshot) return;
  const path = `share/${snapshot.season}/week-${String(snapshot.week).padStart(2, '0')}/${selectedShare}.png?v=${encodeURIComponent($('share-image').dataset.version || '1')}`;
  const title = {top10: 'FBS Top 10', matchups: 'FBS games to watch', schedules: 'FBS toughest schedules played', brawlers: 'Brawlers: competitive game support among the FBS Top 50', cupcakes: 'Cupcake Annihilators: dominance against weaker opponents'}[selectedShare];
  $('share-image').src = path;
  $('profile-data').href = `share/${snapshot.season}/week-${String(snapshot.week).padStart(2, '0')}/profile-metrics.json`;
  $('share-image').alt = `${snapshot.season} Week ${snapshot.week}: ${title}`;
  $('share-download').href = path;
  $('share-download').download = `prove-it-rankings-${snapshot.season}-week-${snapshot.week}-${selectedShare}.png`;
  document.querySelectorAll('[data-share]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.share === selectedShare)));
}
document.querySelectorAll('[data-share]').forEach(button => button.addEventListener('click', () => {
  selectedShare = button.dataset.share;
  renderShareGraphic();
}));

async function changeSnapshot() {
  const token = ++state.token;
  const entry = state.snapshots[Number($('snapshot').value)];
  $('snapshot').disabled = true;
  try {
    const current = await loadSnapshot(entry);
    const history = await Promise.all(state.snapshots.filter(s=>s.season === entry.season && s.week <= entry.week).map(loadSnapshot));
    if (token !== state.token) return;
    state.current = current; state.history = history; state.expanded = false;
    $('error').hidden = true;
    $('edition').textContent = `${current.season} SEASON · WEEK ${current.week}`;
    populateConferences(); populateComparison(); renderBoard(); renderFixtures(); renderShareGraphic();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = `Rankings could not be loaded. Please reload the page. ${error.message}`;
    $('result-count').textContent = 'Rankings unavailable';
  } finally { if (token === state.token) $('snapshot').disabled = false; }
}
$('division').addEventListener('change',()=>{if (!state.current) return;state.expanded=false;populateConferences();renderBoard();renderFixtures();});
$('conference').addEventListener('change',()=>{if (!state.current) return;state.expanded=false;renderBoard();});
$('search').addEventListener('input',()=>{if (!state.current) return;state.expanded=false;renderBoard();});
$('snapshot').addEventListener('change',changeSnapshot);
$('show-more').addEventListener('click',()=>{state.expanded=!state.expanded;renderBoard();});
['rating','sos'].forEach(id=>$( `sort-${id}` ).addEventListener('click',()=>{if (!state.current) return;const key=id==='rating'?'rating':'scheduleStrength';state.direction=state.sort===key?-state.direction:-1;state.sort=key;renderBoard();}));
$('ranking-body').addEventListener('click',event=>{const button=event.target.closest('[data-team]');if(button) openTeam(button.dataset.team);});
['team-a','team-b'].forEach(id=>$(id).addEventListener('change',()=>{if(state.current) renderComparison();}));
$('close-dialog').addEventListener('click',()=>$('team-dialog').close());
$('team-dialog').addEventListener('click',event=>{if(event.target === $('team-dialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)event.target.close();}});
(async()=>{
  try {
    const [manifest, logoIndex] = await Promise.all([fetchJSON('data/index.json'), fetchJSON('logos/index.json').catch(() => ({}))]);
    logos = logoIndex;
    state.snapshots = manifest.snapshots.sort((a,b)=>a.season-b.season || a.week-b.week);
    if (!state.snapshots.length) throw new Error('No weekly rankings are available yet.');
    $('snapshot').replaceChildren(...state.snapshots.map((s,i)=>new Option(`${s.season} · Week ${s.week}`,String(i))).reverse());
    $('snapshot').value = String(state.snapshots.length-1);
    await changeSnapshot();
  } catch (error) { $('error').hidden=false;$('error').textContent=`Rankings could not be loaded. ${error.message}`;$('result-count').textContent='Rankings unavailable'; }
})();
