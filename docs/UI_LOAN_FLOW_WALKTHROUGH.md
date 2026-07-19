# UI Loan Flow Walkthrough

This is the cold-start demo path for a user who does not change any default bundle terms.

## Prerequisites

- Use Sepolia.
- Have Sepolia ETH in each wallet for gas. The match step also posts a small Sepolia ETH match bond.
- Use two wallets for the cleanest demo:
  - Borrower wallet: Red Dragon role.
  - Lender wallet: Blue Dragon role.
- The same wallet can technically act as both borrower and lender, but two wallets make the flow and ownership easier to
  inspect.
- Use the same browser session if possible. The UI keeps bundle labels, local term cache, and demo capital selections in
  browser storage.
- Lender needs shielded `cUSDC`. The app links to Zama Portfolio via `Shield cUSDC`; the faucet/shield step itself is
  outside this repo.

## 1. Cold Start as Borrower

1. Open the app.
2. On the first dragon prompt, click `Yes`.
3. Connect the borrower wallet in MetaMask.
4. Click `Choose`.
5. Click on the RED DRAGON.
6. Confirm you are in the RED DRAGON (Borrower) perspective by the red hues in the UI and also the RED DRAGON is active in the thumbnail in the top right.

## 2. Borrower Onboards Vesting Collateral

1. Click `Demo Utils`.
2. In `Borrower Capital`, change `Collateral token name` to something distinctive you will remember.
3. Leave `Tokens to custody` at its default value.
4. Click `Onboard Collateral`.
5. Sign each MetaMask transaction that appears.
6. Wait for the borrower stepper to complete:
   - `Collateral`
   - `Vesting`
   - `Custody`
7. Confirm the status reads `Collateral Onboarded Successfully`.


## 3. Borrower Publishes the Default Offer Bundle

1. Click `Builder`.
2. You should see a bunch of pre-filled preferences. IF NOT, in `Preference Bundles (ranked)`, select the top borrower bundle, usually `Best Case`.
3. Confirm `Collateral asset` points to the demo collateral just onboarded (remember the name you used!).
4. Do not change the default sliders or priority polygon the first time. Once you figure the app out you can play with the defalut strategies later.
5. Click `Publish Private Offer`.
6. The `Publish Private Offer` modal opens. Sign transactions as requested while the modal advances through:
   - `Bundle`
   - `Offer`
   - `Backing`
   - `Executable`
7. Wait for the message `Private offer published and executable.`
8. Click `Close`.
9. Optional check: click `Book` and confirm the borrower offer appears under `Your Executable Offers` or as a public
   borrower bucket under `Coarse Discovery Buckets`.

`Save Local Order` is not required for this flow. Bundle ordering is browser-local only.

## 4. Switch to the Lender Wallet and Blue Dragon

1. Click the connected wallet address button in the top bar to disconnect.
2. Return to the welcome flow.
3. Click `Yes`.
4. Connect the lender wallet in MetaMask.
5. Click `Choose`.
6. Click on the BLUE DRAGON this time

If using the same wallet for both roles, you can instead use the dragon role switch and choose the Blue Dragon role.

## 5. Lender Gets and Shields cUSDC. Skip this step if you ARE SURE you have > 200 SHIELDED cUSDC already.

1. Click `Demo Utils`.
2. In `Lender Capital`, click `Shield cUSDC`.
3. In Zama Portfolio, connect the lender wallet on Sepolia.
4. If the lender wallet does not have cUSDC, use the Zama Portfolio faucet/mint flow for demo cUSDC.
5. Shield enough cUSDC for the default lender escrow amount. The default app amount is set from the top lender bundle and
   is expected to be around `100` cUSDC.
6. Return to the app.
7. Click `Check shielded cUSDC`.
8. Continue only after the readiness area says a shielded `cUSDC` handle was detected.

## 6. Lender Escrows cUSDC

1. Stay on `Demo Utils`.
2. In `Lender Capital`, leave `cUSDC to escrow` at its default value.
3. Click `Escrow Lender cUSDC`.
4. Sign each MetaMask transaction that appears.
5. Wait for the lender stepper to complete:
   - `Amount`
   - `Commitment`
   - `Credit`
6. Confirm the status reads `Credit Escrowed Successfully`.
7. Confirm `Commitment` and `Latest escrow` are no longer `None`.

## 7. Lender Publishes the Default Offer Bundle

1. Click `Builder`.
2. If you don't see a bunch of pre-populated preferences in `Preference Bundles (ranked)`, select the top lender bundle, usually `Senior Supply`.
3. Select the `Collateral asset` that matches the borrower demo collateral market name you chose earlier. The dropdown should show the borrower token
   name/address and vesting manager if the same browser session saw the borrower onboarding. REMEMBER THE NAME YOU USED!!
4. Do not change the default sliders or priority polygon the first time. It's really an advanced feature.
5. Click `Publish Private Offer`.
6. In the `Publish Private Offer` modal, sign transactions as requested while it advances through:
   - `Bundle`
   - `Offer`
   - `Backing`
   - `Executable`
7. Wait for `Private offer published and executable.`
8. Click `Close`.

## 8. Lender Executes Against the Borrower Bucket

1. Click `Loans`.
2. In `Execute Lender Bundle`, leave `Your bundle` on the default lender bundle, usually `Senior Supply`.
3. In `Target bucket`, choose the borrower demand bucket for the same collateral market.
4. Confirm the execution summary shows the same market under `Your market` and `Target bucket`.
5. Click `Execute Against Bucket`.
6. Sign each MetaMask transaction as the status advances. Expected status messages include:
   - `Preflight`
   - `Posting bond`
   - `Executing match`
   - `Computing term 1/6` through `Computing term 6/6`
   - `Committing terms`
   - `Decrypting`
   - `Settling match`
7. Wait for the status `Settled` with message `Match settled into escrow.`
8. In `Escrows`, select the new escrow if it is not already selected.

## 9. Complete Loan Activation

In `Selected Escrow`, complete the enabled action buttons in order:

1. Click `Register Collateral`.
2. Sign the MetaMask transaction and wait for confirmation.
3. Click `Credit Funding`.
4. Keep the tab open while the UI shows Zama relayer/decryption progress. Sign any MetaMask transactions that appear.
5. After `Funding` is marked complete, click `Activate`.
6. Sign the MetaMask transaction.
7. Wait for the status `Activated` with message `Loan escrow is active on Sepolia.`

At this point the borrower side should have received the borrowed confidential cUSDC. The escrow timeline should show
`Collateral`, `Funding`, and `Active` as complete.

## 10. Borrower Unshields Borrowed cUSDC

There is no in-app unshield button in the current UI.

1. Switch back to the borrower wallet. 
2. Open `https://portfolio.zama.org/shield`.
3. Connect the borrower wallet on Sepolia.
4. Use the Zama Portfolio unshield/unwrap flow for `cUSDC`.
5. Unshield the borrowed amount shown in your local escrow terms, if available. If the app only has indexed on-chain data,
   exact economics may show as encrypted and you should use the amount expected from the demo defaults.

## Optional Full Lifecycle

After activation, the borrower can later return to `Loans`, select the escrow, and use `Repay In Full`. If repayment is
not made after the due date plus grace period, the lender can use `Check Default`. Those are not required to demonstrate
borrower drawdown and unshielding.

## Common Failure Points

- `Publish Private Offer` blocks with a capital message: go back to `Demo Utils` and complete the role-specific
  prerequisite first.
- `Check shielded cUSDC` reports no handle: use `Shield cUSDC`, complete shielding in Zama Portfolio, then retry.
- `Execute Against Bucket` is disabled: verify both offers are `Executable`, both use the same collateral market, and the
  target bucket is the opposite side.
- `Credit Funding` or `Activate` appears to do nothing: keep the wallet unlocked and check MetaMask activity/pop-up state;
  the UI should also show a notice in `Selected Escrow`.
