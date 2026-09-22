# PayBox control-plane research

Inspected 2026-09-23 (Asia/Jakarta). Research only; no PayBox mutations or financial actions.

## OBSERVED IN AUTHENTICATED UI

**PAYBOX AUTHENTICATED UI INSPECTION: AVAILABLE** through the owner's existing browser session. No login was attempted. Account identifiers, wallet addresses, client identifiers and key prefixes are deliberately omitted.

| Surface | Direct observation | Inspection limit |
| --- | --- | --- |
| `/approvals` | Pending count and empty state; explanatory copy describes operation-bound decisions and new requests for changed parameters. | No pending request existed, so approval details and decision dialogs were not observed. |
| `/clients` | Navigation calls this **Agents**. Integration entry points, active-client count, client rows with status, key prefix, grant count, last-used time, detail link and revoke action. | No creation, connection or revocation attempted. |
| Client detail | Status, expiry, granted credentials with individual modes; policy-edit affordance; signing-key section and recent event history. | Policy editing and signing-key generation were not opened. No secret was revealed. |
| `/credentials` | Wallet groups, chain/custody labels, shortened addresses, add/reveal/delete affordances; additional card/secret entry points. | No reveal, copy, funding, edit, add or delete action performed. |

The visible navigation included Overview, Credentials, Agents, Approvals, Plugins and Passkeys. No search/filter control was visible in the inspected list states; this is not a claim that none exists elsewhere. No populated approval, credential issuance/rotation dialog, or policy editor was inspected.

## DOCUMENTED PUBLICLY

- [Credentials and agents](https://docs.paybox.sh/concepts/model): clients represent separate agent integrations; grants scope credential access and approval mode. Client revocation need not remove underlying vaulted credentials.
- [Approvals and passkeys](https://docs.paybox.sh/concepts/approvals): protected operations use passkey presence/step-up controls. An approval authorizes a particular operation, not arbitrary changed parameters.
- [Request lifecycle](https://docs.paybox.sh/concepts/requests): submit an intent once, retain its request ID and poll. Pending approval, signature and confirmation are distinct from success; audit links user, client and request. Do not resubmit to poll.
- [MoonPay agent connection guide](https://support.moonpay.com/en/articles/669841-how-agent-connections-work-in-paybox): individual clients have isolated policies/revocation; grants govern request permissions and limits.
- [MoonPay product overview](https://support.moonpay.com/en/articles/669779-paybox-store-credentials-once-let-ai-agents-pay-securely): describes always-approve, threshold and within-policy autonomous models. The current concept page emphasizes human/autonomous grant modes; these are documentation concepts, not all observed UI controls.

These describe the provider's published model, not an independent audit of its implementation. Product docs and UI vocabulary can evolve.

## StockPilot adaptation (design decision, not PayBox observation)

Adopt isolated client identity, narrowly scoped grants, immutable requests, operation-bound approval, polling and attributable audit records. Keep StockPilot's existing server validation and human-wallet signature boundary.

**Crucial semantic difference:** PayBox's Credentials page is a vault for sensitive wallet/card/secret material. StockPilot Credentials will instead be authentication credentials **issued to an agent client**. StockPilot must not vault or expose the user's wallet private key, reproduce PayBox signing-key provisioning, or infer that a client key can sign a trade.

StockPilot's MVP mode is ALWAYS_APPROVE. Authentication identifies the caller; a grant permits requesting an investment; approval binds the exact operation; the user's wallet supplies the signature. These are separate permissions and events.

No PayBox source code, branding, private data, visual design or copy is incorporated. Future pages should follow StockPilot's own design system.

## Verification

Documentation-only change. Checked observed/public separation, source URLs, absence of private account data, and absence of claims about uninspected flows. This research is committed separately from product or UI changes.
