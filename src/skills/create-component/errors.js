// Error type for the create-component skill core.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room).
//
// A compose-time failure is a defect in the COMPONENT REQUEST or a DS-COMPLIANCE violation
// (a component expressed in terms the client's design system does not define). It is its own
// type so the run can classify a skill-core failure distinctly from a loader/adapter failure
// and surface it with "validate before acting" discipline — fail loud, before any artifact.

export class ComposeError extends Error {
  constructor(message, detail = {}) {
    super(message, detail.cause !== undefined ? { cause: detail.cause } : undefined);
    this.name = "ComposeError";
  }
}

export const isComposeError = (e) => e instanceof ComposeError;
