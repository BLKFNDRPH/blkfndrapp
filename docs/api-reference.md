# API Reference

## Overview

blkfndr interacts with the Stellar blockchain through two primary APIs:

1. **Soroban RPC** — For smart contract interactions (simulate, send, query)
2. **Horizon API** — For account data, transaction history, and asset information

Additionally, the application exposes **Server Actions** and **REST API endpoints** for client-server communication.

---

## Soroban RPC

**Endpoint**: `https://soroban-testnet.stellar.org`

The Soroban RPC is the primary interface for interacting with smart contracts on Stellar.

### Core Methods

#### `simulateTransaction(transaction)`

Simulate a transaction to validate it and determine resource requirements before submission.

```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

const rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

const simResult = await rpc.simulateTransaction(transaction);

if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log('Simulation successful');
  console.log('CPU instructions:', simResult.cost.cpuInsns);
  console.log('RAM:', simResult.cost.memBytes);
} else {
  console.error('Simulation failed:', simResult.error);
}
```

#### `sendTransaction(transaction)`

Submit a signed transaction to the network.

```typescript
const result = await rpc.sendTransaction(signedTransaction);

switch (result.status) {
  case 'PENDING':
    console.log('Transaction pending:', result.hash);
    break;
  case 'SUCCESS':
    console.log('Transaction succeeded:', result.hash);
    break;
  case 'ERROR':
    console.error('Transaction failed:', result.error);
    break;
}
```

#### `getTransaction(hash)`

Fetch the status and result of a submitted transaction.

```typescript
const tx = await rpc.getTransaction('TX_HASH');

console.log('Status:', tx.status);
console.log('Ledger:', tx.ledger);
console.log('Result:', tx.returnValue);
```

#### `getLedgerEntries(keys)`

Read contract storage entries directly.

```typescript
import { xdr } from '@stellar/stellar-sdk';

const ledgerKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: contractId,
    key: xdr.ScVal.scvSymbol('Projects'),
    durability: xdr.ContractDataDurability.persistent(),
  })
);

const response = await rpc.getLedgerEntries(ledgerKey);
const entries = response.entries;
```

#### `getNetwork()`

Get current network information.

```typescript
const network = await rpc.getNetwork();
console.log('Passphrase:', network.passphrase);
console.log('Protocol version:', network.protocolVersion);
```

---

## Horizon API

**Endpoint**: `https://horizon-testnet.stellar.org`

Horizon provides a RESTful interface for querying Stellar network data.

### Account Operations

#### Get Account Details

```
GET /accounts/{address}
```

```typescript
const response = await fetch(
  `https://horizon-testnet.stellar.org/accounts/${publicKey}`
);
const account = await response.json();

console.log('Balances:', account.balances);
// [
//   { asset_type: 'native', balance: '100.0000000' },
//   { asset_code: 'USDC', asset_issuer: '...', balance: '500.0000000' }
// ]
```

#### Get Account Transactions

```
GET /accounts/{address}/transactions?limit=10&order=desc
```

```typescript
const response = await fetch(
  `https://horizon-testnet.stellar.org/accounts/${publicKey}/transactions?limit=20`
);
const data = await response.json();

for (const tx of data._embedded.records) {
  console.log(tx.hash, tx.created_at, tx.memo);
}
```

#### Get Account Operations

```
GET /accounts/{address}/operations?limit=10
```

```typescript
const response = await fetch(
  `https://horizon-testnet.stellar.org/accounts/${publicKey}/operations?limit=10`
);
const data = await response.json();

for (const op of data._embedded.records) {
  console.log(op.type, op.created_at);
}
```

### Asset Operations

#### List All Assets

```
GET /assets?asset_code=USDC
```

```typescript
const response = await fetch(
  'https://horizon-testnet.stellar.org/assets?asset_code=USDC'
);
const data = await response.json();
```

### Transaction Operations

#### Get Transaction Details

```
GET /transactions/{hash}
```

```typescript
const response = await fetch(
  `https://horizon-testnet.stellar.org/transactions/${txHash}`
);
const tx = await response.json();
```

#### Submit Transaction

```
POST /transactions
Content-Type: application/x-www-form-urlencoded

tx={base64_encoded_transaction_envelope}
```

```typescript
const response = await fetch(
  'https://horizon-testnet.stellar.org/transactions',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${txEnvelope}`,
  }
);
const result = await response.json();
```

---

## Application API

### Server Actions

Server actions are Next.js functions that run on the server but can be called from client components.

#### Notifications

**File**: `src/actions/notifications.ts`

```typescript
// Create a notification
import { createNotification } from '@/actions/notifications';

await createNotification({
  userId: 'user_123',
  type: 'investment_received',
  title: 'New Investment',
  message: 'Your project received 100 XLM from GABC...',
  projectId: 'project_456',
});
```

```typescript
// Mark notification as read
import { markNotificationRead } from '@/actions/notifications';

await markNotificationRead('notification_789');
```

```typescript
// Get user notifications
import { getUserNotifications } from '@/actions/notifications';

const notifications = await getUserNotifications('user_123');
```

### REST API Routes

API routes are defined in `src/app/api/`.

#### Authentication

```
POST /api/auth/[...nextauth]
```

NextAuth.js authentication endpoints for session management.

#### GraphQL (Legacy)

```
POST /api/graphql
```

Legacy GraphQL endpoint for historical blockchain queries. Being replaced by Horizon API calls.

---

## Contract Interaction Patterns

### Reading Data (Query)

```typescript
import { SorobanRpc, Contract, Address } from '@stellar/stellar-sdk';

const rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org');
const contract = new Contract(CONTRACT_ID);

// Build a read-only simulation
const tx = new TransactionBuilder(account, {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(contract.call('get_project', projectId))
  .setTimeout(30)
  .build();

// Simulate (no signing needed for reads)
const simResult = await rpc.simulateTransaction(tx);
const projectData = simResult.result.retval;
```

### Writing Data (Invoke)

```typescript
// 1. Build transaction
const tx = new TransactionBuilder(account, {
  fee: '10000',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    contract.call(
      'fund_project',
      xdr.ScVal.scvU64(projectId),
      xdr.ScVal.scvU64(amount),
      xdr.ScVal.scvSymbol('XLM')
    )
  )
  .setTimeout(30)
  .build();

// 2. Simulate to get footprint
const simResult = await rpc.simulateTransaction(tx);
const preparedTx = SorobanRpc.assembleTransaction(tx, simResult);

// 3. Sign with Freighter
const signedTx = await window.freighter.signTransaction(
  preparedTx.toXDR(),
  { network: 'TESTNET' }
);

// 4. Submit
const txResult = await rpc.sendTransaction(
  TransactionBuilder.fromXDR(signedTx, Networks.TESTNET)
);

// 5. Poll for confirmation
let status = txResult.status;
while (status === 'PENDING') {
  await new Promise(r => setTimeout(r, 1000));
  const updated = await rpc.getTransaction(txResult.hash);
  status = updated.status;
}
```

---

## Error Handling

### Common Soroban RPC Errors

| Error | Cause | Solution |
|---|---|---|
| `INSUFFICIENT_BALANCE` | Account lacks funds for fee | Fund account via Friendbot |
| `SIMULATION_FAILED` | Contract logic error | Check contract error codes |
| `TIMEOUT` | Transaction expired | Increase timeout or resubmit |
| `DUPLICATE` | Transaction already submitted | Check existing transaction status |

### Common Horizon Errors

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — check parameters |
| `404` | Resource not found — check address/hash |
| `429` | Rate limited — implement backoff |
| `500` | Server error — retry with exponential backoff |

### Error Handling Pattern

```typescript
async function safeContractCall<T>(
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error('Contract call failed:', error);
    return fallback;
  }
}

// Usage
const projects = await safeContractCall(
  () => getProjects(),
  []
);
```

---

## Rate Limits & Best Practices

### Soroban RPC
- **Rate limit**: Varies by provider; implement client-side throttling
- **Best practice**: Always simulate before sending to catch errors early
- **Polling**: Use exponential backoff when polling transaction status

### Horizon API
- **Rate limit**: 3600 requests/hour per IP (anonymous); higher with API key
- **Pagination**: Always use cursor-based pagination (`?cursor=&limit=`)
- **Streaming**: Use SSE endpoints for real-time updates where available

### General
- **Batch reads**: Use `getLedgerEntries` for multiple keys instead of individual calls
- **Cache responses**: Cache Horizon data client-side (1-5 minute TTL typical)
- **Error retry**: Implement exponential backoff with jitter for transient failures