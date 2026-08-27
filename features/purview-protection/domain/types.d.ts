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

/**
 * How the operator wants the playbook carried out.
 *
 *   guided  the steps, one at a time, run by the human in their own session
 *   auto    one composed script, run end to end by the agent in a terminal
 *
 * The difference is not presentation. Guided mode is eight commands the human
 * pastes, each of which may be run in a session they already have; auto mode
 * has to be a *single* script in a *single* session, because the sign-in that
 * step 2 performs does not survive across separate PowerShell invocations. So
 * the two modes need genuinely different artifacts, not the same steps with a
 * different preamble.
 */
export type ExecutionMode = "guided" | "auto";

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
	 * Why this is a script rather than a button that acts, stated per mode.
	 *
	 * Split because the honest answer differs: in guided mode it is "we will
	 * not touch your tenant", and in auto mode that would be a lie — there the
	 * answer is "we will, here is what stays yours". One shared paragraph would
	 * have to be vague enough to cover both, which is the wrong thing to be
	 * vague about.
	 */
	rationale: Record<ExecutionMode, string[]>;
	params: PlaybookParam[];
	/** Build the steps for a set of parameter values. */
	buildSteps: (params: Record<string, string>) => PlaybookStep[];
	/**
	 * Build the whole playbook as one script, for auto mode.
	 *
	 * Not a concatenation of {@link buildSteps}. Run unattended the script has
	 * to be idempotent and it has to stop on the one condition a human would
	 * have caught by reading — a missing sensitive information type — so it is
	 * written once, as its own artifact.
	 */
	buildScript: (params: Record<string, string>) => PlaybookScript;
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
	/** Guided by default: the safe mode is the one you get without asking. */
	mode: ExecutionMode;
	progress: PlaybookProgress;
	/** Null until the inventory has been read. */
	coverage: DlpCoverage | null;
}
