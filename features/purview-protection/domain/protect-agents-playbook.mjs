/**
 * Playbook: protect agents from leaking sensitive data.
 *
 * Creates an agent-scoped DLP policy in Microsoft Purview. The Purview portal
 * cannot express agent scoping — the scoping is carried by
 * `EndpointDlpRestrictions`, which the UI does not surface — so Security &
 * Compliance PowerShell is the only way to produce this policy.
 *
 * Two artifacts come out of the same definition:
 *
 *   buildSteps   the guided sequence — eight blocks a human reads and pastes
 *   buildScript  one composed script, for an agent to run end to end
 *
 * They are written separately rather than derived from one another, because
 * unattended execution changes the requirements rather than the wrapper: the
 * script must be idempotent, must stop on a missing sensitive information type
 * that a reader would have caught, and must live in a single session because
 * `Connect-IPPSSession` does not survive across invocations. Concatenating the
 * guided steps would satisfy none of that.
 *
 * The commands are reproduced from the Purview agent-DLP guidance. They are
 * deliberately parameterized only where a tenant genuinely differs (policy
 * name, SIT name, confidence level) — every structural part, especially the
 * `EnforcementOverrides` JSON, is fixed, because that JSON is the part that
 * actually does the agent scoping and mistyping it produces a policy that
 * looks right and enforces nothing.
 *
 * @typedef {import("./types.js").Playbook} Playbook
 * @typedef {import("./types.js").PlaybookStep} PlaybookStep
 * @typedef {import("./types.js").PlaybookScript} PlaybookScript
 */

export const CONFIDENCE_LEVELS = /** @type {const} */ (["Low", "Medium", "High"]);

/** @type {Playbook} */
export const PROTECT_AGENTS_PLAYBOOK = {
	id: "protect-agents-sensitive-data",
	title: "Protect agents from sensitive data",
	summary:
		"Create an agent-scoped Purview DLP policy that blocks AI agents from reading content matching a sensitive information type.",

	rationale: {
		guided: [
			"Purview has no public API for this. Agent scoping is carried by EndpointDlpRestrictions, which the compliance portal cannot express, so Security & Compliance PowerShell is the only way to create this policy.",
			"Nothing on this screen applies the policy. It builds the exact commands and you run them in your own session — the credentials that can change your tenant stay with you.",
			"When you have run it, ask me to check coverage again and I will confirm the policy is listed.",
		],
		auto: [
			"Purview has no public API for this. Agent scoping is carried by EndpointDlpRestrictions, which the compliance portal cannot express, so Security & Compliance PowerShell is the only way to create this policy.",
			"In this mode Copilot runs the whole script in a terminal instead of walking you through it. You still sign in yourself — Connect-IPPSSession opens a browser prompt and the script waits for it, so the credentials never leave you.",
			"The script is idempotent and reports what it did at the end. Re-running it after a failure is safe: it reuses an existing policy and skips a rule that is already there.",
		],
	},

	params: [
		{
			id: "policyName",
			label: "Policy name",
			help: "The DLP policy created in Purview. Reused as its internal name so the two cannot drift apart.",
			default: "AIAgentPolicy",
		},
		{
			id: "sitName",
			label: "Sensitive information type",
			help:
				"The SIT the rule matches on. Any SIT works, built-in or custom — the agent scoping comes from " +
				"EndpointDlpRestrictions, not from the SIT. A permissive test SIT makes it easy to prove the block works before you enforce on a real one.",
			default: "ProjectArgus",
		},
		{
			id: "confidenceLevel",
			label: "Confidence level",
			help:
				"How certain the SIT match must be. Low catches the most and is the right choice while proving the policy works; " +
				"raise it once you are enforcing on real data, or expect false positives.",
			default: "Low",
			options: [...CONFIDENCE_LEVELS],
		},
	],

	/**
	 * @param {Record<string, string>} p
	 * @returns {PlaybookStep[]}
	 */
	buildSteps(p) {
		const policy = p.policyName ?? "AIAgentPolicy";
		const sit = p.sitName ?? "ProjectArgus";
		const confidence = p.confidenceLevel ?? "Low";

		return [
			{
				id: "install-module",
				kind: "prerequisite",
				title: "Install the Exchange Online module",
				body: [
					"Security & Compliance PowerShell ships in the ExchangeOnlineManagement module. Skip this if you already have it.",
				],
				script: {
					language: "powershell",
					code: "Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser",
					destructive: false,
					effect: "Installs a PowerShell module for your user account. Changes nothing in your tenant.",
				},
				docsUrl: "https://learn.microsoft.com/powershell/exchange/connect-to-scc-powershell",
				docsLabel: "Connect to Security & Compliance PowerShell",
			},
			{
				id: "connect",
				kind: "prerequisite",
				title: "Connect to Security & Compliance PowerShell",
				body: [
					"Sign in with an account that can manage DLP policies — Compliance Administrator, Compliance Data Administrator, or Global Administrator.",
					"This opens an interactive sign-in. The rest of the playbook runs in the session it creates, so keep the window open.",
				],
				script: {
					language: "powershell",
					code: "Connect-IPPSSession",
					destructive: false,
					effect: "Opens a sign-in prompt and starts an authenticated session. Changes nothing yet.",
				},
			},
			{
				id: "check-sit",
				kind: "verify",
				title: `Confirm the "${sit}" sensitive information type exists`,
				body: [
					"The rule matches on this SIT, so it has to exist before the rule is created. If this returns nothing, create the SIT in the Purview portal first, or point the playbook at one you already have.",
				],
				script: {
					language: "powershell",
					code: `Get-DlpSensitiveInformationType | Where-Object { $_.Name -eq '${sit}' } | Format-List Name, Publisher, RulePackId`,
					destructive: false,
					effect: "Reads the list of sensitive information types. Changes nothing.",
				},
			},
			{
				id: "create-policy",
				kind: "script",
				title: "Create the DLP policy",
				body: [
					"Creates the policy scoped to all endpoint devices. It is created enabled, but it carries no rules yet, so on its own it blocks nothing.",
					"The extended-locations JSON is what targets devices rather than mailboxes or sites. Leave it as written.",
				],
				script: {
					language: "powershell",
					code: [
						`New-DlpCompliancePolicy \``,
						`  -DisplayName "${policy}" \``,
						`  -Name "${policy}" \``,
						`  -Mode Enable \``,
						`  -EndpointDlpLocation "All" \``,
						`  -EndpointDlpExtendedLocations '[{"GroupSet":"Device","Inclusions":[{"Type":"IndividualResource","Identity":"All"}]}]'`,
					].join("\n"),
					destructive: true,
					effect: `Creates a DLP policy named "${policy}" in your tenant, enabled, targeting all endpoint devices.`,
				},
			},
			{
				id: "rule-agent-and-tool",
				kind: "script",
				title: "Block agents and their tools",
				body: [
					"The first rule. It blocks agent access to matching content in both directions, and covers the tools an agent calls as well as the agent itself.",
					"EnforcementOverrides is the part that does the agent scoping — it is what the portal cannot express. Both inclusion lists are \"all\", so this applies to every agent and every tool.",
				],
				script: {
					language: "powershell",
					code: [
						`$overridesToolJson = '[{"Condition":{"AgentScoping":[{"Agent":{"Inclusions":["all"],"Exclusions":[]}, "Tools":{"Inclusions":["all"],"Exclusions":[]}}],"Direction":"Both"},"EnforcementMode":"Block"}]'`,
						``,
						`New-DlpComplianceRule \``,
						`  -Policy "${policy}" \``,
						`  -Name "${sit}AgentAndToolBlock" \``,
						`  -ContentContainsSensitiveInformation @{ Name="${sit}"; mincount="1"; maxcount="-1"; confidenceLevel="${confidence}" } \``,
						`  -EndpointDlpRestrictions @(@{ Setting="AccessByAIAgent"; Value="Block"; EnforcementOverrides=$overridesToolJson })`,
					].join("\n"),
					destructive: true,
					effect: `Adds a rule to "${policy}" that blocks all agents and their tools from content matching "${sit}".`,
				},
			},
			{
				id: "rule-agent",
				kind: "script",
				title: "Block agents directly",
				body: [
					"The second rule. Same block, scoped to the agent alone rather than to the agent and its tools.",
					"Both rules are needed: the tool-scoped override does not cover an agent reading content directly, so a policy with only the first rule leaves that path open.",
				],
				script: {
					language: "powershell",
					code: [
						`$overridesPromptJson = '[{"Condition":{"AgentScoping":[{"Agent":{"Inclusions":["all"],"Exclusions":[]}}],"Direction":"Both"},"EnforcementMode":"Block"}]'`,
						``,
						`New-DlpComplianceRule \``,
						`  -Policy "${policy}" \``,
						`  -Name "${sit}AgentBlock" \``,
						`  -ContentContainsSensitiveInformation @{ Name="${sit}"; mincount="1"; maxcount="-1"; confidenceLevel="${confidence}" } \``,
						`  -EndpointDlpRestrictions @(@{ Setting="AccessByAIAgent"; Value="Block"; EnforcementOverrides=$overridesPromptJson })`,
					].join("\n"),
					destructive: true,
					effect: `Adds a second rule to "${policy}" that blocks all agents from content matching "${sit}".`,
				},
			},
			{
				id: "verify",
				kind: "verify",
				title: "Confirm the policy and both rules exist",
				body: [
					"Read back what you just created. You should see the policy enabled, and two rules listed.",
					"Policy changes take time to reach endpoints — allow up to an hour before testing that a block actually fires.",
				],
				script: {
					language: "powershell",
					code: [
						`Get-DlpCompliancePolicy -Identity "${policy}" | Format-List Name, Mode, EndpointDlpLocation`,
						`Get-DlpComplianceRule -Policy "${policy}" | Format-Table Name, Disabled`,
					].join("\n"),
					destructive: false,
					effect: "Reads the policy and its rules. Changes nothing.",
				},
			},
			{
				id: "recheck",
				kind: "note",
				title: "Ask me to re-check coverage",
				body: [
					"Nothing on this screen watches your terminal, so the steps above record only what you told me you did.",
					"Once the policy exists, ask me to check agent coverage again and I will read it back from the inventory — that is the evidence the protection is really in place.",
				],
			},
		];
	},

	/**
	 * The whole playbook as one script, for auto mode.
	 *
	 * Three properties matter here that do not matter in guided mode, because
	 * nobody is reading between the commands:
	 *
	 * **One session.** `Connect-IPPSSession` authenticates the *process*.
	 * Splitting this across invocations would sign in and then throw the
	 * session away, so the whole thing is one script or it is nothing.
	 *
	 * **Idempotent.** An unattended script gets re-run — after a timeout, a
	 * failed sign-in, a half-finished attempt. `New-DlpCompliancePolicy` on an
	 * existing name is a hard error, so existence is checked first and the
	 * second run reports "already existed" rather than failing at step 4 with
	 * a policy half-built.
	 *
	 * **Stops on a missing SIT.** This is the one condition a human reading
	 * step 3 would have caught. Without the SIT the rules still create — and
	 * enforce nothing at all, which is the worst outcome available: a tenant
	 * that looks protected. So it throws before creating anything.
	 *
	 * `$ErrorActionPreference = "Stop"` makes the rest fail loudly instead of
	 * continuing past a broken step, which unattended is the difference between
	 * a clear error and a policy with one of its two rules.
	 *
	 * @param {Record<string, string>} p
	 * @returns {PlaybookScript}
	 */
	buildScript(p) {
		const policy = p.policyName ?? "AIAgentPolicy";
		const sit = p.sitName ?? "ProjectArgus";
		const confidence = p.confidenceLevel ?? "Low";

		const code = [
			`$ErrorActionPreference = "Stop"`,
			``,
			`# 1. Module`,
			`if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {`,
			`  Write-Host "Installing ExchangeOnlineManagement..."`,
			`  Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber`,
			`}`,
			`Import-Module ExchangeOnlineManagement`,
			``,
			`# 2. Sign in. Opens a browser prompt; the script waits for it.`,
			`Write-Host "Connecting to Security & Compliance PowerShell..."`,
			`Connect-IPPSSession -ShowBanner:$false`,
			``,
			`# 3. The rules match on this SIT. Without it they would create and`,
			`#    enforce nothing, so stop here rather than build a policy that`,
			`#    only looks like protection.`,
			`$sit = Get-DlpSensitiveInformationType | Where-Object { $_.Name -eq '${sit}' }`,
			`if (-not $sit) {`,
			`  throw "Sensitive information type '${sit}' does not exist in this tenant. Create it in the Purview portal, or re-run with a SIT that exists. Nothing was changed."`,
			`}`,
			`Write-Host "Found sensitive information type '${sit}'."`,
			``,
			`# 4. Policy. Re-running is safe: an existing policy is reused, since`,
			`#    New-DlpCompliancePolicy on a taken name is a hard error.`,
			`#    try/catch rather than -ErrorAction: ErrorActionPreference is Stop`,
			`#    and the REST-backed cmdlets can throw a terminating error for a`,
			`#    missing identity, which -ErrorAction would not suppress. That is`,
			`#    the fresh-tenant path, so getting it wrong breaks the common case.`,
			`$policy = $null`,
			`try { $policy = Get-DlpCompliancePolicy -Identity "${policy}" -ErrorAction Stop } catch { }`,
			`if ($policy) {`,
			`  Write-Host "Policy '${policy}' already exists; reusing it."`,
			`} else {`,
			`  New-DlpCompliancePolicy \``,
			`    -DisplayName "${policy}" \``,
			`    -Name "${policy}" \``,
			`    -Mode Enable \``,
			`    -EndpointDlpLocation "All" \``,
			`    -EndpointDlpExtendedLocations '[{"GroupSet":"Device","Inclusions":[{"Type":"IndividualResource","Identity":"All"}]}]' | Out-Null`,
			`  Write-Host "Created policy '${policy}'."`,
			`}`,
			``,
			`# 5 & 6. Both rules. The tool-scoped override does not cover an agent`,
			`#        reading content directly, so one alone leaves that path open.`,
			`$overridesToolJson = '[{"Condition":{"AgentScoping":[{"Agent":{"Inclusions":["all"],"Exclusions":[]}, "Tools":{"Inclusions":["all"],"Exclusions":[]}}],"Direction":"Both"},"EnforcementMode":"Block"}]'`,
			`$overridesPromptJson = '[{"Condition":{"AgentScoping":[{"Agent":{"Inclusions":["all"],"Exclusions":[]}}],"Direction":"Both"},"EnforcementMode":"Block"}]'`,
			``,
			`$existingRules = @()`,
			`try { $existingRules = @(Get-DlpComplianceRule -Policy "${policy}" -ErrorAction Stop | Select-Object -ExpandProperty Name) } catch { }`,
			``,
			`foreach ($rule in @(`,
			`  @{ Name = "${sit}AgentAndToolBlock"; Overrides = $overridesToolJson },`,
			`  @{ Name = "${sit}AgentBlock";        Overrides = $overridesPromptJson }`,
			`)) {`,
			`  if ($existingRules -contains $rule.Name) {`,
			`    Write-Host "Rule '$($rule.Name)' already exists; skipping."`,
			`    continue`,
			`  }`,
			`  New-DlpComplianceRule \``,
			`    -Policy "${policy}" \``,
			`    -Name $rule.Name \``,
			`    -ContentContainsSensitiveInformation @{ Name="${sit}"; mincount="1"; maxcount="-1"; confidenceLevel="${confidence}" } \``,
			`    -EndpointDlpRestrictions @(@{ Setting="AccessByAIAgent"; Value="Block"; EnforcementOverrides=$rule.Overrides }) | Out-Null`,
			`  Write-Host "Created rule '$($rule.Name)'."`,
			`}`,
			``,
			`# 7. Read back what is actually there — the only evidence that counts.`,
			`Write-Host ""`,
			`Write-Host "--- Result ---"`,
			`Get-DlpCompliancePolicy -Identity "${policy}" | Format-List Name, Mode, EndpointDlpLocation`,
			`Get-DlpComplianceRule -Policy "${policy}" | Format-Table Name, Disabled`,
			`Write-Host "Policy changes take up to an hour to reach endpoints."`,
			``,
			`Disconnect-ExchangeOnline -Confirm:$false | Out-Null`,
		].join("\n");

		return {
			language: "powershell",
			code,
			destructive: true,
			effect: `Creates the DLP policy "${policy}" and two agent-scoped rules blocking all agents from content matching "${sit}". Reuses anything that already exists.`,
		};
	},
};

/** Every playbook, by id. Adding one is a registration, not a new screen. */
export const PLAYBOOKS = {
	[PROTECT_AGENTS_PLAYBOOK.id]: PROTECT_AGENTS_PLAYBOOK,
};

export const DEFAULT_PLAYBOOK_ID = PROTECT_AGENTS_PLAYBOOK.id;

/**
 * Resolve a playbook by id, falling back rather than throwing.
 * @param {string} id
 * @returns {Playbook}
 */
export function resolvePlaybook(id) {
	return PLAYBOOKS[id] ?? PROTECT_AGENTS_PLAYBOOK;
}
