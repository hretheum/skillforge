// Lifecycle hooks — docs/13-tool-governance.md §"Enforcement seam — hooks" +
// docs/14-deployment-profiles.md §"the profile-evaluator".
//
// Sources: concept + first principles + public Claude Code hooks documentation (the lifecycle
// event names are cited as one target surface); zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md, docs/14-deployment-profiles.md.
//
// THE SESSION-EDGE SEAM. The PreToolUse/PostToolUse hooks fire around individual TOOL CALLS.
// These hooks fire around the SESSION ITSELF — when a worktree is created, a session starts or
// ends, a skill activates. They are the choke points where the deployment profile gets a say
// over whether a session-edge convenience is even allowed to happen.
//
// PROFILE GATING (docs/14). Under the compliance profile certain managed-runtime conveniences
// are forbidden because they would place content outside the EU/ZDR boundary. Two session-edge
// events are themselves such conveniences here: onWorktreeCreate and onSessionStart provision
// managed state, so under compliance they are GATED (logged, but not allowed to proceed). The
// profile legality is read through the SAME evaluator the loader/resolver use — isAllowed from
// profile-evaluator.js — so there is one copy of the contract, not a second policy here.
//
// DENY-FIRST, but OBSERVABLE. A gated event is still LOGGED (gated=true, logged=true): the
// record matters even when the action is refused. Other profiles log without gating.

import { isAllowed, profileEvaluator } from './profile-evaluator.js';

/** The session-edge lifecycle events this seam fires for. */
export const LIFECYCLE_EVENT = Object.freeze({
  WORKTREE_CREATE: 'onWorktreeCreate',
  SESSION_START: 'onSessionStart',
  SESSION_END: 'onSessionEnd',
  SKILL_ACTIVATE: 'onSkillActivate',
});

// The events that provision managed-runtime state and so are subject to compliance gating.
// Each maps to the feature handle the profile-evaluator's contract table understands, so the
// gating decision is the evaluator's, not a second copy of the rule.
const GATED_EVENT_FEATURE = Object.freeze({
  [LIFECYCLE_EVENT.WORKTREE_CREATE]: 'server-side-agent-skills',
  [LIFECYCLE_EVENT.SESSION_START]: 'server-side-tools',
});

const KNOWN_EVENTS = Object.freeze(new Set(Object.values(LIFECYCLE_EVENT)));

/**
 * Build the lifecycle-hooks seam.
 *
 * @param {object} [deps]
 * @param {{evaluate: Function}} [deps.evaluator] profile evaluator; defaults to profileEvaluator
 * @returns {{ fire: Function }}
 */
export function createLifecycleHooks(deps = {}) {
  const evaluator = deps.evaluator ?? profileEvaluator;

  /**
   * Fire a lifecycle event under the active profile.
   *
   * @param {string} event a LIFECYCLE_EVENT value
   * @param {object} [context]
   * @param {string|null} [context.profile]  active deployment profile (drives gating)
   * @param {string} [context.skillName]    the skill activating (onSkillActivate)
   * @param {string} [context.clientId]     the client owning the session
   * @returns {{ logged: boolean, gated: boolean, reason: string }}
   */
  function fire(event, context = {}) {
    const { profile = null } = context;

    // an unrecognised event is not provably safe — deny-first: gate it, but still record it.
    if (!KNOWN_EVENTS.has(event)) {
      return { logged: true, gated: true, reason: `unknown lifecycle event "${event}"; gated (fail-closed)` };
    }

    const feature = GATED_EVENT_FEATURE[event];
    // events that don't provision managed state (onSessionEnd, onSkillActivate) never gate.
    if (feature === undefined) {
      return { logged: true, gated: false, reason: `lifecycle event "${event}" logged (not subject to profile gating)` };
    }

    // a gating-eligible event: read the profile contract through the shared evaluator.
    // isAllowed is deny-first — a deny / malformed verdict / throw all collapse to "gated".
    if (isAllowed(evaluator, profile, feature)) {
      return { logged: true, gated: false, reason: `lifecycle event "${event}" permitted under the "${profile}" profile` };
    }
    return {
      logged: true,
      gated: true,
      reason: `lifecycle event "${event}" gated: feature "${feature}" is not legal under the "${profile}" profile ` +
        `(compliance posture forbids managed-runtime provisioning that would leave the EU/ZDR boundary)`,
    };
  }

  return { fire };
}

/** A ready-to-use seam backed by the default profile evaluator. */
export const lifecycleHooks = createLifecycleHooks();
