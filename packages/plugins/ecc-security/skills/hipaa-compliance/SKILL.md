---
name: hipaa-compliance
description: HIPAA-specific entrypoint for healthcare privacy and security work. Use when a task is explicitly framed around HIPAA, PHI handling, covered entities, BAAs, breach posture, or US healthcare compliance requirements.
origin: ECC direct-port adaptation
version: "1.0.0"
---

# HIPAA Compliance

Use this as the HIPAA-specific entrypoint when a task is clearly about US healthcare compliance. This skill carries the essential HIPAA guardrails directly, so it works standalone. For deeper implementation guidance, `healthcare-phi-compliance` covers PHI/PII data classification, audit logging, encryption, and leak prevention in detail.

## When to Use

- The request explicitly mentions HIPAA, PHI, covered entities, business associates, or BAAs
- Building or reviewing US healthcare software that stores, processes, exports, or transmits PHI
- Assessing whether logging, analytics, LLM prompts, storage, or support workflows create HIPAA exposure
- Designing patient-facing or clinician-facing systems where minimum necessary access and auditability matter

## HIPAA Core Concepts

**Protected Health Information (PHI)** is any individually identifiable health information: names, MRNs, dates of service, phone numbers, addresses, SSNs, device IDs, IP addresses, photos, and any other data that could identify a patient directly or indirectly.

**Covered Entity (CE)**: healthcare providers, health plans, and healthcare clearinghouses that transmit health information electronically. HIPAA applies directly to CEs.

**Business Associate (BA)**: any vendor or service that creates, receives, maintains, or transmits PHI on behalf of a CE. A **Business Associate Agreement (BAA)** is a required contract before a BA may touch PHI. Without a signed BAA, a vendor is off-limits for PHI workloads.

**Minimum Necessary Rule**: limit access to PHI to the smallest data set needed to accomplish the task. Do not expose full records when a single field suffices.

**Audit Trail Requirement**: all access to and disclosure of PHI must be logged and retained (typically 6 years). Logs must capture who accessed what data, when, and from where.

## HIPAA Decision Gates

Before designing or reviewing any feature that may involve PHI, answer these gates in order:

1. **Is this data PHI?** — If yes, HIPAA applies. If uncertain, assume yes.
2. **Is the actor a covered entity or business associate?** — If yes, HIPAA obligations are active.
3. **Does the vendor or model provider require a BAA?** — If PHI will be sent to a third party (SaaS, LLM provider, analytics, support tooling), a BAA must be in place first. Block-by-default until confirmed.
4. **Is access limited to minimum necessary scope?** — Reject designs that expose full PHI sets when a subset suffices.
5. **Are all PHI read/write/export events auditable?** — If not, do not proceed to production.

## Essential Guardrails

- Never place PHI in logs, analytics events, crash reports, LLM prompts, or client-visible error strings.
- Never expose PHI in URLs, browser storage, screenshots, clipboard content, or example payloads in docs.
- Require authenticated access, scoped authorization, and audit trails for every PHI read and write.
- Treat all third-party SaaS, observability tools, support platforms, and LLM providers as blocked-by-default until BAA status and data flow boundaries are confirmed.
- Prefer opaque internal identifiers over names, MRNs, phone numbers, addresses, or dates of service.
- Encrypt PHI at rest (AES-256 or equivalent) and in transit (TLS 1.2+).
- Implement automatic session timeouts for any interface that displays PHI.

## BAA Checklist

When evaluating a new vendor or service that will touch PHI:

- [ ] Vendor offers a HIPAA BAA (many consumer SaaS products do not)
- [ ] BAA is signed and on file before any PHI flows to that vendor
- [ ] Vendor's data processing boundary is documented (what regions, what sub-processors)
- [ ] Data retention and deletion terms are confirmed and meet your breach response requirements
- [ ] PHI is not used by the vendor for model training or product improvement without explicit consent

## Breach Response Basics

Under HIPAA, a breach of unsecured PHI triggers mandatory notification:
- Affected individuals: within 60 days of discovery
- HHS Office for Civil Rights: within 60 days (or annually if the breach affects fewer than 500 individuals per state)
- Media: if the breach affects 500 or more residents of a state or jurisdiction

Document the breach, scope, root cause, and remediation. Maintain records for 6 years.

## Examples

### Example 1: Product request framed as HIPAA

User request:

> Add AI-generated visit summaries to our clinician dashboard. We serve US clinics and need to stay HIPAA compliant.

Response pattern:

- Activate `hipaa-compliance`
- Apply the HIPAA decision gates: confirm PHI will be in the prompt, confirm the LLM provider has a BAA in place
- Use `healthcare-phi-compliance` to review PHI movement, logging, storage, and prompt data boundaries
- If the summaries influence clinical decisions, apply additional review for patient safety considerations

### Example 2: Vendor/tooling decision

User request:

> Can we send support transcripts and patient messages into our analytics stack?

Response pattern:

- Assume those messages may contain PHI
- Block the design unless the analytics vendor has a signed BAA and the data path is minimized
- Require redaction or a non-PHI event model as an alternative

## Related Skills

- `healthcare-phi-compliance` — detailed PHI classification, encryption, audit logging, and leak prevention patterns
- `healthcare-emr-patterns` — EMR/EHR integration, HL7 FHIR, clinical data exchange
- `healthcare-eval-harness` — evaluation harnesses for healthcare AI systems
- `security-review` — general auth, input handling, secrets management, API hardening
