# Loan Flow Walkthrough

This is the shortest cold-start path through the demo loan flow using defaults.

## Prerequisites

- Use a browser with the required wallet extension installed and connected to the Ethereum Sepolia network.
- Have enough native testnet gas in the wallets to confirm transactions.
- Use two demo wallets for clarity:
  - **Borrower wallet**: creates the vesting contract/token and publishes the offer bundle.
  - **Lender wallet**: gets confidential USDC from the faucet and funds the loan.
- The borrower and lender can technically be the same wallet, but two wallets make the role switch easier to demonstrate.
- Do not change defaults unless the demo lead asks you to.

## 1. Start As Borrower

1. Open the app from a fresh browser tab.
2. Connect the **borrower wallet** when prompted.
3. If the dragon welcome screen appears, click through the default welcome path:
   - Click **Yes** on the lore prompt.
   - Click **Choose** on the dragon lore popup.
   - Click the dragon/side you want to continue with.
4. In the app, select the **Borrower** role if it is not already selected.

## 2. Create The Borrower Vesting Setup

1. Go to the borrower setup area.
2. Click the control for creating or deploying the **vesting contract**.
3. Leave the vesting defaults unchanged.
4. Confirm the transaction in the borrower wallet.
5. Create or register the **vesting token** using the default token values.
6. Confirm the wallet transaction.
7. Wait until the UI shows that the vesting contract and token are ready.

## 3. Publish The Offer Bundle

1. Stay in the **Borrower** role.
2. Go to the offer or loan request section.
3. Click **Publish Offer Bundle**.
4. Leave the loan terms at their defaults.
5. Confirm the transaction or signature in the borrower wallet.
6. Wait until the UI shows the offer bundle as published or available.

## 4. Switch To Lender

1. Switch the connected wallet account to the **lender wallet**.
2. If the app has a role selector, switch from **Borrower** to **Lender**.
3. Confirm the UI is showing the lender-side view of the published offer.

## 5. Get Confidential USDC

1. In the lender view, open the faucet area.
2. Click the faucet action for **confidential USDC**.
3. Leave the faucet amount at the default.
4. Confirm any wallet prompt.
5. Wait until the confidential USDC balance appears in the lender balance area.

## 6. Fund And Complete The Loan

1. In the lender view, select the borrower’s published offer bundle.
2. Click the default action to fund, accept, or complete the loan.
3. Review the summary without changing defaults.
4. Confirm the wallet transaction.
5. Wait until the UI shows the loan as completed, funded, or active.

At this point the lender has supplied confidential USDC and the borrower-side loan flow is complete.

## 7. Switch Back To Borrower And Unshield USDC

1. Switch the wallet account back to the **borrower wallet**.
2. Switch the app role back to **Borrower** if needed.
3. Open the borrower balances or loan details area.
4. Find the received confidential USDC balance.
5. Click **Unshield USDC**.
6. Leave the unshield amount and recipient defaults unchanged.
7. Confirm the wallet transaction.
8. Wait for the UI to show the public USDC balance updated.

## Things To Watch For

- If a transaction button is disabled, check that the correct wallet and role are selected.
- If balances do not update immediately, wait for indexing or refresh the page.
- If the lender cannot fund the loan, confirm the lender has confidential USDC from the faucet.
- If the borrower cannot unshield, confirm the loan completion step succeeded first.

