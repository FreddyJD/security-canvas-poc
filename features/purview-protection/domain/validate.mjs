/**
 * Validation for values that are interpolated into a script a human then runs
 * with tenant-administrative rights.
 *
 * This is the most safety-critical file in the feature, and the reason it is
 * separate from the playbook that uses it.
 *
 * The threat is not theoretical. A parameter here can arrive from a model
 * calling an MCP tool, or from a text field, and it is pasted into PowerShell
 * that an admin runs in a Security & Compliance session. A sensitive
 * information type named:
 *
 *     x"; Remove-DlpCompliancePolicy -Identity "AIAgentPolicy" -Confirm:$false; "
 *
 * would break out of the quoted argument and run as the operator. Escaping is
 * not enough — PowerShell has too many quoting contexts to escape reliably
 * across all of them. So these values are *allowlisted*, not escaped: anything
 * outside a deliberately boring character set is rejected outright and the
 * script is never produced.
 *
 * @typedef {{ ok: true, value: string } | { ok: false, reason: string }} Validated
 */

/**
 * Characters permitted in a Purview object name.
 *
 * Letters, digits, space, underscore, dot and hyphen. Everything PowerShell
 * could use to change the meaning of a command — quotes, `$`, backtick,
 * semicolon, parentheses, braces, pipes, ampersands, newlines — is absent, and
 * that absence is the whole control.
 */
const SAFE_NAME = /^[A-Za-z0-9 _.-]+$/;

/** Purview rejects longer names; catching it here beats a confusing failure. */
const MAX_NAME_LENGTH = 64;

/**
 * Validate a Purview object name (policy, rule, or sensitive information type).
 *
 * @param {unknown} raw
 * @param {string} label Field name, for the message.
 * @returns {Validated}
 */
export function validateName(raw, label) {
	const value = String(raw ?? "").trim();

	if (!value) return { ok: false, reason: `${label} cannot be empty.` };
	if (value.length > MAX_NAME_LENGTH) {
		return { ok: false, reason: `${label} must be ${MAX_NAME_LENGTH} characters or fewer.` };
	}
	if (!SAFE_NAME.test(value)) {
		return {
			ok: false,
			reason:
				`${label} may only contain letters, digits, spaces, underscores, dots and hyphens. ` +
				`This is enforced because the value is placed into a PowerShell command you will run as an administrator.`,
		};
	}
	return { ok: true, value };
}

/**
 * Validate a member of a closed set.
 *
 * @param {unknown} raw
 * @param {readonly string[]} allowed
 * @param {string} label
 * @returns {Validated}
 */
export function validateEnum(raw, allowed, label) {
	const value = String(raw ?? "").trim();
	// Compared case-insensitively but returned in the canonical casing, since
	// PowerShell parameter values are case-insensitive while the docs are not.
	const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
	if (!match) {
		return { ok: false, reason: `${label} must be one of: ${allowed.join(", ")}.` };
	}
	return { ok: true, value: match };
}

/**
 * Validate a whole parameter set against a playbook's declared parameters.
 *
 * Returns every problem rather than the first, so a caller fixing them is not
 * led through one round-trip per field.
 *
 * @param {Record<string, unknown>} raw
 * @param {readonly import("./types.js").PlaybookParam[]} params
 * @returns {{ ok: true, values: Record<string, string> } | { ok: false, errors: string[] }}
 */
export function validateParams(raw, params) {
	/** @type {Record<string, string>} */
	const values = {};
	/** @type {string[]} */
	const errors = [];

	for (const param of params) {
		// An omitted value takes the default, which is always valid by
		// construction — a playbook shipping an invalid default is a bug in the
		// playbook, and the tests assert against it.
		const supplied = raw[param.id] === undefined || raw[param.id] === "" ? param.default : raw[param.id];

		const result = param.options
			? validateEnum(supplied, param.options, param.label)
			: validateName(supplied, param.label);

		if (result.ok) values[param.id] = result.value;
		else errors.push(result.reason);
	}

	return errors.length ? { ok: false, errors } : { ok: true, values };
}
