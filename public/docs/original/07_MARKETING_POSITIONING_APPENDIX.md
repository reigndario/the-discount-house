# Marketing and Positioning Appendix

## 1. Working positioning

This is not a conventional order book. Traditional markets publish prices and quantities. This protocol lets participants publish encrypted preferences and privately discovers mutually acceptable agreements.

Working concept:

```text
Confidential Preference Book
```

## 2. Differentiators

- Private lending terms.
- Private ranked preferences.
- Deterministic encrypted negotiation.
- Vesting-backed credit without mark-to-market liquidation.
- Payment-default remedy via vesting beneficiary reassignment.
- Economic anti-probing design.
- Protocol-account foundation for institutional use.

## 3. Messaging notes

Potential phrases:

- “Private capital formation without leaking the cap table.”
- “Borrow against vesting without broadcasting your terms.”
- “A confidential preference book, not a public order book.”
- “Encrypted negotiation for private credit.”
- “Lending terms are negotiated by protocol, not exposed to the market.”

## 4. Why this matters

Public order books are efficient but leak intent. In private credit and tokenized equity contexts, intent leakage can be commercially damaging. A confidential preference book allows parties to express willingness privately while still obtaining deterministic, auditable execution.

## 5. Terms to explore later

- Confidential Preference Book
- Private Preference Registry
- Confidential Negotiation Protocol
- Encrypted Credit Negotiation
- Vesting-Backed Confidential Credit
- Private Capital Coordination Layer

## 6. Avoid overclaiming

Do not claim full anonymity in MVP. The protocol hides values and terms but does not fully hide transaction timing or caller metadata.

Do not claim trustlessness without caveats. Zama gateway/KMS trust assumptions must be disclosed.

Do not claim “liquidation-free” without explaining that default still transfers vesting benefit/control to lender.
