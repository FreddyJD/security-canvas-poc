import http from "node:http";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { assessAgent } from "./vendor/correlate.mjs";
import { describeDetection } from "./vendor/risk-catalog.mjs";
import { loadTenantData, SAMPLE_EXPOSURE, beginDeviceCode, getConfig } from "./graph.mjs";

/**
 * Security Canvas — a triage queue for risky Entra agent identities.
 *
 * A list of agents does not need a canvas. This one earns the surface because
 * triage is a queue you work through: you need to see relative severity at a
 * glance, drill into evidence, and hand an agent to the model without
 * re-typing an opaque GUID.
 *
 * Scoring is the same engine the MCP server uses (vendor/ is generated from
 * src/), so the canvas and the tools can never disagree about severity.
 *
 * NOTE: stdout is the JSON-RPC channel. Never console.log here.
 */

const state = {
	live: false,
	note: "Loading…",
	needsAuth: false,
	// Device-code prompt shown in the UI while sign-in is pending.
	auth: null, // { userCode, verificationUri } | { error }
	assessments: [],
	selectedId: null,
	lastRefresh: null,
};

const clients = new Set();
function broadcast() {
	const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
	for (const res of clients) {
		try {
			res.write(frame);
		} catch {
			clients.delete(res);
		}
	}
}

/** Pull tenant data and re-score every agent through the shared engine. */
async function refresh() {
	const { agents, detections, live, note, needsAuth } = await loadTenantData({ limit: 25 });

	state.live = live;
	state.note = note;
	state.needsAuth = Boolean(needsAuth);
	if (live) state.auth = null;
	state.lastRefresh = new Date().toISOString();
	state.assessments = agents
		.map((agent) => {
			// Blast-radius context is illustrative and applies to sample data
			// only. Attaching it to a real tenant would fabricate evidence.
			const exposure = live ? {} : (SAMPLE_EXPOSURE[agent.id] ?? {});
			const degraded = {};
			if (!exposure.dataExposure) degraded.purview = "No Purview exposure data; data risk not evaluated.";
			if (!exposure.codeExposure) degraded.github = "No GitHub exposure data; code risk not evaluated.";
			degraded.defender = "Defender not wired; use the Sentinel MCP server for incidents.";

			const assessment = assessAgent({
				agent,
				detections: detections[agent.id] ?? [],
				...exposure,
				degraded,
			});

			// Attach enriched detections so the detail pane can explain each one.
			assessment.detectionDetail = (detections[agent.id] ?? []).map((d) => {
				const meta = describeDetection(d.riskEventType);
				return {
					id: d.id,
					riskEventType: d.riskEventType,
					title: meta.title,
					meaning: meta.meaning,
					impact: meta.impact,
					action: meta.action,
					riskLevel: d.riskLevel,
					detectedDateTime: d.detectedDateTime,
					riskEvidence: d.riskEvidence,
				};
			});
			return assessment;
		})
		.sort((a, b) => {
			if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
			const confirmed = (x) => (x.riskState === "confirmedCompromised" ? 1 : 0);
			if (confirmed(b) !== confirmed(a)) return confirmed(b) - confirmed(a);
			return String(a.agentId).localeCompare(String(b.agentId));
		});

	if (!state.assessments.some((a) => a.agentId === state.selectedId)) {
		state.selectedId = state.assessments[0]?.agentId ?? null;
	}
	broadcast();
}

// ---------------------------------------------------------------------------
// HTTP server — the canvas surface
// ---------------------------------------------------------------------------
let session;

const server = http.createServer(async (req, res) => {
	const json = (body, code = 200) => {
		res.writeHead(code, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};

	if (req.method === "GET" && req.url === "/") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(html());
	}

	if (req.method === "GET" && req.url === "/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
		clients.add(res);
		req.on("close", () => clients.delete(res));
		return;
	}

	if (req.method === "POST" && req.url === "/select") {
		const { agentId } = await readJson(req);
		state.selectedId = agentId;
		broadcast();
		return json({ ok: true });
	}

	if (req.method === "POST" && req.url === "/refresh") {
		await refresh();
		return json({ ok: true });
	}

	// Start device-code sign-in. Returns immediately with the code so the UI can
	// render it; the token arrives asynchronously and triggers a refresh.
	if (req.method === "POST" && req.url === "/connect") {
		if (!getConfig().clientId) {
			state.auth = { error: "SECURITY_CANVAS_CLIENT_ID is not set. See README: Real tenant data." };
			broadcast();
			return json({ ok: false });
		}
		beginDeviceCode((p) => {
			state.auth = { userCode: p.userCode, verificationUri: p.verificationUri };
			state.note = "Sign-in pending — enter the code below.";
			broadcast();
		})
			.then(async () => {
				state.auth = null;
				await refresh();
			})
			.catch((e) => {
				state.auth = { error: String(e.message || e) };
				broadcast();
			});
		return json({ ok: true });
	}

	// Hand the selected agent to the model — the bidirectional half of a canvas.
	if (req.method === "POST" && req.url === "/investigate") {
		const { agentId } = await readJson(req);
		const a = state.assessments.find((x) => x.agentId === agentId);
		if (a) {
			session?.send({
				prompt:
					`Investigate the risky agent "${a.displayName}" (id: ${a.agentId}) shown on the Security Canvas. ` +
					`It scores ${a.compositeScore}/100 (${a.severity}), Entra risk ${a.entraRiskLevel}, state ${a.riskState}. ` +
					`Contributing factors: ${a.factors.map((f) => f.summary).join("; ") || "none recorded"}. ` +
					`Assess whether this is a true positive, what the blast radius is, and recommend next steps. ` +
					`Do not change the agent's risk state without asking me first.`,
			});
		}
		return json({ ok: true });
	}

	res.writeHead(404);
	res.end("Not found");
});

const port = await new Promise((resolve) =>
	server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
);

function readJson(req) {
	return new Promise((resolve) => {
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(raw || "{}"));
			} catch {
				resolve({});
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Canvas declaration
// ---------------------------------------------------------------------------
const canvas = createCanvas({
	id: "security-canvas",
	displayName: "Security Canvas",
	description:
		"Triage risky Microsoft Entra agent identities, correlated with Purview data exposure and GitHub code access.",

	actions: [
		{
			name: "get_triage_queue",
			description:
				"Read the current triage queue: every risky agent with its composite score, severity, and contributing factors.",
			inputSchema: { type: "object", properties: {} },
			handler: () => ({
				live: state.live,
				note: state.note,
				count: state.assessments.length,
				agents: state.assessments.map((a) => ({
					agentId: a.agentId,
					displayName: a.displayName,
					severity: a.severity,
					compositeScore: a.compositeScore,
					entraRiskLevel: a.entraRiskLevel,
					riskState: a.riskState,
					factors: a.factors.map((f) => f.summary),
				})),
			}),
		},
		{
			name: "select_agent",
			description: "Focus a specific agent in the canvas detail pane so the user can see what you are discussing.",
			inputSchema: {
				type: "object",
				properties: { agentId: { type: "string", description: "Agent id from get_triage_queue." } },
				required: ["agentId"],
			},
			handler: ({ input }) => {
				const found = state.assessments.find((a) => a.agentId === input.agentId);
				if (!found) throw new Error(`No agent ${input.agentId} in the queue.`);
				state.selectedId = input.agentId;
				broadcast();
				return { selected: input.agentId, displayName: found.displayName };
			},
		},
		{
			name: "explain_selected_agent",
			description:
				"Full detail for the currently selected agent: every detection with its meaning, impact, and recommended remediation.",
			inputSchema: { type: "object", properties: {} },
			handler: () => {
				const a = state.assessments.find((x) => x.agentId === state.selectedId);
				if (!a) throw new Error("No agent is currently selected.");
				return a;
			},
		},
		{
			name: "connect_tenant",
			description:
				"Start device-code sign-in to Microsoft Graph so the canvas can load real tenant data. " +
				"Returns a code the user must enter at the given URL.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				if (!getConfig().clientId) {
					throw new Error(
						"SECURITY_CANVAS_CLIENT_ID is not set. Set it to an app registration that declares IdentityRiskyAgent.Read.All.",
					);
				}
				return await new Promise((resolve, reject) => {
					let resolved = false;
					beginDeviceCode((p) => {
						state.auth = { userCode: p.userCode, verificationUri: p.verificationUri };
						broadcast();
						resolved = true;
						resolve({
							userCode: p.userCode,
							verificationUri: p.verificationUri,
							instructions: `Ask the user to open ${p.verificationUri} and enter code ${p.userCode}.`,
						});
					})
						.then(async () => {
							state.auth = null;
							await refresh();
						})
						.catch((e) => {
							state.auth = { error: String(e.message || e) };
							broadcast();
							if (!resolved) reject(e);
						});
				});
			},
		},
		{
			name: "refresh_queue",
			description: "Re-query Microsoft Graph and rebuild the triage queue.",
			inputSchema: { type: "object", properties: {} },
			handler: async () => {
				await refresh();
				return { refreshed: true, live: state.live, count: state.assessments.length, note: state.note };
			},
		},
	],

	open: async (ctx) => {
		if (state.assessments.length === 0) {
			// Never block the panel on a slow Graph call.
			refresh().catch(() => {});
		}
		return {
			url: `http://127.0.0.1:${port}`,
			title: "Security Canvas",
			status: state.live ? "live tenant" : "sample data",
		};
	},

	onClose: async () => {
		for (const res of clients) {
			try {
				res.end();
			} catch {
				/* already gone */
			}
		}
		clients.clear();
	},
});

session = await joinSession({ canvases: [canvas] });
refresh().catch(() => {});

function html() {
	return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Security Canvas</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0d1117;--panel:#161b22;--border:#30363d;--raised:#21262d;
    --fg:#e6edf3;--muted:#8b949e;--dim:#6e7681;
    --critical:#f85149;--high:#db6d28;--medium:#d29922;--low:#3fb950;--info:#58a6ff;
  }
  body{font:13px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
       background:var(--bg);color:var(--fg);height:100vh;overflow:hidden}
  .wrap{display:flex;flex-direction:column;height:100vh}

  header{padding:12px 16px;border-bottom:1px solid var(--border);
         display:flex;align-items:center;gap:10px;flex-shrink:0}
  h1{font-size:14px;font-weight:600;letter-spacing:-.01em}
  .badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
         padding:2px 7px;border-radius:99px;border:1px solid}
  .badge.live{color:var(--low);border-color:var(--low)}
  .badge.sample{color:var(--medium);border-color:var(--medium)}
  .spacer{flex:1}
  button{background:var(--raised);border:1px solid var(--border);border-radius:6px;
         padding:5px 11px;color:var(--fg);font:inherit;font-size:12px;cursor:pointer;
         transition:background .12s ease,border-color .12s ease}
  button:hover{background:#30363d;border-color:#484f58}
  button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:500}
  button.primary:hover{background:#388bfd;border-color:#388bfd}

  .note{padding:7px 16px;font-size:11.5px;color:var(--muted);
        background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0}

  .cols{display:grid;grid-template-columns:minmax(280px,38%) 1fr;flex:1;min-height:0}
  .queue{border-right:1px solid var(--border);overflow-y:auto}
  .detail{overflow-y:auto;padding:16px}

  .row{padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;
       border-left:3px solid transparent;transition:background .1s ease}
  .row:hover{background:var(--panel)}
  .row.sel{background:var(--panel);border-left-color:var(--info)}
  .row-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
  .sev{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
       padding:1px 6px;border-radius:3px;color:#0d1117;flex-shrink:0}
  .sev.critical{background:var(--critical)}.sev.high{background:var(--high)}
  .sev.medium{background:var(--medium)}.sev.low{background:var(--low)}
  .sev.info{background:var(--info)}
  .nm{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;flex:1;min-width:0}
  .score{font-variant-numeric:tabular-nums;font-size:11px;color:var(--muted);flex-shrink:0}
  .meta{font-size:11px;color:var(--dim)}
  .bar{height:3px;background:var(--raised);border-radius:2px;margin-top:7px;overflow:hidden}
  .bar>i{display:block;height:100%;border-radius:2px;transition:width .3s ease}

  h2{font-size:15px;font-weight:600;margin-bottom:3px}
  .sub{font-size:11.5px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,monospace;
       margin-bottom:14px;word-break:break-all}
  .kv{display:flex;gap:16px;flex-wrap:wrap;padding:10px 12px;background:var(--panel);
      border:1px solid var(--border);border-radius:7px;margin-bottom:16px}
  .kv div{font-size:11px}
  .kv b{display:block;color:var(--dim);font-weight:500;text-transform:uppercase;
        letter-spacing:.05em;font-size:9.5px;margin-bottom:2px}
  h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
     margin:16px 0 8px;font-weight:600}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:7px;
        padding:11px 13px;margin-bottom:8px}
  .card .t{font-weight:600;font-size:12.5px;margin-bottom:4px;display:flex;
           align-items:center;gap:7px;flex-wrap:wrap}
  .card .m{color:var(--muted);font-size:11.5px;margin-bottom:5px}
  .card .ev{font-family:ui-monospace,SFMono-Regular,monospace;font-size:10.5px;
            color:var(--dim);background:var(--bg);padding:6px 8px;border-radius:4px;
            margin-top:6px;word-break:break-word}
  .pill{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
        padding:1px 6px;border-radius:3px;background:var(--raised);color:var(--muted)}
  ul{list-style:none}
  li{padding:6px 0 6px 16px;position:relative;font-size:12px;border-bottom:1px solid var(--border)}
  li:last-child{border-bottom:0}
  li:before{content:"→";position:absolute;left:0;color:var(--info)}
  .gap{font-size:11px;color:var(--dim);padding:3px 0}
  .empty{padding:40px 20px;text-align:center;color:var(--dim);font-size:12px}
  .authbox{padding:12px 16px;background:#1c2128;border-bottom:1px solid var(--border);
           font-size:12px;flex-shrink:0}
  .authbox .code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:20px;
                 font-weight:600;letter-spacing:.12em;color:var(--info);
                 background:var(--bg);padding:7px 12px;border-radius:6px;
                 display:inline-block;margin:6px 0;user-select:all}
  .authbox a{color:var(--info)}
  .authbox.err{color:var(--critical)}
  .actions{display:flex;gap:8px;margin:16px 0 4px}
</style></head>
<body>
<div class="wrap">
  <header>
    <h1>Security Canvas</h1>
    <span id="mode" class="badge sample">sample</span>
    <span class="spacer"></span>
    <button id="connect" class="primary" style="display:none">Connect</button>
    <button id="refresh">Refresh</button>
  </header>
  <div class="note" id="note">Loading…</div>
  <div id="authbox" class="authbox" style="display:none"></div>
  <div class="cols">
    <div class="queue" id="queue"></div>
    <div class="detail" id="detail"></div>
  </div>
</div>
<script>
  const SEV_COLOR = {critical:'#f85149',high:'#db6d28',medium:'#d29922',low:'#3fb950',info:'#58a6ff'};
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const post = (u,b) => fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});

  let current = null;

  new EventSource('/events').addEventListener('state', e => render(JSON.parse(e.data)));

  function render(s) {
    current = s;
    const mode = document.getElementById('mode');
    mode.textContent = s.live ? 'live tenant' : 'sample data';
    mode.className = 'badge ' + (s.live ? 'live' : 'sample');
    document.getElementById('note').textContent = s.note || '';

    document.getElementById('connect').style.display = (!s.live && !s.auth) ? '' : 'none';

    const ab = document.getElementById('authbox');
    if (s.auth && s.auth.error) {
      ab.style.display = ''; ab.className = 'authbox err';
      ab.textContent = 'Sign-in failed: ' + s.auth.error;
    } else if (s.auth && s.auth.userCode) {
      ab.style.display = ''; ab.className = 'authbox';
      ab.innerHTML = 'Open <a href="' + esc(s.auth.verificationUri) + '" target="_blank">' +
        esc(s.auth.verificationUri) + '</a> and enter:<br/>' +
        '<span class="code">' + esc(s.auth.userCode) + '</span><br/>' +
        '<span style="color:var(--muted)">Waiting for sign-in\u2026 the queue refreshes automatically.</span>';
    } else {
      ab.style.display = 'none';
    }

    const q = document.getElementById('queue');
    if (!s.assessments.length) {
      q.innerHTML = '<div class="empty">No agents in the queue.</div>';
      document.getElementById('detail').innerHTML = '';
      return;
    }

    q.innerHTML = s.assessments.map(a => \`
      <div class="row \${a.agentId === s.selectedId ? 'sel' : ''}" data-id="\${esc(a.agentId)}">
        <div class="row-top">
          <span class="sev \${a.severity}">\${a.severity}</span>
          <span class="nm">\${esc(a.displayName)}</span>
          <span class="score">\${a.compositeScore}</span>
        </div>
        <div class="meta">Entra \${esc(a.entraRiskLevel)} · \${a.factors.length} factor\${a.factors.length===1?'':'s'}\${a.isProcessing ? ' · recomputing' : ''}</div>
        <div class="bar"><i style="width:\${a.compositeScore}%;background:\${SEV_COLOR[a.severity]}"></i></div>
      </div>\`).join('');

    q.querySelectorAll('.row').forEach(r =>
      r.onclick = () => post('/select', { agentId: r.dataset.id }));

    renderDetail(s.assessments.find(a => a.agentId === s.selectedId));
  }

  function renderDetail(a) {
    const d = document.getElementById('detail');
    if (!a) { d.innerHTML = '<div class="empty">Select an agent.</div>'; return; }

    const factors = a.factors.length
      ? a.factors.map(f => \`<div class="card"><div class="t"><span class="pill">\${esc(f.pillar)}</span>\${esc(f.summary)}</div>\${
          f.evidence?.riskEvidence ? \`<div class="ev">\${esc(f.evidence.riskEvidence)}</div>\` : ''}</div>\`).join('')
      : '<div class="gap">No contributing factors.</div>';

    const dets = (a.detectionDetail || []).map(x => \`
      <div class="card">
        <div class="t">\${esc(x.title)}<span class="pill">\${esc(x.riskLevel || 'n/a')}</span></div>
        <div class="m">\${esc(x.meaning)}</div>
        <div class="m"><strong>Impact:</strong> \${esc(x.impact)}</div>
        \${x.riskEvidence ? \`<div class="ev">\${esc(x.riskEvidence)}</div>\` : ''}
      </div>\`).join('');

    const gaps = a.degraded && Object.keys(a.degraded).length
      ? '<h3>Coverage gaps</h3>' + Object.entries(a.degraded)
          .map(([k,v]) => \`<div class="gap"><strong>\${esc(k)}</strong> — \${esc(v)}</div>\`).join('')
      : '';

    d.innerHTML = \`
      <h2>\${esc(a.displayName)}</h2>
      <div class="sub">\${esc(a.agentId)}</div>
      <div class="kv">
        <div><b>Composite</b>\${a.compositeScore}/100</div>
        <div><b>Severity</b><span style="color:\${SEV_COLOR[a.severity]}">\${esc(a.severity)}</span></div>
        <div><b>Entra risk</b>\${esc(a.entraRiskLevel)}</div>
        <div><b>State</b>\${esc(a.riskState)}</div>
        <div><b>Type</b>\${esc(a.identityType)}</div>
      </div>
      <div class="actions">
        <button class="primary" id="inv">Ask agent to investigate</button>
      </div>
      <h3>Why this scored \${a.compositeScore}</h3>\${factors}
      \${dets ? '<h3>Detections</h3>' + dets : ''}
      <h3>Recommended actions</h3>
      <ul>\${a.recommendedActions.map(r => \`<li>\${esc(r)}</li>\`).join('')}</ul>
      \${gaps}\`;

    document.getElementById('inv').onclick = () => post('/investigate', { agentId: a.agentId });
  }

  document.getElementById('refresh').onclick = () => post('/refresh');
  document.getElementById('connect').onclick = () => post('/connect');
</script>
</body></html>`;
}
