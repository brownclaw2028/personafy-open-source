/**
 * Self-contained HTML page for the Personafy interactive demo.
 * No external dependencies — inline CSS + vanilla JS.
 */
export function getDemoHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personafy Interactive Demo</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f1117;--panel:#1a1d27;--border:#2a2d3a;--text:#e2e4ea;
  --text-dim:#8b8fa3;--accent:#6c5ce7;--accent-hover:#7c6cf7;
  --green:#00b894;--yellow:#fdcb6e;--red:#e17055;
  --code-bg:#12141c;--radius:8px;
}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--accent);text-decoration:none}

/* Layout */
.app{display:grid;grid-template-rows:auto 1fr;height:100vh}
.header{padding:16px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px}
.header h1{font-size:20px;font-weight:600;letter-spacing:-.3px}
.header .subtitle{color:var(--text-dim);font-size:13px}
.panels{display:grid;grid-template-columns:280px 1fr 320px;gap:1px;background:var(--border);overflow:hidden}
.panel{background:var(--panel);overflow-y:auto;padding:16px}
.panel h2{font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);margin-bottom:12px}

/* Left Panel — Vault Inspector */
.persona-card{background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px}
.persona-card h3{font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.persona-card .tag{font-size:10px;padding:2px 6px;border-radius:4px;background:var(--accent);color:#fff;font-weight:500}
.field-row{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--border)}
.field-row:last-child{border-bottom:none}
.field-key{color:var(--text-dim)}
.field-val{color:var(--text);font-family:monospace;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.rule-item{font-size:12px;padding:8px;background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:6px}
.rule-item .rule-meta{color:var(--text-dim);margin-top:4px}

.posture-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--radius);font-size:13px;font-weight:600;margin-bottom:12px}
.posture-badge.guarded{background:#fdcb6e22;color:var(--yellow);border:1px solid var(--yellow)}
.posture-badge.open{background:#00b89422;color:var(--green);border:1px solid var(--green)}
.posture-badge.locked{background:#e1705522;color:var(--red);border:1px solid var(--red)}

/* Center Panel — Activity Feed */
.feed{display:flex;flex-direction:column;gap:8px}
.step-card{background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.step-card .step-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.step-num{background:var(--accent);color:#fff;font-size:11px;font-weight:700;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step-label{font-size:13px;font-weight:500}
.step-card .decision-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-right:6px}
.decision-badge.approved{background:#00b89422;color:var(--green)}
.decision-badge.pending{background:#fdcb6e22;color:var(--yellow)}
.decision-badge.denied{background:#e1705522;color:var(--red)}
.step-highlight{font-size:12px;color:var(--text-dim);margin-top:6px;font-style:italic}
.step-details{font-size:11px;color:var(--text-dim);margin-top:8px;background:var(--bg);padding:8px;border-radius:4px;font-family:monospace;white-space:pre-wrap;max-height:120px;overflow-y:auto;display:none}
.step-card.expanded .step-details{display:block}
.step-toggle{font-size:11px;color:var(--accent);cursor:pointer;margin-top:4px;border:none;background:none;padding:0}

.feed-empty{color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0}

/* Right Panel — Controls */
.section{margin-bottom:20px}
.section h3{font-size:13px;font-weight:600;margin-bottom:8px}

.scenario-list{display:flex;flex-direction:column;gap:6px}
.scenario-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:left;width:100%;color:var(--text);font-size:12px;transition:border-color .15s}
.scenario-btn:hover{border-color:var(--accent)}
.scenario-btn.active{border-color:var(--accent);background:var(--accent)11}
.scenario-btn .sc-title{font-weight:600}
.scenario-btn .sc-desc{color:var(--text-dim);font-size:11px;margin-top:2px}
.play-btn{margin-left:auto;background:var(--accent);color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0}
.play-btn:hover{background:var(--accent-hover)}

.form-group{margin-bottom:10px}
.form-group label{display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:8px;background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:12px;font-family:inherit}
.form-group textarea{height:48px;resize:vertical}
.form-group select{appearance:none;cursor:pointer}

.btn{padding:8px 16px;border:none;border-radius:var(--radius);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover)}
.btn-sm{padding:4px 10px;font-size:11px}
.btn-success{background:var(--green);color:#fff}
.btn-danger{background:var(--red);color:#fff}

.posture-toggle{display:flex;gap:4px;margin-bottom:12px}
.posture-opt{flex:1;padding:6px;text-align:center;font-size:11px;font-weight:600;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:var(--code-bg);color:var(--text-dim);transition:all .15s}
.posture-opt.active{color:#fff}
.posture-opt.active.guarded{background:var(--yellow);border-color:var(--yellow);color:#000}
.posture-opt.active.open{background:var(--green);border-color:var(--green)}
.posture-opt.active.locked{background:var(--red);border-color:var(--red)}

.approval-card{background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:6px;font-size:12px}
.approval-card .agent-name{font-weight:600;color:var(--yellow)}
.approval-card .apv-actions{display:flex;gap:6px;margin-top:6px}

.summary-bar{display:flex;gap:12px;padding:12px;background:var(--code-bg);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px}
.summary-stat{text-align:center;flex:1}
.summary-stat .num{font-size:20px;font-weight:700}
.summary-stat .lbl{font-size:10px;color:var(--text-dim);text-transform:uppercase}
.summary-stat.s-approved .num{color:var(--green)}
.summary-stat.s-pending .num{color:var(--yellow)}
.summary-stat.s-denied .num{color:var(--red)}

@media(max-width:900px){
  .panels{grid-template-columns:1fr;grid-template-rows:auto 1fr auto}
}
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>Personafy Demo</h1>
    <span class="subtitle">Interactive privacy vault explorer</span>
  </div>
  <div class="panels">
    <!-- LEFT: Vault Inspector -->
    <div class="panel" id="vault-panel">
      <h2>Vault State</h2>
      <div id="posture-display"></div>
      <h2>Personas</h2>
      <div id="personas-list"></div>
      <h2>Rules</h2>
      <div id="rules-list"></div>
    </div>

    <!-- CENTER: Activity Feed -->
    <div class="panel" id="feed-panel">
      <h2>Activity Feed</h2>
      <div id="summary-bar" style="display:none"></div>
      <div id="feed" class="feed">
        <div class="feed-empty">Run a scenario or submit a request to see activity here.</div>
      </div>
    </div>

    <!-- RIGHT: Controls -->
    <div class="panel" id="controls-panel">
      <div class="section">
        <h3>Scenarios</h3>
        <div id="scenario-list" class="scenario-list"></div>
      </div>

      <div class="section">
        <h3>Interactive Request</h3>
        <div class="form-group">
          <label>Agent ID</label>
          <input type="text" id="req-agent" value="demo-agent" />
        </div>
        <div class="form-group">
          <label>Persona</label>
          <select id="req-persona">
            <option value="work">work</option>
            <option value="personal">personal</option>
            <option value="shopping">shopping</option>
          </select>
        </div>
        <div class="form-group">
          <label>Fields (comma-separated)</label>
          <input type="text" id="req-fields" value="tools, communication_style" />
        </div>
        <div class="form-group">
          <label>Purpose</label>
          <input type="text" id="req-purpose" value="demo request" />
        </div>
        <button class="btn btn-primary" onclick="submitRequest()">Send Request</button>
      </div>

      <div class="section">
        <h3>Posture</h3>
        <div class="posture-toggle" id="posture-toggle">
          <div class="posture-opt guarded" data-posture="guarded" onclick="setPosture('guarded')">Guarded</div>
          <div class="posture-opt open" data-posture="open" onclick="setPosture('open')">Open</div>
          <div class="posture-opt locked" data-posture="locked" onclick="setPosture('locked')">Locked</div>
        </div>
      </div>

      <div class="section">
        <h3>Pending Approvals</h3>
        <div id="approvals-list">
          <div style="font-size:12px;color:var(--text-dim)">No pending approvals.</div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  const SESSION_KEY = 'personafy-demo-session';
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'demo-' + Math.random().toString(36).slice(2, 14);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let scenarios = [];
  let feedSteps = [];

  async function api(body) {
    const res = await fetch('/personafy/demo/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-session': sessionId },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // ── Initialize ──
  async function init() {
    // Create vault
    await api({ action: 'create_vault', params: {} });
    // Load scenarios
    const sc = await api({ action: 'list_scenarios', params: {} });
    scenarios = sc.scenarios || [];
    renderScenarios();
    await refreshState();
  }

  // ── Refresh vault state ──
  async function refreshState() {
    const res = await api({ action: 'get_state', params: {} });
    if (!res.ok) return;
    const s = res.result;
    renderPosture(s.posture);
    renderPersonas(s.personas || []);
    renderRules(s.rules || []);
    renderApprovals(s.pendingApprovals || []);
  }

  function renderPosture(posture) {
    const el = document.getElementById('posture-display');
    el.innerHTML = '<div class="posture-badge ' + posture + '">' +
      posture.toUpperCase() + '</div>';
    // Update toggle
    document.querySelectorAll('.posture-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.posture === posture);
    });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderPersonas(personas) {
    const el = document.getElementById('personas-list');
    if (!personas.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No personas.</div>'; return; }
    el.innerHTML = personas.map(p => {
      const fields = Object.entries(p.fields).map(([k,v]) =>
        '<div class="field-row"><span class="field-key">' + esc(k) + '</span><span class="field-val" title="' + esc(v) + '">' + esc(v) + '</span></div>'
      ).join('');
      return '<div class="persona-card"><h3><span class="tag">' + esc(p.id) + '</span> ' + esc(p.label) + '</h3>' + fields + '</div>';
    }).join('');
  }

  function renderRules(rules) {
    const el = document.getElementById('rules-list');
    if (!rules.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No rules.</div>'; return; }
    el.innerHTML = rules.map(r =>
      '<div class="rule-item"><strong>' + esc(r.persona) + '</strong>: ' + r.fields.map(f => esc(f)).join(', ') +
      '<div class="rule-meta">' + (r.agentId ? 'agent=' + esc(r.agentId) : 'any agent') + ' | ' + esc(r.id) + '</div></div>'
    ).join('');
  }

  function renderApprovals(approvals) {
    const el = document.getElementById('approvals-list');
    if (!approvals.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No pending approvals.</div>'; return; }
    el.innerHTML = approvals.map(a =>
      '<div class="approval-card">' +
        '<span class="agent-name">' + esc(a.agentId) + '</span> wants <strong>' + esc(a.persona) + '</strong>.' + a.fields.map(f => esc(f)).join(', ') +
        '<div style="color:var(--text-dim);font-size:11px">' + esc(a.purpose) + '</div>' +
        '<div class="apv-actions">' +
          '<button class="btn btn-sm btn-success" onclick="resolveApproval(\\'' + esc(a.id) + '\\', \\'approved\\')">Approve</button>' +
          '<button class="btn btn-sm btn-danger" onclick="resolveApproval(\\'' + esc(a.id) + '\\', \\'denied\\')">Deny</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  // ── Scenarios ──
  function renderScenarios() {
    const el = document.getElementById('scenario-list');
    el.innerHTML = scenarios.map(s =>
      '<button class="scenario-btn" data-id="' + esc(s.id) + '" onclick="playScenario(\\'' + esc(s.id) + '\\')">' +
        '<div><div class="sc-title">' + esc(s.title) + '</div><div class="sc-desc">' + esc(s.description) + '</div></div>' +
        '<span class="play-btn">Play</span>' +
      '</button>'
    ).join('');
  }

  // ── Activity Feed ──
  function clearFeed() {
    feedSteps = [];
    document.getElementById('feed').innerHTML = '';
    document.getElementById('summary-bar').style.display = 'none';
  }

  function getDecision(step) {
    const r = step.result;
    if (r && r.decision) return r.decision;
    if (step.action === 'resolve_approval' || step.action === 'add_rule' || step.action === 'add_scheduled_rule' || step.action === 'get_state' || step.action === 'expire_rule') return null;
    return null;
  }

  function addStepToFeed(step) {
    feedSteps.push(step);
    const feed = document.getElementById('feed');
    if (feed.querySelector('.feed-empty')) feed.innerHTML = '';

    const decision = getDecision(step);
    const badgeHtml = decision
      ? '<span class="decision-badge ' + decision + '">' + decision.toUpperCase() + '</span>'
      : '';
    const detailsJson = JSON.stringify(step.result, null, 2);

    const card = document.createElement('div');
    card.className = 'step-card';
    card.innerHTML =
      '<div class="step-header"><span class="step-num">' + step.stepNumber + '</span><span class="step-label">' + esc(step.label) + '</span></div>' +
      badgeHtml +
      '<div class="step-highlight">' + esc(step.highlight) + '</div>' +
      '<button class="step-toggle" onclick="this.parentElement.classList.toggle(\\'expanded\\')">details</button>' +
      '<div class="step-details">' + esc(detailsJson) + '</div>';
    feed.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showSummary(summary) {
    const el = document.getElementById('summary-bar');
    el.style.display = 'flex';
    el.innerHTML =
      '<div class="summary-stat"><div class="num">' + summary.totalSteps + '</div><div class="lbl">Steps</div></div>' +
      '<div class="summary-stat s-approved"><div class="num">' + summary.approved + '</div><div class="lbl">Approved</div></div>' +
      '<div class="summary-stat s-pending"><div class="num">' + summary.pending + '</div><div class="lbl">Pending</div></div>' +
      '<div class="summary-stat s-denied"><div class="num">' + summary.denied + '</div><div class="lbl">Denied</div></div>';
  }

  // ── Global handlers ──
  window.playScenario = async function(id) {
    // Reset vault for clean scenario run
    await api({ action: 'create_vault', params: {} });
    clearFeed();

    const res = await api({ action: 'run_scenario', params: { scenarioId: id } });
    if (!res.ok) return;

    // Animate steps one by one
    const steps = res.steps || [];
    for (let i = 0; i < steps.length; i++) {
      await new Promise(r => setTimeout(r, 400));
      addStepToFeed(steps[i]);
    }
    if (res.summary) showSummary(res.summary);
    await refreshState();
  };

  window.submitRequest = async function() {
    const agent = document.getElementById('req-agent').value.trim();
    const persona = document.getElementById('req-persona').value;
    const fieldsRaw = document.getElementById('req-fields').value.trim();
    const purpose = document.getElementById('req-purpose').value.trim();
    const fields = fieldsRaw.split(',').map(f => f.trim()).filter(Boolean);
    if (!fields.length) return;

    const res = await api({
      action: 'execute_action',
      params: { action: 'request_context', agentId: agent, persona, fields, purpose },
    });
    if (!res.ok && res.error) { console.error(res.error); return; }
    const stepNum = feedSteps.length + 1;
    const decision = res.result && res.result.decision ? res.result.decision : 'unknown';
    addStepToFeed({
      stepNumber: stepNum,
      label: agent + ' requests ' + persona + '.' + fields.join('+'),
      action: 'request_context',
      input: { agentId: agent, persona, fields, purpose },
      result: res.result || {},
      highlight: decision === 'approved' ? 'Approved!' : decision === 'pending' ? 'Pending approval' : decision === 'denied' ? 'Denied' : '',
    });
    await refreshState();
  };

  window.setPosture = async function(posture) {
    await api({ action: 'execute_action', params: { action: 'set_posture', posture } });
    const stepNum = feedSteps.length + 1;
    addStepToFeed({
      stepNumber: stepNum,
      label: 'Posture changed to ' + posture.toUpperCase(),
      action: 'set_posture',
      input: { posture },
      result: { posture },
      highlight: posture === 'open' ? 'Auto-approve mode enabled' : posture === 'locked' ? 'All requests will be denied' : 'Manual approval mode',
    });
    await refreshState();
  };

  window.resolveApproval = async function(id, decision) {
    const res = await api({ action: 'execute_action', params: { action: 'resolve_approval', approvalId: id, decision } });
    const stepNum = feedSteps.length + 1;
    addStepToFeed({
      stepNumber: stepNum,
      label: 'Approval ' + id + ' ' + decision,
      action: 'resolve_approval',
      input: { approvalId: id, decision },
      result: res.result || {},
      highlight: decision === 'approved' ? 'Request approved by user' : 'Request denied by user',
    });
    await refreshState();
  };

  init();
})();
</script>
</body>
</html>`;
}
