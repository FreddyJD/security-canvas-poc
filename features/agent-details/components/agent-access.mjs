/**
 * The "Agent's access" card: what this agent can reach, listed by name.
 *
 * Two labelled groups — Permissions (delegated grant names) and Resources (the
 * connected resource display names) — each showing its count beside the
 * heading. A long list is capped with a "+N more" line. A flagged resource
 * carries its severity tag. When no detail document could be read there is
 * nothing real to list, so the card shows an honest empty state rather than an
 * empty list, which would read as "this agent reaches nothing".
 *
 * Stateless. The view model carries only real names and severities; every label
 * is resolved here.
 *
 * @typedef {import("../domain/types.js").Access} Access
 */
import { esc, plural } from "./primitives.mjs";

/** How many names each group draws before collapsing the rest. */
const VISIBLE_LIMIT = 12;

/** The severity word for the 0..3 scale the map and this card share. */
const SEVERITY_LABEL = { 1: "Low", 2: "Medium", 3: "High" };

/**
 * @param {Access} access
 * @returns {string}
 */
export function agentAccess(access) {
	if (!access.hasProfile) {
		return `<p class="card-subtitle">Roles, permissions, and resources this agent uses.</p>
    <div class="access-empty">
      <p class="access-empty-title">No access data yet</p>
      <p class="access-empty-body">The agent's dependency graph is not available, so its permissions and resources cannot be listed.</p>
    </div>`;
	}

	const permissions = access.permissions.slice(0, VISIBLE_LIMIT);
	const resources = access.resources.slice(0, VISIBLE_LIMIT);

	return `<p class="card-subtitle">Roles, permissions, and resources this agent uses.</p>
  <div class="access-groups">
    <section class="access-group">
      <div class="access-head">
        <span class="access-title">Permissions</span>
        <span class="access-count">${access.permissions.length}</span>
      </div>
      ${
				access.permissions.length === 0
					? `<p class="access-none">No delegated permissions found.</p>`
					: `<div class="chips">
              ${permissions.map((scope) => `<span class="chip">${esc(scope)}</span>`).join("")}
              ${access.permissions.length > VISIBLE_LIMIT ? `<span class="access-more">+${access.permissions.length - VISIBLE_LIMIT} more</span>` : ""}
            </div>`
			}
    </section>

    <section class="access-group">
      <div class="access-head">
        <span class="access-title">Resources</span>
        <span class="access-count">${access.resourceTotal}</span>
      </div>
      ${
				access.resources.length === 0
					? `<p class="access-none">No connected resources found.</p>`
					: `<div class="resource-list">
              ${resources
								.map(
									(resource) => `<div class="resource-row">
                    <span class="resource-name" title="${esc(resource.name)}">${esc(resource.name)}</span>
                    ${resource.severity ? `<span class="chip chip-sev">${esc(SEVERITY_LABEL[resource.severity])}</span>` : ""}
                  </div>`,
								)
								.join("")}
              ${
								access.resources.length > VISIBLE_LIMIT
									? `<span class="access-more">+${plural(access.resources.length - VISIBLE_LIMIT, "more resource")}</span>`
									: ""
							}
            </div>`
			}
    </section>
  </div>`;
}
