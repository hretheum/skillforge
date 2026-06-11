// Public surface of the continuous-learning loop: audit-trail observation → instinct →
// skill-candidate promotion.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

export { OBSERVATION_EVENT, OBSERVATION_SCHEMA, extractObservations } from "./observation-schema.js";
export { createObserver, minePatterns } from "./observer.js";
export { CONFIDENCE_THRESHOLD, scorePattern, filterConfident } from "./confidence-scorer.js";
export { LEARNED_DIR, promoteToLearned } from "./skill-promoter.js";
