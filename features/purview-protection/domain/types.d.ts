/**
 * Playbook types.
 *
 * A playbook is a sequence with state, not a layout. That is what makes it
 * worth a canvas rather than a markdown answer in chat: it survives across
 * turns, shows progress, and gates the step that changes your tenant behind a
 * human action.
 *
 * Playbooks are *data*. Adding one means adding a file under `playbooks/` and
 * registering it — not writing a view. The screen is written once.
 *
 * Declarations only; no runtime code ships from here.
 */

/**
 * What a step is for, which decides how it renders and how seriously it is
 * gated.
 *
 *   prerequisite  something to install, connect, or confirm before starting
 *   script        a command to run — may or may not change the tenant
 *   verify        a read-only command whose output is evidence of the outcome
 *   note          guidance with nothing to run
 */
export type StepKind = "prerequisite" | "script" | "verify" | "note";

/** A runnable block attached to a step. */
export interface PlaybookScript {
	/** Shell the block is written for. Drives the label and the copy hint. */
	language: "powershell";
	code: string;
	/**
	 * True when running this alters tenant configuration.
	 *
	 * Drives the warning treatment and the confirmation gate. Read-only checks
	 * are deliberately not marked, so the warning keeps its meaning instead of
	 * appearing on every block.
	 */
	destructive: boolean;
	/** One line on what running it will actually do. */
	effect?: string;
}

/** One step of a playbook. */
export interface PlaybookStep {
	id: string;
	kind: StepKind;
	title: string;
	/** Paragraphs. Plain text — rendered escaped, never as HTML. */
	body: string[];
	script?: PlaybookScript;
	/** Official documentation for this step, if any. */
	docsUrl?: string;
	docsLabel?: string;
}

/** A parameter the operator can set before the scripts are generated. */
export interface PlaybookParam {
	id: string;
	label: string;
	/** Why this value matters, and what happens if it is wrong. */
	help: string;
	default: string;
	/** Present for a closed set; renders as a select rather than a text field. */
	options?: string[];
}

/** A playbook definition. Pure data plus one script builder. */
export interface Playbook {
	id: string;
	title: string;
	/** One line: what this playbook accomplishes. */
	summary: string;
	/**
	 * Why this is a script the operator runs rather than a button that acts.
	 * Stated on screen, because "why can't you just do it" is the first
	 * question a playbook like this provokes.
	 */
	rationale: string[];
	params: PlaybookParam[];
	/** Build the steps for a set of parameter values. */
	buildSteps: (params: Record<string, string>) => PlaybookStep[];
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

/**
 * How far the operator says they have got.
 *
 * Deliberately named as a claim rather than a fact: this process cannot watch
 * their terminal, so a ticked step is what they told us. Only the verify
 * step's output is evidence, and the UI says so.
 */
export interface PlaybookProgress {
	/** Step ids the operator marked done. */
	claimedDone: string[];
	/** Step currently expanded. */
	openStepId: string | null;
}

/** DLP coverage across the agent estate, from the inventory. */
export interface DlpCoverage {
	/** protection.dlp === true */
	covered: number;
	/** protection.dlp === false — evaluated, and not covered. */
	uncovered: number;
	/** protection.dlp === null — never evaluated. Not a claim either way. */
	notEvaluated: number;
	total: number;
	/** A few uncovered agents, for naming names rather than only counting. */
	examples: Array<{ agentId: string; title: string; platform: string }>;
}

/** Everything the playbook screen renders from. Must stay JSON-safe. */
export interface PlaybookState {
	status: "ready" | "loading" | "error";
	note: string;
	playbookId: string;
	params: Record<string, string>;
	progress: PlaybookProgress;
	/** Null until the inventory has been read. */
	coverage: DlpCoverage | null;
}
