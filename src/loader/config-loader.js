// The client config loader — docs/06-loader-and-activation.md + docs/03-client-model.md.
//
// This is the engine's "assembly instructions" layer: at runtime it locates a client's
// config, loads it, validates it, and resolves the named adapters against the engine's
// adapter registry — handing the caller a ready, validated client context. Its governing
// discipline is "validate before acting": it checks the full chain
//
//     clients_dir -> client -> config -> adapters -> references -> profile
//
// before anything downstream runs, failing LOUD and EARLY on the first link that does not
// hold (LoaderError, naming the gate). A skill therefore never starts with half its context.
//
// Two boundaries this file keeps deliberately:
//   * It does NOT own profile policy. Whether a feature is legal under a profile is the
//     profile-evaluator's job (T-MVP-03); the loader *calls* it (call, not contain — SRP).
//     Here the loader carries only the seam: it reads the declared profile and, at the
//     profile link of the chain, defers to an injected evaluator. The default evaluator
//     defers (allows), so until T-MVP-03 lands the loader's behaviour is unchanged, and the
//     real evaluator drops in without touching this file.
//   * It does NOT implement the full activation predicate (recognition / registry-enabled /
//     scope / result-kind typing). That is T-MVP-11, which builds on this loader. This file
//     stops at "a valid, complete, adapter-resolved client context".

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath, relative as relativePath } from 'node:path';

import { GATES, LoaderError } from './errors.js';
import { EDGES, defaultAdapterRegistry } from './adapter-registry.js';
// The verdict SHAPE is owned by the profile-evaluator (SRP). The loader validates a verdict
// against that contract rather than inventing its own check — keeping the deny-first
// consumption (malformed/throw -> deny) honest without re-implementing policy.
import { isVerdict } from '../governance/profile-evaluator.js';

// --- "data only, no logic" guard --------------------------------------------------------
//
// docs/03 §"a client is data only": the config describes, it does not execute. JSON cannot
// carry executable elements, so a well-formed JSON config satisfies this structurally. The
// one residual risk is a value shaped like an instruction to a later consumer; the loader
// rejects the obvious case of an embedded function. (The deeper "is this data or a program"
// rule is enforced by the JSON format choice itself — there is nowhere for a loop or branch
// to live.)
export function assertDataOnly(value, where = '') {
  if (typeof value === 'function') {
    throw new LoaderError(
      GATES.CONFIG,
      `config contains executable logic at ${where}; a client is data only (no functions)`,
      { field: where },
    );
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assertDataOnly(v, where === '' ? k : `${where}.${k}`);
    }
  }
}

// --- small helpers ----------------------------------------------------------------------

function requireString(obj, field, gate) {
  const v = obj?.[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new LoaderError(gate, `config is missing required field "${field}" (a non-empty string)`, {
      field,
    });
  }
  return v;
}

function pathExists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The default profile-evaluator seam. Returns `allow` for every (profile, feature) pair —
 * i.e. it defers. The real, table-driven evaluator (T-MVP-03) replaces this by injection;
 * the loader never inlines profile policy.
 */
export const deferAllProfileEvaluator = Object.freeze({
  evaluate: () => ({ decision: 'allow' }),
});

// --- CC-34: parent+child config inheritance -----------------------------------
//
// A corporate group expresses shared deployment data once on a PARENT client (shared legal
// text, org-baseline tool policy, default adapters) and lets each brand-level CHILD config
// inherit it, overriding only what differs. The merge is the data-level expression of that:
// a child declares `"parent": "<parentId>"` and the loader folds the parent's config UNDER
// the child's before the validate-before-acting chain runs on the *merged* object. Depth is
// one (a parent may not itself have a parent) — the loader enforces that at the wiring site,
// not here.

// A scheme-prefixed handle ("figma://…") is a non-local address; everything else is a path.
const isLocalRef = (ref) => typeof ref === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(ref);

/**
 * Merge a parent client's raw config under a child's, producing the raw object the loader
 * then validates as if it were the child's own. Pure data transform — performs no I/O and
 * no validation (the loader's chain does that on the result).
 *
 * Merge semantics (see / the CC-34 spec):
 *   - identity          : always the child's (a child has its own identity).
 *   - adapters/profile/
 *     mcpPolicy/
 *     modelDefaults     : child wins if present; otherwise the parent's.
 *   - orgBaseline/skills : child wins as a WHOLE array if present; otherwise the parent's.
 *   - skillParameters    : key-level — parent provides defaults, child overrides per key.
 *   - references         : key-level — parent provides defaults, child overrides per key.
 *                          A parent LOCAL-path reference is rewritten to an ABSOLUTE path
 *                          (against `parentDirAbs`) so it stays resolvable from the child's
 *                          subtree; the tenancy check (link 5) then admits it because it
 *                          resolves within the parent's subtree (ARCH-06 relaxation).
 *   - secretRefs         : union of both, de-duplicated.
 *   - parent             : dropped — never propagated into the merged result.
 *
 * @param {object} parentRaw  the parent client's parsed config.json
 * @param {object} childRaw   the child client's parsed config.json (carries `parent`)
 * @param {{ parentDirAbs: string }} opts  the parent client's absolute subtree, for ref rewrite
 * @returns {object} a new raw config object (neither input is mutated)
 */
export function mergeParentChild(parentRaw, childRaw, { parentDirAbs } = {}) {
  const present = (v) => v !== undefined && v !== null;
  const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

  // references: parent defaults (local paths made absolute) then child overrides per key.
  const mergedReferences = {};
  if (isPlainObject(parentRaw.references)) {
    for (const [key, ref] of Object.entries(parentRaw.references)) {
      if (typeof ref === 'string' && isLocalRef(ref) && typeof parentDirAbs === 'string') {
        mergedReferences[key] = isAbsolute(ref) ? ref : resolvePath(parentDirAbs, ref);
      } else {
        mergedReferences[key] = ref;
      }
    }
  }
  if (isPlainObject(childRaw.references)) {
    for (const [key, ref] of Object.entries(childRaw.references)) {
      mergedReferences[key] = ref;
    }
  }

  // skillParameters: key-level — parent defaults under child overrides.
  const mergedSkillParameters = {
    ...(isPlainObject(parentRaw.skillParameters) ? parentRaw.skillParameters : {}),
    ...(isPlainObject(childRaw.skillParameters) ? childRaw.skillParameters : {}),
  };

  // secretRefs: union, de-duplicated, preserving order (parent first, then new child entries).
  const parentSecrets = Array.isArray(parentRaw.secretRefs) ? parentRaw.secretRefs : [];
  const childSecrets = Array.isArray(childRaw.secretRefs) ? childRaw.secretRefs : [];
  const mergedSecretRefs = [...new Set([...parentSecrets, ...childSecrets])];

  const merged = {
    identity: childRaw.identity,
    adapters: present(childRaw.adapters) ? childRaw.adapters : parentRaw.adapters,
    profile: present(childRaw.profile) ? childRaw.profile : parentRaw.profile,
    mcpPolicy: present(childRaw.mcpPolicy) ? childRaw.mcpPolicy : parentRaw.mcpPolicy,
    modelDefaults: present(childRaw.modelDefaults) ? childRaw.modelDefaults : parentRaw.modelDefaults,
    orgBaseline: present(childRaw.orgBaseline) ? childRaw.orgBaseline : parentRaw.orgBaseline,
    skills: present(childRaw.skills) ? childRaw.skills : parentRaw.skills,
    skillParameters: mergedSkillParameters,
    references: mergedReferences,
    secretRefs: mergedSecretRefs,
  };

  // Carry through any other parent/child keys we do not name explicitly (child wins), then
  // drop `parent` so it never propagates into the merged result.
  const result = { ...parentRaw, ...childRaw, ...merged };
  delete result.parent;
  // Strip keys we set to undefined (neither parent nor child supplied them) so the merged
  // object looks like a plain authored config to the validation chain.
  for (const k of Object.keys(result)) {
    if (result[k] === undefined) delete result[k];
  }
  return result;
}

/**
 * Load and validate a client config, resolving its adapters and references.
 *
 * @param {object} args
 * @param {string} args.clientsDir   path to the clients directory (may live outside the engine repo)
 * @param {string} args.client       the client identifier to select (e.g. "my-client")
 * @param {object} [args.adapterRegistry]  engine adapter registry; defaults to the MVP catalog
 * @param {object} [args.profileEvaluator] (profile, feature) -> {decision}; defaults to defer-all
 * @param {Iterable<string>} [args.requiredFeatures] features this request would use, checked
 *        against the profile-evaluator at the profile link of the chain
 * @returns {{
 *   identifier: string,
 *   displayName: string,
 *   configPath: string,
 *   profile: string|null,
 *   adapters: { input: string, output: string },
 *   references: Record<string, { ref: string, resolvedPath: string|null, local: boolean }>,
 *   skills: string[],
 *   skillParameters: object,
 *   secretRefs: string[],
 *   mcpPolicy: object|null,
 *   raw: object,
 * }}
 * @throws {LoaderError} on the first failing link of the validate-before-acting chain
 */
export function loadClientConfig({
  clientsDir,
  client,
  adapterRegistry = defaultAdapterRegistry(),
  profileEvaluator = deferAllProfileEvaluator,
  requiredFeatures = [],
} = {}) {
  // CC-34: a child config may declare `"parent"` to inherit a parent client's
  //   config; the merge happens after link 3 (below), via `mergeParentChild`, so the rest of
  //   the chain validates the merged object.
  // ---- link 1: clients_dir -------------------------------------------------------------
  // The loader must know *where* to look. A missing clients_dir is a startup-configuration
  // error, not a runtime one — the loader does not guess.
  if (typeof clientsDir !== 'string' || clientsDir.trim() === '') {
    throw new LoaderError(
      GATES.CLIENTS_DIR,
      'clients_dir not provided: I do not know where to look for clients (startup configuration error)',
      { field: 'clientsDir' },
    );
  }
  const clientsDirAbs = isAbsolute(clientsDir) ? clientsDir : resolvePath(process.cwd(), clientsDir);
  if (!pathExists(clientsDirAbs)) {
    throw new LoaderError(GATES.CLIENTS_DIR, `clients_dir "${clientsDir}" does not exist`, {
      path: clientsDirAbs,
    });
  }

  // ---- link 2: client ------------------------------------------------------------------
  // Select the one client named in the request from the (possibly many) in clients_dir.
  if (typeof client !== 'string' || client.trim() === '') {
    throw new LoaderError(GATES.CLIENT, 'no client identifier given to select from clients_dir', {
      field: 'client',
    });
  }
  const clientDirAbs = resolvePath(clientsDirAbs, client);
  const configPath = resolvePath(clientDirAbs, 'config.json');
  if (!pathExists(configPath)) {
    throw new LoaderError(
      GATES.CLIENT,
      `client "${client}" not found in clients_dir (no config.json at its subtree)`,
      { name: client, path: configPath },
    );
  }

  // ---- link 3: config (load + structural validation) -----------------------------------
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (cause) {
    throw new LoaderError(GATES.CONFIG, `cannot read config for client "${client}"`, {
      name: client,
      path: configPath,
      cause,
    });
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new LoaderError(GATES.CONFIG, `config for client "${client}" is not valid JSON`, {
      path: configPath,
      cause,
    });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LoaderError(GATES.CONFIG, `config for client "${client}" must be a JSON object`, {
      path: configPath,
    });
  }

  // "data only, no logic" — the guardian of the principle from docs/03.
  assertDataOnly(raw, '');

  // identity: identifier + displayName are mandatory; the declared identifier must match
  // the directory the loader selected (the directory is the address of record).
  const identity = raw.identity;
  if (!identity || typeof identity !== 'object') {
    throw new LoaderError(GATES.CONFIG, 'config is missing the "identity" section', {
      field: 'identity',
    });
  }
  const identifier = requireString(identity, 'identifier', GATES.CONFIG);
  const displayName = requireString(identity, 'displayName', GATES.CONFIG);
  if (identifier !== client) {
    throw new LoaderError(
      GATES.CONFIG,
      `config identity.identifier "${identifier}" does not match the selected client directory "${client}"`,
      { field: 'identity.identifier' },
    );
  }

  // ---- link 3b: parent inheritance (CC-34 /) -----------------------------------
  // If this config declares a `parent`, fold the parent's config UNDER it and continue the
  // chain on the merged object. Depth is one: a parent may not itself declare a parent. The
  // parent's subtree (`parentDirAbs`) flows to link 5 so a parent-inherited local reference
  // (rewritten to an absolute path during merge) passes the tenancy check (ARCH-06).
  let parentDirAbs = null;
  if (typeof raw.parent === 'string' && raw.parent.trim() !== '') {
    const parentId = raw.parent.trim();
    if (parentId === client) {
      throw new LoaderError(
        GATES.CONFIG,
        `config "parent" cannot reference the client itself ("${client}")`,
        { field: 'parent', name: parentId },
      );
    }
    const parentDir = resolvePath(clientsDirAbs, parentId);
    // `parent` is a client IDENTIFIER, not a path: it must name a sibling subtree directly
    // under clients_dir, never escape it (e.g. "../outside"). Refuse before any file read,
    // mirroring the link-5 tenancy containment — a traversal here would read a config from
    // outside the tenancy root.
    const parentDirRel = relativePath(clientsDirAbs, parentDir);
    if (parentDirRel === '' || parentDirRel.startsWith('..') || isAbsolute(parentDirRel)) {
      throw new LoaderError(
        GATES.CONFIG,
        `config "parent" "${parentId}" escapes clients_dir; parent must be a client identifier, not a path`,
        { field: 'parent', name: parentId },
      );
    }
    const parentConfigPath = resolvePath(parentDir, 'config.json');
    if (!pathExists(parentConfigPath)) {
      throw new LoaderError(
        GATES.CONFIG,
        `config "parent" names "${parentId}", which is not a client in clients_dir (no config.json at its subtree)`,
        { field: 'parent', name: parentId, path: parentConfigPath },
      );
    }
    let parentRaw;
    try {
      parentRaw = JSON.parse(readFileSync(parentConfigPath, 'utf8'));
    } catch (cause) {
      throw new LoaderError(
        GATES.CONFIG,
        `parent config "${parentId}" cannot be read or is not valid JSON`,
        { field: 'parent', name: parentId, path: parentConfigPath, cause },
      );
    }
    if (!parentRaw || typeof parentRaw !== 'object' || Array.isArray(parentRaw)) {
      throw new LoaderError(GATES.CONFIG, `parent config "${parentId}" must be a JSON object`, {
        field: 'parent',
        name: parentId,
        path: parentConfigPath,
      });
    }
    if (typeof parentRaw.parent === 'string' && parentRaw.parent.trim() !== '') {
      throw new LoaderError(
        GATES.CONFIG,
        `parent "${parentId}" itself declares a "parent" — inheritance is one level deep only (no chaining)`,
        { field: 'parent', name: parentId },
      );
    }
    assertDataOnly(parentRaw, '');
    raw = mergeParentChild(parentRaw, raw, { parentDirAbs: parentDir });
    parentDirAbs = parentDir;
  }

  // ---- link 4: adapters (selected by name, must exist in the registry) -----------------
  const adapters = raw.adapters;
  if (!adapters || typeof adapters !== 'object') {
    throw new LoaderError(GATES.ADAPTERS, 'config is missing the "adapters" section', {
      field: 'adapters',
    });
  }
  const inputName = requireString(adapters, 'input', GATES.ADAPTERS);
  const outputName = requireString(adapters, 'output', GATES.ADAPTERS);
  if (!adapterRegistry.has(EDGES.INPUT, inputName)) {
    throw new LoaderError(
      GATES.ADAPTERS,
      `unknown input adapter "${inputName}" (known input adapters: ${adapterRegistry.names(EDGES.INPUT).join(', ') || 'none'})`,
      { field: 'adapters.input', name: inputName },
    );
  }
  if (!adapterRegistry.has(EDGES.OUTPUT, outputName)) {
    throw new LoaderError(
      GATES.ADAPTERS,
      `unknown output adapter "${outputName}" (known output adapters: ${adapterRegistry.names(EDGES.OUTPUT).join(', ') || 'none'})`,
      { field: 'adapters.output', name: outputName },
    );
  }

  // ---- link 5: references (addresses must be sensible / resolvable) ---------------------
  // docs/03 §validation: the loader checks the *address*, not the content. A local-path
  // reference must point at something that exists; a non-local handle (a URL/scheme such as
  // figma://) is accepted as a well-formed address — opening it is the input adapter's job.
  const references = {};
  const refSection = raw.references ?? {};
  if (refSection && typeof refSection === 'object' && !Array.isArray(refSection)) {
    for (const [key, ref] of Object.entries(refSection)) {
      if (typeof ref !== 'string' || ref.trim() === '') {
        throw new LoaderError(
          GATES.REFERENCES,
          `reference "${key}" must be a non-empty address string`,
          { field: `references.${key}` },
        );
      }
      const isLocalPath = !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(ref); // not "scheme://"
      if (isLocalPath) {
        const refAbs = isAbsolute(ref) ? ref : resolvePath(clientDirAbs, ref);
        // ---- tenancy containment (ARCH-06, docs/06 §"Tenancy posture") ----
        // The per-client SUBTREE is the isolation unit: a client's local reference must resolve
        // to a path INSIDE its own subtree, never another client's. Without this check, a
        // reference like "../other-client/resources/secret.json" (or an absolute path into a
        // sibling subtree) would silently CROSS-READ another tenant's data — a confidentiality
        // break the loader must refuse, loud and early, before any adapter reads the file. We
        // judge containment on the resolved absolute path (after `..`/symlink-free normalization
        // that resolvePath performs): a reference escapes iff its path relative to the client
        // subtree starts with ".." or is itself absolute (a different root entirely).
        // CC-34 relaxation: when this config inherited from a parent (`parentDirAbs` set), a
        // reference is also admissible if it resolves within the PARENT's subtree — that is the
        // one cross-subtree read tenancy permits, because the operator wired the inheritance
        // explicitly via `parent`. A path outside BOTH subtrees is still refused.
        const within = (baseAbs) => {
          if (baseAbs === null) return false;
          const r = relativePath(baseAbs, refAbs);
          return r !== '' && !r.startsWith('..') && !isAbsolute(r);
        };
        const escapes = !within(clientDirAbs) && !within(parentDirAbs);
        if (escapes) {
          const scope =
            parentDirAbs !== null ? "the client's or its parent's subtree" : `client "${client}"'s subtree`;
          throw new LoaderError(
            GATES.REFERENCES,
            `reference "${key}" escapes ${scope}: "${ref}" resolves outside it ` +
              `(a client may only reference resources within its own${parentDirAbs !== null ? " or its parent's" : ''} subtree — tenancy isolation, ARCH-06)`,
            { field: `references.${key}`, path: refAbs },
          );
        }
        if (!pathExists(refAbs)) {
          throw new LoaderError(
            GATES.REFERENCES,
            `cannot open the resource named by reference "${key}": "${ref}" (resolved to ${refAbs})`,
            { field: `references.${key}`, path: refAbs },
          );
        }
        references[key] = { ref, resolvedPath: refAbs, local: true };
      } else {
        // A non-local handle: well-formed address accepted; the input adapter resolves it.
        references[key] = { ref, resolvedPath: null, local: false };
      }
    }
  } else if (refSection !== undefined && refSection !== null) {
    throw new LoaderError(GATES.REFERENCES, 'config "references" must be an object of addresses', {
      field: 'references',
    });
  }

  // ---- link 6: profile (call the evaluator — call, not contain) -------------------------
  // The loader reads the declared profile (optional at MVP) and, for each feature this
  // request would use, DEFERS the legality verdict to the injected profile-evaluator. The
  // loader owns no profile table (SRP) — it only consumes the verdict and stops the chain
  // when a feature is not provably legal.
  //
  // DENY-FIRST CONSUMPTION (deny-first governance seam): the loader proceeds ONLY on a
  // well-formed `allow` verdict. A `deny`, a MALFORMED verdict, or a THROWING evaluator all
  // stop the chain at the profile gate — never read through as allow. The verdict shape is the
  // evaluator's contract (isVerdict), so the loader validates against that rather than
  // inventing its own shape check.
  const profile = typeof raw.profile === 'string' && raw.profile.trim() !== '' ? raw.profile : null;
  for (const feature of requiredFeatures) {
    let verdict;
    try {
      verdict = profileEvaluator.evaluate(profile, feature);
    } catch (cause) {
      throw new LoaderError(
        GATES.PROFILE,
        `the profile-evaluator threw while checking feature "${feature}" under the "${profile ?? 'unspecified'}" profile; treating as denied (fail-closed)`,
        { field: 'profile', name: feature, cause },
      );
    }
    if (!isVerdict(verdict)) {
      throw new LoaderError(
        GATES.PROFILE,
        `the profile-evaluator returned a malformed verdict for feature "${feature}"; treating as denied (fail-closed)`,
        { field: 'profile', name: feature },
      );
    }
    if (verdict.decision !== 'allow') {
      throw new LoaderError(
        GATES.PROFILE,
        `feature "${feature}" is not permitted under the "${profile ?? 'unspecified'}" deployment profile` +
          (verdict.reason ? `: ${verdict.reason}` : ''),
        { field: 'profile', name: feature },
      );
    }
  }

  // skills: the skills this client has ADOPTED (docs/06 §"Client-has-skill", conjunct 2 of
  // activation — "a skill the client has not adopted does not activate"). Declarative data, a
  // list of skill names. ABSENT -> [] (adopts nothing): silence is non-adoption, deny-first,
  // consistent with the resolver's all-defer -> deny. The activation predicate (T-MVP-11)
  // reads this as `ctx.skills.includes(skillName)`; string-filtered so that read is always safe.
  const skills = Array.isArray(raw.skills) ? raw.skills.filter((s) => typeof s === 'string') : [];

  // secretRefs / skillParameters: carried through as data (references only, never values).
  const secretRefs = Array.isArray(raw.secretRefs)
    ? raw.secretRefs.filter((s) => typeof s === 'string')
    : [];

  // orgBaseline: the org-floor tool-policy rules this client's deployment carries as DATA — a
  // list of { pattern, decision } the per-call gate folds into its org layer. Without exposing
  // it here, the rules are documentation only: the gate would run with an empty org layer and
  // every required tool would resolve to deny (silence is denial). ABSENT/malformed -> [].
  const orgBaseline = Array.isArray(raw.orgBaseline)
    ? raw.orgBaseline.filter((r) => r && typeof r.pattern === 'string')
    : [];

  // mcpPolicy: the per-client MCP-connector posture this deployment carries as DATA. An MCP tool
  // call (name shaped `mcp__<server>__<action>`) reaches a stateful, often universal connector the
  // tool-scope resolver's pattern rules do not see as distinct — so the gate needs the server
  // allowlist + default posture here to decide it. ABSENT -> null: the gate reads a missing policy
  // as "deny unknown MCP" (fail-closed), never as "allow everything". An object is carried through
  // as-is (the gate validates its shape at decision time, deny-first).
  const mcpPolicy =
    raw.mcpPolicy && typeof raw.mcpPolicy === 'object' && !Array.isArray(raw.mcpPolicy)
      ? raw.mcpPolicy
      : null;
  const skillParameters =
    raw.skillParameters && typeof raw.skillParameters === 'object' && !Array.isArray(raw.skillParameters)
      ? raw.skillParameters
      : {};

  return {
    identifier,
    displayName,
    configPath,
    profile,
    adapters: { input: inputName, output: outputName },
    references,
    skills,
    skillParameters,
    secretRefs,
    orgBaseline,
    mcpPolicy,
    raw,
  };
}
