// Tests for the create-component COMPOSE step (T-MVP-12 skill core).
//
// Sources: concept + first principles, zero third-party skills-factory files (clean-room).
// docs/05 step 4: compose combines the generic recipe with the client's normalized DS
// description, producing a frontend-component spec; a component binding a role the DS does not
// define fails loud (DS-compliance).

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeComponent, RESULT_KIND, SOURCE_KIND } from "../../src/skills/create-component/compose.js";
import { isComposeError } from "../../src/skills/create-component/errors.js";

// A normalized design-system description mirroring test/fixtures/dtcg-golden-description.json:
// roles color.semantic.accent/bg/fg; tokens elided (compose checks roles).
function description(roles = ["color.semantic.accent", "color.semantic.bg", "color.semantic.fg"]) {
  return {
    edge: "input",
    envelope: { kind: SOURCE_KIND, identity: "client/tokens@test", contentHash: "sha256:" + "0".repeat(64), schemaVersion: 1 },
    payload: { roles: roles.map((name) => ({ name, type: "color", alias: "x" })), tokens: [] },
  };
}

// The Button request that, fed the golden description, yields the golden artifact's spec.
function buttonRequest() {
  return {
    componentName: "Button",
    element: "button",
    baseClass: "hbtn",
    variants: [
      { prop: "size", value: "s", class: "hbtn--sm" }, // structural, no role
      { prop: "variant", value: "acc", class: "hbtn--acc", role: "color.semantic.accent" }, // binds a DS role
    ],
    decorations: [{ element: "span", class: "sq", ariaHidden: true }],
    sourceClasses: ["hbtn", "hbtn--acc", "hbtn--sm", "sq"],
  };
}

test("RESULT_KIND/SOURCE_KIND match the skill's declared kinds", () => {
  assert.equal(RESULT_KIND, "frontend-component");
  assert.equal(SOURCE_KIND, "design-system");
});

test("composes a DS-compliant Button spec (role binding satisfied)", () => {
  const spec = composeComponent({ request: buttonRequest(), description: description() });
  assert.equal(spec.componentName, "Button");
  assert.equal(spec.element, "button");
  assert.equal(spec.baseClass, "hbtn");
  assert.deepEqual(spec.sourceClasses, ["hbtn", "hbtn--acc", "hbtn--sm", "sq"]);
  // role is a compliance fact, NOT carried into the render spec (class toggles only):
  assert.deepEqual(spec.variants, [
    { prop: "size", value: "s", class: "hbtn--sm" },
    { prop: "variant", value: "acc", class: "hbtn--acc" },
  ]);
  assert.deepEqual(spec.decorations, [{ element: "span", class: "sq", ariaHidden: true }]);
});

test("DS-COMPLIANCE: a variant binding a role the DS does not define fails loud", () => {
  const req = buttonRequest();
  req.variants[1].role = "color.semantic.nonexistent";
  assert.throws(
    () => composeComponent({ request: req, description: description() }),
    (e) => isComposeError(e) && /does not define/.test(e.message) && /not DS-compliant/.test(e.message),
  );
});

test("a variant with NO role binding needs no DS role (pure structural toggle)", () => {
  // Description with NO roles at all; the size variant (no role) must still compose.
  const req = {
    componentName: "Tag",
    element: "span",
    baseClass: "tag",
    variants: [{ prop: "size", value: "s", class: "tag--sm" }],
    sourceClasses: ["tag", "tag--sm"],
  };
  const spec = composeComponent({ request: req, description: description([]) });
  assert.deepEqual(spec.variants, [{ prop: "size", value: "s", class: "tag--sm" }]);
});

test("rejects a non-design-system description (wrong source-kind)", () => {
  const wrong = { edge: "input", envelope: { kind: "jira-project" }, payload: {} };
  assert.throws(() => composeComponent({ request: buttonRequest(), description: wrong }), isComposeError);
});

test("rejects a class not declared in sourceClasses", () => {
  const req = buttonRequest();
  req.variants[0].class = "hbtn--undeclared";
  assert.throws(() => composeComponent({ request: req, description: description() }),
    (e) => isComposeError(e) && /not declared in request.sourceClasses/.test(e.message));
});

test("rejects a non-PascalCase componentName / bad element", () => {
  assert.throws(() => composeComponent({ request: { ...buttonRequest(), componentName: "button" }, description: description() }), isComposeError);
  assert.throws(() => composeComponent({ request: { ...buttonRequest(), element: "Button" }, description: description() }), isComposeError);
});

test("rejects a missing/empty sourceClasses", () => {
  assert.throws(() => composeComponent({ request: { ...buttonRequest(), sourceClasses: [] }, description: description() }), isComposeError);
});

test("compose names no client (generic) — spec carries only component facts", () => {
  const spec = composeComponent({ request: buttonRequest(), description: description() });
  const json = JSON.stringify(spec);
  for (const banned of ["example-studio", "Example Studio", "heresy", "--bc-"]) {
    assert.ok(!json.includes(banned), `spec leaked client-specific token: ${banned}`);
  }
});
