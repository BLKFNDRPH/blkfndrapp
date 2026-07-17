# Smart Contracts

## Overview

blkfndr uses **Soroban** smart contracts written in **Rust** and compiled to **WASM** for execution on the Stellar blockchain. The contract suite consists of a core `crowdfunding` contract and a set of token bridge contracts for multi-currency support.

## Network

All contracts are deployed on **Stellar Testnet**.

## Contract Suite

### 1. Crowdfunding Contract (`crowdfunding`)

The core platform contract managing the full lifecycle of crowdfunding campaigns.

**Contract ID**: `[DEPLOYED_CONTRACT_ID]`

#### Data Structures

##### Project

```rust
struct Project {
    id: u64,                    // Auto-incrementing project ID
    title: String,              // Project title
    tagline: String,            // Short tagline
    description: String,        // Full description
    category: String,           // Project category
    goal: u64,                  // Funding goal (in smallest unit)
    blob_id: String,            // IPFS hash of project metadata/image
    creator: Address,           // Creator's Stellar address
    status: ProjectStatus,      // Current status (see enum below)
    raised_amount: u64,         // Total amount raised
    currency_type: CurrencyType,// XLM, USDC, USDT, WBTC, or WETH
    created_at: u64,            // Creation timestamp
    funding_deadline: u64,      // Deadline timestamp for funding
    has_pending_withdrawal: bool, // Whether a withdrawal is pending
}
```

##### ProjectStatus

```rust
enum ProjectStatus {
    Hidden,      // Not publicly visible
    Pending,     // Awaiting admin review
    Rejected,    // Rejected by admin
    Approved,    // Approved and accepting funding
    Funded,      // Funding goal reached
    Completed,   // Funds claimed by creator
    Expired,     // Funding deadline passed without reaching goal
}
```

##### Platform

```rust
struct Platform {
    admin: Address,                  // Primary admin address
    multi_sig_admins: Vec<Address>,  // Multi-sig admin list
    fee_wallet_address: Address,     // Fee collection wallet
    fee_percentage: u64,             // Platform fee in basis points (e.g., 300 = 3%)
    total_fees_collected: u64,       // Lifetime fees collected
}
```

##### InvestmentReceipt (SBT)

```rust
struct InvestmentReceipt {
    investment_id: u64,     // Unique investment ID
    investor: Address,      // Investor's Stellar address
    project_id: u64,        // Funded project ID
    amount: u64,            // Investment amount
    share_percentage: u64,  // Investor's share of total raised
    fee_paid: u64,          // Platform fee paid
    investment_date: u64,   // Timestamp of investment
}
```

##### AdminProposal

```rust
struct AdminProposal {
    proposal_id: u64,       // Unique proposal ID
    proposer: Address,      // Admin who created the proposal
    project_id: u64,        // Target project (for withdrawals)
    amount: u64,            // Proposed amount
    approvals: Vec<Address>,// Admins who have approved
    executed: bool,         // Whether proposal has been executed
}
```

#### Contract Functions

##### Project Management

| Function                                                                                        | Access | Description                                            |
| ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `create_project(title, tagline, description, category, goal, blob_id, currency_type, deadline)` | Public | Create a new project listing. Status set to `Pending`. |
| `approve_project(project_id)`                                                                   | Admin  | Approve a pending project. Status → `Approved`.        |
| `reject_project(project_id)`                                                                    | Admin  | Reject a pending project. Status → `Rejected`.         |
| `update_project_status(project_id, new_status)`                                                 | Admin  | Update project status manually.                        |

##### Funding

| Function                                          | Access  | Description                                                                                                                                                    |
| ------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fund_project(project_id, amount, currency_type)` | Public  | Fund an approved project. Transfers tokens, mints SBT receipt.                                                                                                 |
| `claim_funds(project_id)`                         | Creator | Claim raised funds after project is fully funded. Status → `Completed`.                                                                                        |
| `refund_investor(project_id, investor)`           | Public  | Refund investor if project expires without reaching goal. Returns **contribution + platform fee** for that project's receipts and burns the investment SBT(s). |

##### Admin Governance

| Function                                 | Access          | Description                                          |
| ---------------------------------------- | --------------- | ---------------------------------------------------- |
| `propose_withdrawal(project_id, amount)` | Multi-sig Admin | Create a withdrawal proposal for a funded project.   |
| `vote_withdrawal(proposal_id)`           | Multi-sig Admin | Vote to approve a withdrawal proposal.               |
| `execute_withdrawal(proposal_id)`        | Multi-sig Admin | Execute withdrawal after threshold of approvals met. |
| `update_fee(new_fee_bps)`                | Admin           | Update platform fee percentage (max 1000 bps = 10%). |
| `add_multi_sig_admin(address)`           | Admin           | Add a new multi-sig admin.                           |
| `remove_multi_sig_admin(address)`        | Admin           | Remove a multi-sig admin.                            |
| `transfer_admin(new_admin)`              | Admin           | Transfer primary admin role.                         |

##### Queries (Read-Only)

| Function                                | Description                         |
| --------------------------------------- | ----------------------------------- |
| `get_project(project_id)`               | Get full project details.           |
| `get_all_projects()`                    | List all projects.                  |
| `get_projects_by_status(status)`        | Filter projects by status.          |
| `get_platform_info()`                   | Get platform configuration.         |
| `get_investment_receipt(investment_id)` | Get investment receipt details.     |
| `get_user_investments(address)`         | Get all investments for an address. |
| `get_pending_proposals()`               | List all pending admin proposals.   |

#### Error Codes

| Code | Name                    | Description                             |
| ---- | ----------------------- | --------------------------------------- |
| 0    | `NotAdmin`              | Caller is not the platform admin        |
| 1    | `NotMultiSig`           | Caller is not a multi-sig admin         |
| 3    | `ProjectNotApproved`    | Project is not in approved status       |
| 4    | `InsufficientFunds`     | Investor has insufficient balance       |
| 5    | `GoalAlreadyReached`    | Project funding goal already met        |
| 6    | `InvalidPercentage`     | Fee percentage out of valid range       |
| 7    | `NotProjectCreator`     | Caller is not the project creator       |
| 8    | `ProjectNotFunded`      | Project has not reached funding goal    |
| 9    | `InvalidStatus`         | Invalid project status transition       |
| 10   | `InvalidCurrency`       | Unsupported currency type               |
| 11   | `ProjectHasFunds`       | Cannot modify project with active funds |
| 12   | `ProjectAlreadyFunded`  | Project already fully funded            |
| 13   | `NotAuthorized`         | General authorization failure           |
| 14   | `AlreadyVoted`          | Admin already voted on this proposal    |
| 15   | `InsufficientApprovals` | Not enough multi-sig approvals          |
| 16   | `FundingDeadlinePassed` | Project funding deadline has expired    |
| 17   | `ProjectMismatch`       | Project ID mismatch in operation        |
| 18   | `NoFundsToRefund`       | No funds available for refund           |
| 19   | `ProposalAlreadyExists` | Duplicate proposal                      |
| 20   | `IncorrectFee`          | Fee amount does not match platform fee  |
| 21   | `InvalidFee`            | Fee exceeds maximum (1000 bps)          |

#### Constants

| Constant             | Value | Description                |
| -------------------- | ----- | -------------------------- |
| `BASIS_POINTS`       | 10000 | Basis points per 100%      |
| `MAX_FEE_PERCENTAGE` | 1000  | Maximum platform fee (10%) |

---

### 2. Bridge Contracts (`bridge/`)

Token wrapper contracts enabling multi-currency support on the platform.

#### Supported Assets

| Asset    | Contract                   | Description              |
| -------- | -------------------------- | ------------------------ |
| **USDC** | `bridge/sources/usdc.move` | USD Coin wrapper         |
| **USDT** | `bridge/sources/usdt.move` | Tether USD wrapper       |
| **WBTC** | `bridge/sources/wbtc.move` | Wrapped Bitcoin wrapper  |
| **WETH** | `bridge/sources/weth.move` | Wrapped Ethereum wrapper |

#### Bridge Functions (per token)

| Function              | Description                                      |
| --------------------- | ------------------------------------------------ |
| `mint(amount)`        | Mint wrapped tokens (1:1 backed by native asset) |
| `burn(amount)`        | Burn wrapped tokens to release native asset      |
| `balance_of(address)` | Get token balance for an address                 |
| `total_supply()`      | Get total circulating supply                     |

#### Native Asset

**XLM** (Stellar Lumens) is used natively and does not require a bridge contract.

---

## Currency Types & Decimals

| Currency | Decimals | Smallest Unit |
| -------- | -------- | ------------- |
| XLM      | 7        | Stroop        |
| USDC     | 7        | Micro-USDC    |
| USDT     | 7        | Micro-USDT    |
| WBTC     | 7        | Micro-WBTC    |
| WETH     | 7        | Micro-WETH    |

> **Note**: Stellar uses 7 decimal places for all assets by default. Amounts in contract calls should be expressed in the smallest unit (e.g., 1 XLM = 10,000,000 stroops).

---

## Transaction Flow

### Building & Submitting Transactions

```typescript
// 1. Build the contract invocation
const tx = new TransactionBuilder(account, {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(contract.call("fund_project", ...args))
  .setTimeout(30)
  .build();

// 2. Simulate to validate and get footprint
const simResult = await rpc.simulateTransaction(tx);

// 3. Sign with Freighter wallet
const signedTx = await freighter.signTransaction(tx);

// 4. Submit to network
const result = await rpc.sendTransaction(signedTx);

// 5. Wait for confirmation
if (result.status === "SUCCESS") {
  console.log("Transaction confirmed:", result.hash);
}
```

### Reading Contract State

```typescript
// Query contract storage via Soroban RPC
const response = await rpc.getLedgerEntries(contractKey);
const projectData = response.entries[0].value;
```

---

## Deployment

### Prerequisites

1. Stellar account with testnet XLM (from Friendbot)
2. Soroban CLI installed
3. Rust toolchain with `wasm32-unknown-unknown` target

### Build & Deploy

```bash
# Build the contract
soroban contract build

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/crowdfunding.wasm \
  --source <ADMIN_SECRET_KEY> \
  --network testnet

# Initialize the contract
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_PUBLIC_KEY> \
  --fee_wallet <FEE_WALLET_PUBLIC_KEY> \
  --fee_percentage 300
```

### Upgrade Process

Soroban contracts are immutable once deployed. To upgrade:

1. Deploy new contract version
2. Migrate state from old contract to new contract
3. Update frontend with new contract ID
4. Deprecate old contract (prevent new interactions)

---

## Security Considerations

- **Multi-sig Governance**: All admin actions (fee changes, withdrawals) require multiple admin approvals
- **Fee Caps**: Platform fee is hard-capped at 10% (1000 basis points)
- **Status Guards**: Strict status transition validation prevents invalid state changes
- **Deadline Enforcement**: Funding deadlines are enforced at the contract level
- **SBT Receipts**: Investment receipts are non-transferable, preventing secondary market manipulation
- **Balance Checks**: All funding operations verify sufficient balances before execution
