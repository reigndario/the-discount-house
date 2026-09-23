# The Discount House: Notes & Strategy

Sep 23, 2026 · KingDario

Questions raised by users, with answers.

## Q1: How do we create a market to buy/sell vesting tokens? Can vesting tokens even be sold legally, since they have to be unlocked first?

- TDH doesn't create a market to buy or sell vesting tokens. That's not what it does.
- Most vesting arrangements are enforced at the smart contract level, not just contractually. The unvested balance
  literally can't be transferred, the contract won't let it through, regardless of intent.
- So there's no vesting token market to "make legal." Nothing about the restriction is a choice someone could violate,
  it's code-enforced.
- TokenOps custody doesn't create tradability either. It takes custody of the vesting position (the claim on future
  unlocks) and can redirect where those unlocks go if the borrower defaults. The borrower pledges the right to receive
  tokens later, similar to pledging restricted stock as loan collateral without selling a share.
- Caveat: whether a given project's token purchase agreement even permits pledging the position as collateral (versus
  outright sale) varies by project. Some SAFT/VC-style agreements bar any transfer, pledge, or hypothecation during
  lockup. That's a per-project legal question, not something the protocol resolves on its own.

## Q2: Who wants to sell or lend illiquid assets? What's the point, and how big would the discount need to be for someone to borrow against one?

- Nobody's lending against or buying "an illiquid asset you're stuck with forever." They're lending against a known,
  time-bound future cash flow: tokens that unlock on a schedule.
- This isn't a new idea, it's the oldest form of credit there is: discounting a bill of exchange, factoring receivables,
  lending against restricted stock.
- Borrower's point: liquidity now, without forced early exposure to price risk or a sale they can't even execute.
- Lender's point: yield. They take on illiquidity risk, price volatility risk over the vesting period, and enforcement
  risk, and get compensated with a return higher than lending against something liquid and boring.
- On sizing the discount (haircut): not an established figure yet since it depends on the specific token, but as an
  order of magnitude, TradFi restricted-stock lending commonly runs 30-50% haircuts. Crypto vesting collateral, being
  generally more volatile, would reasonably sit at or beyond that range rather than under it.
- Haircut size is driven by: token volatility, time until full unlock, expected market depth at unlock, and confidence
  that collateral custody and default enforcement actually work for that specific borrower.

## Q3: We borrow against illiquid vesting tokens through TokenOps custody without selling, but doesn't that still require a market and a price?

- Yes to price, no to a new market.
- The reference price isn't a price for the locked position itself, it's the current public market price of the token.
  Once vested, the tokens are identical to any unit already trading on an exchange, so that exchange price is the
  anchor.
- What gets negotiated on top of that reference price is the discount/haircut (see Q2), not a new price discovery
  mechanism.
- The protocol's actual job (preference book + negotiation engine) is the mechanism for two parties to agree on that
  discount against a price that already exists elsewhere. It's a much smaller thing to have built than "create liquidity
  for something that's structurally illiquid."
