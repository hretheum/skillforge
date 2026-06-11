// Public surface of the governance spine: profile-evaluator + policy resolver + the shared
// tool-pattern matcher + the PreToolUse enforcement seam (resolver + secret-scan).
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/13-tool-governance.md, docs/14-deployment-profiles.md,
// docs/11-security-and-secrets.md.
export {
  profileEvaluator,
  evaluate,
  isAllowed,
  isVerdict,
  PROFILES,
  DECISIONS,
  _table,
} from './profile-evaluator.js';
export {
  assertResidencyPosture,
  PROFILE_A_POSTURE,
  RESIDENCY,
  FINDING,
  _posture,
} from './residency-posture.js';
export {
  assertExecutionPosture,
  assertPosture,
  getEffectiveTimeout,
  createHeartbeat,
  EGRESS,
  POSTURE_FINDING,
  EXECUTION_POSTURE,
  HEARTBEAT_SIGNAL,
} from './execution-posture.js';
export { subsumes, matches } from './tool-patterns.js';
export { createPolicyResolver, policyResolver, meet, DECISION } from './policy-resolver.js';
export { scanString, scanValue, hasSecret, shannonEntropy, redactString, redactValue, REDACTION_MARKER, createScanner } from './secret-scan.js';
export { sanitizeContent } from './content-sanitizer.js';
export { detectInjection } from './injection-guard.js';
export {
  SCOPE,
  PROFILE_A_REGIONS,
  MODEL_BACKEND_SECRET,
  isScope,
  scopeBreadth,
  isProfileARegion,
  modelBackendSecretViolations,
  modelBackendSecretIsLeastPrivilege,
  assertModelBackendGrant,
  assertModelBackendSecretFree,
} from './secret-scope.js';
export { createPreToolUseHook, preToolUseHook, HOOK_DECISION, mcpServerOf, validateRequiredToolsInventory } from './pretool-hook.js';
export { createPostToolUseHook, postToolUseHook, POST_HOOK_ACTION } from './posttool-hook.js';
export { createLifecycleHooks, lifecycleHooks, LIFECYCLE_EVENT } from './lifecycle-hooks.js';
export {
  makeSkillResult,
  fromSuccess,
  fromFailure,
  emitSkillResult,
  SKILL_RESULT,
  SKILL_RESULT_EVENT,
} from './skill-result.js';
export { AuditTrail, makeAuditEntry, AUDIT_EVENT, GENESIS_PREV } from './audit-trail.js';
export { checkHardenedAgreement, checkEmittedHardenedAgreement, verifySourceHash, checkAgreementMarker } from './hardened-agreement.js';
export { INJECTION_CORPUS, INJECTION_FAMILY, corpusFamilies } from './injection-corpus.js';
export {
  frameUntrustedContent,
  isProperlyFenced,
  probeScopeEscalation,
  findScopeEscalations,
  UNTRUSTED_BEGIN,
  UNTRUSTED_END,
} from './inbound-guard.js';
export { scanSkillManifest, scanMcpConfig, scanHookDescriptor } from './supply-chain-scan.js';
export { scanMcpManifest, detectHookInjection } from './mcp-risk-guard.js';
export {
  assertMemoryPosture,
  rotateCheckpoint,
  MEMORY_SCOPE,
  MEMORY_POSTURE,
} from './memory-posture.js';
export {
  monitorResidencyPosture,
  createResidencyMonitor,
  RESIDENCY_ALERT,
} from './residency-monitor.js';
