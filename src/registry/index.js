// Public surface of the registry's skill↔adapter typing (docs/04 §"Skill↔adapter typing").
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).

export { createAdapterKinds, defaultAdapterKinds } from "./adapter-kinds.js";
export {
  checkSkillAdapterTyping,
  typingFactsFromEntry,
  assertSkillAdapterTyping,
  validateKindContract,
} from "./typing.js";
export { createSkillKinds, defaultSkillKinds } from "./skill-kinds.js";
