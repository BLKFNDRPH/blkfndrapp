# Contribution, Threshold-Release & Attestation Flow

Evidence for the deliverable, as of 2026-10-06. Everything below is on Stellar testnet except the last steps of Project B. Its 7-day voting window closes at **2026-10-13 14:14:52 UTC**, and those transactions are listed under [Still to run](#still-to-run).

## The deliverable

The $5 USDC contribution path into the vault; milestone release gated by an on-chain, contribution-weighted contributor approval threshold enforced entirely by the contract (no multisig, no appointed or chapter-held keys); the permissionless refund path; and an on-chain builder completion attestation emitted when a project closes.

**How the approval model works.** All of it is enforced by contract logic.

- Voting weight is one unit per 1 USDC contributed, recorded at deposit time.
- A single wallet's effective weight is capped at 20% of the raise, whatever it contributed.
- A release needs all three of:
  - more than 50% of the capped weight;
  - at least three distinct approving wallets, or every contributor when fewer than three backed the project;
  - approvers who between them put in more than half the money raised.
- No large contributor can release alone, and no set of small wallets can carry a release over the backers who hold most of the money.
- Each milestone's vote runs for a fixed 7-day window. The window length is set at project creation, and the builder opens each vote.
- If the window closes without carrying, the contract fails closed:
  - the milestone fails;
  - the remaining funds become claimable pro-rata through the refund path;
  - the builder's bond is forfeited to contributors pro-rata.
- Contributor inactivity never strands funds and never pays the builder.

**What the attestation stores.** Builder address, vault address, project ID, outcome (completed, failed with forfeiture, or failed to fund), total raised, bond posted, milestones total and approved, and close timestamp.
- The contract writes it once, into persistent storage keyed by vault and indexed by builder address.
- It is also emitted as an event with the builder as a topic.
- No entrypoint exists to update or delete a record.
- Any Soroban contract can read a builder's history by cross-contract call, and any app or indexer can read the events through Soroban RPC.

**Deployed on Stellar testnet, open source** (MIT, [BLKFNDRPH/blkfndrapp](https://github.com/BLKFNDRPH/blkfndrapp)), **with test transactions** for deposit, threshold approval, milestone release, refund, bond forfeiture and attestation.

### Wording changes from the original text

| Original | Delivered | Why |
|---|---|---|
| "with a more-than-50% approval threshold, release mathematically requires at least three distinct wallets" | Three wallets is an explicit rule, or every contributor when fewer than three backed the project. A majority of the money is required too | The arithmetic argument measures 50% against the whole raise. Measured that way, a project with one or two backers, or a concentrated raise, can never release, and its builder forfeits the bond even when every backer approves. So the bar is measured against the capped total. The wallet rule and the money majority stop that lower bar from letting a few wallets decide |
| "keyed by builder address" | Keyed by vault address, indexed by builder | Project IDs restart in every factory, so only the vault address cannot collide. Reads by builder are unaffected |
| "completed or failed-with-forfeiture" | Also `FailedToFund` | A raise that misses its goal returns the bond. It is recorded, but not as a default |
| "the permissionless refund path" | Anyone can settle a lapsed milestone. Each contributor claims their own refund with their own signature | No builder, admin or platform approval is involved at any step |

## Where to check it

The contracts are [blkfndr-vault](../../contracts/blkfndr-vault/src/lib.rs), [blkfndr-attestation](../../contracts/blkfndr-attestation/src/lib.rs) and [blkfndr-factory](../../contracts/blkfndr-factory/src/lib.rs), deployed as built from commit `5df0bb7`. [smart-contracts.md](../smart-contracts.md) documents every entrypoint.

### Reference deployment

A standalone set, deployed on 2026-10-06 by `GCNNVIOAMIV4AUPFLF7YNX5IVHVUYXJDOI7ETBKL4ILNDSKKHT4A4PJI` with [scripts/deploy-contracts.sh](../../scripts/deploy-contracts.sh). The live app does not use these contracts. Since the 2026-10-07 redeploy it runs its own set built from the same source ([Deployed to testnet](../smart-contracts.md#deployed-to-testnet)).

| Contract | Address |
|---|---|
| Factory | [`CBYDZWQQLVJJZCVLNR4VDXAO42CSQECKYYOL5ONUGYUYS5RYHXEV3ZK6`](https://stellar.expert/explorer/testnet/contract/CBYDZWQQLVJJZCVLNR4VDXAO42CSQECKYYOL5ONUGYUYS5RYHXEV3ZK6) |
| Attestation registry | [`CDKERKLK54FF4Y5OU7NIULEZZHY424OPFZ5FHMYNL24JGZVHLO2PI4UG`](https://stellar.expert/explorer/testnet/contract/CDKERKLK54FF4Y5OU7NIULEZZHY424OPFZ5FHMYNL24JGZVHLO2PI4UG) |
| Identity registry | [`CBOWJT4XKEOA4IAA675FG6K67V3UVN7ESN6M4HPUEQSGRC4EJN2FDTZH`](https://stellar.expert/explorer/testnet/contract/CBOWJT4XKEOA4IAA675FG6K67V3UVN7ESN6M4HPUEQSGRC4EJN2FDTZH) |
| Admin roster | [`CAT4WDHO4SE3OVJIJU6RHNFIMDKHWIJCZCKQFMZ5E7YA32KOPIMH6JXR`](https://stellar.expert/explorer/testnet/contract/CAT4WDHO4SE3OVJIJU6RHNFIMDKHWIJCZCKQFMZ5E7YA32KOPIMH6JXR) |
| Project A vault | [`CBAISZEGETRWTXFW7OXBI37UYX3DMK6WVXDCRBKKJX3TRGLRDCB4UUIW`](https://stellar.expert/explorer/testnet/contract/CBAISZEGETRWTXFW7OXBI37UYX3DMK6WVXDCRBKKJX3TRGLRDCB4UUIW) |
| Project B vault | [`CDMJTHJKT4UNBPU4UMMAPFWKRF2IM7EDCIGJP76GODMX6FIGYBC6WOHL`](https://stellar.expert/explorer/testnet/contract/CDMJTHJKT4UNBPU4UMMAPFWKRF2IM7EDCIGJP76GODMX6FIGYBC6WOHL) |

Each wasm was fetched back from testnet (`stellar contract fetch`) and hashed. Every one matches the local build:

```
blkfndr_vault        e9009410b9cbb4c5bfb7cca747812dcad6a044d09c648a1e392a84fe7e182d95
blkfndr_factory      ab2ad12ea40799d207eb00b63953c09f2a5bfd70273f1e375ca881be7a9f67c6
blkfndr_attestation  66f73252a5b92502ae91ca95f566abff1b042c7537316de44693392e8ef78213
blkfndr_identity     a0574873936f7a8d2a2954dfb2e57c55cdf48e86d5c781725a9f6bc7c625d8d3
blkfndr_admin        00ebfb91b89271e2ae82a5665989d18a4847a2d65846a957147bc2738a6879b3
```

The factory stores the vault hash `e9009410…` and instantiates one vault per project from it.

**Deploy transactions:**
1. Vault wasm upload [`7dd9f3b6…`](https://stellar.expert/explorer/testnet/tx/7dd9f3b674b3594e22d623775da31001a9a74472eb1f595d2c34964131c51f71)
2. Identity [`b747ccd3…`](https://stellar.expert/explorer/testnet/tx/b747ccd3e0baecbb4aca8add9bd4d0cf913bb74c965dca8c15e20a560c54ce15)
3. Admin [`589c742b…`](https://stellar.expert/explorer/testnet/tx/589c742b32b94bb6da1a37bce55b97fd1cd609564d5a8e0d8e819f2b20b72fac)
4. Attestation [`3f4032ef…`](https://stellar.expert/explorer/testnet/tx/3f4032ef3cd68b79f646dd321b4202f80b9bccaa8212ea0c1a00524b27c79c6d)
5. Factory, with its configuration as constructor arguments [`9299a292…`](https://stellar.expert/explorer/testnet/tx/9299a292ad37e8ac432c1586dedfcc6683e0428d91609cac8f01d11fb8ec6331)
6. Attestation registry trusts the factory (`add_factory`) [`f246be81…`](https://stellar.expert/explorer/testnet/tx/f246be81e7be2dec80d1a562fe701e32c57f6876940cf77878a7999911fdac0c)

**Factory parameters**, read back from the chain:

| Parameter | Value |
|---|---|
| Milestone voting window | 604,800 s (7 days) |
| Minimum contribution | 50,000,000 base units (5 USDC) |
| Minimum bond | 500 bps (5% of the goal) |
| Flat platform fee, paid by the builder | 10,000,000 base units (1 USDC) |
| Token | Circle testnet USDC, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

**Accounts** used by the scenario:

| Role | Address |
|---|---|
| Builder | `GBOAWDAGAXHTQYHEPWLBHNVMKBOGZOLUAYONBTSWYTBB6PHF332YSQLO` |
| c1 | `GBEAIIJGLNDJFW5BYDPJ5PY3PRVTVQDCYIKSN6HFHHTXVYX6PKIMYDBS` |
| c2 | `GDNLADXT3FDQFFKJMCKBNP2RD52NI6ATLX6XCY2A76IWKSVDD7KI2SDP` |
| c3 | `GCN5ENFDDKDI7XUDH6JSPP26R4OX4W7ZHJKPEKRJIS3S26K42VONRQHH` |
| c4 | `GAIF3656G2RLIM7YG7JQMG7FAIQCSQ2MHUQEJJHTQKTHS5ZXVYKL7YK4` |
| c5 | `GBO3TOZCHZO67C76F7VSHC3OL4JJH6RYEWMXYWXLDFX5EEC7F6OQBBKY` |
| Unrelated caller | `GAVKTHYK6SNQSALI4YSUP4OAPWPQWRJWHXXSJMBIZ7C6P6FTPEW4JCO3` |

## Claim by claim

Line numbers are for commit `5df0bb7`.

| Claim | Enforced in | Pinned by tests | On testnet |
|---|---|---|---|
| $5 minimum contribution | [`contribute`](../../contracts/blkfndr-vault/src/lib.rs#L679), with the minimum pinned by the factory | `enforces_the_five_dollar_minimum` | A 4.99 USDC deposit is refused, `Error(Contract, #24)` |
| One vote unit per 1 USDC, recorded at deposit | `contribute` stores the balance the vote reads | `voting_weight_is_one_unit_per_unit_contributed` | Project A deposits |
| 20% weight cap | [`weight_cap`](../../contracts/blkfndr-vault/src/lib.rs#L286) | `voting_weight_is_one_unit_per_unit_contributed`, `a_majority_contributor_cannot_release_alone` | c1 put in 10 of 30 USDC and votes with 6 |
| More than 50% of the capped weight | [`carried`](../../contracts/blkfndr-vault/src/lib.rs#L412) | `release_requires_at_least_three_distinct_wallets` | Project A milestone 1: two approvals (11, where more than 13 is needed) refused, `#20` |
| Three distinct wallets, or every contributor | [`required_wallets`](../../contracts/blkfndr-vault/src/lib.rs#L363) | `release_requires_at_least_three_distinct_wallets`, `a_window_short_of_the_wallet_floor_lapses` | The third approval carries milestone 1 |
| A majority of the money | [`stake_majority`](../../contracts/blkfndr-vault/src/lib.rs#L401) | `small_wallets_cannot_outvote_most_of_the_money`, `a_majority_holder_can_block_a_release_but_never_make_one_alone`, `a_unanimous_vote_always_carries` | Project A milestone 2: three 5 USDC wallets clear the weight but hold 15 of 30, not more than half. Refused `#20` until c1 joins |
| No multisig, no appointed keys | [`release_milestone`](../../contracts/blkfndr-vault/src/lib.rs#L934) is callable by anyone. The vault has no admin entrypoint | `release_is_permissionless_once_contributors_have_voted` | Every release was sent by the unrelated caller |
| Fixed 7-day window, set at creation | Factory constructor, copied into the vault by `create_vault`; [`open_milestone_vote`](../../contracts/blkfndr-vault/src/lib.rs#L821) | `votes_are_rejected_before_the_window_opens_and_after_it_closes`, `only_the_builder_opens_a_window_and_only_once` | The factory reads 604,800 s. Project B milestone 2 opened 2026-10-06 14:14:52 UTC |
| Fails closed | [`settle_lapsed_milestone`](../../contracts/blkfndr-vault/src/lib.rs#L1022) | `a_window_that_closes_below_threshold_fails_the_milestone`, `silence_never_releases_funds`, `a_lapsed_window_cannot_be_settled_early` | Settling early refused, `#22`. Settling after the window: [still to run](#still-to-run) |
| Pro-rata refund and bond forfeiture | [`claim_refund`](../../contracts/blkfndr-vault/src/lib.rs#L1167) | `forfeited_bond_is_distributed_pro_rata_with_the_remaining_balance`, `a_backer_claims_once` | [Still to run](#still-to-run) |
| Attestation written once, at close | [`write_attestation`](../../contracts/blkfndr-vault/src/lib.rs#L517) and [`attest`](../../contracts/blkfndr-attestation/src/lib.rs#L238) | `completion_writes_a_permanent_builder_record`, `forfeiture_writes_a_record_against_the_builder`, `a_record_cannot_be_overwritten`, `a_projects_record_is_written_once_and_never_amended` | Project A's closing release [`99e01fee…`](https://stellar.expert/explorer/testnet/tx/99e01fee822412e1c7790ec3d80d7b1d8eedea7b2648efd90d90543125e7bf93) |
| No update or delete entrypoint | The registry's whole on-chain interface: `__constructor`, `add_factory`, `disable_factory`, `transfer_admin`, `attest`, `get_record`, `has_record`, `get_builder_vaults`, `get_builder_history`, `get_builder_summary`, `get_factories`, `get_admin`, `is_factory_trusted` | `a_record_cannot_be_overwritten` | `stellar contract info interface --id CDKERKLK… --network testnet` |
| Emitted as an event, filterable by builder | [`attest`](../../contracts/blkfndr-attestation/src/lib.rs#L315) | `a_record_is_emitted_as_an_event_filterable_by_builder` | `getEvents` filtered on topics `(ATTEST, RECORDED, builder)` returned the event from `99e01fee…` |
| Readable by any contract | [`get_builder_history`](../../contracts/blkfndr-attestation/src/lib.rs#L358), [`get_builder_summary`](../../contracts/blkfndr-attestation/src/lib.rs#L384) | `another_contract_can_gate_on_a_builders_record`: a separate grant-programme contract reads the record by cross-contract call and gates on it | — |

Test suite at `5df0bb7`: 56 vault, 16 attestation, 15 factory, and 181 across the workspace, all passing, with `cargo clippy --workspace --all-targets -- -D warnings` clean.

## Test transactions

[scripts/reference-scenario.sh](../../scripts/reference-scenario.sh) produced every transaction below and checks each result as it goes. The raw log is [transactions.tsv](../../deployments/testnet-reference/transactions.tsv). A refusal is simulated rather than submitted, and the script fails unless the contract refuses with the expected error.

### Setup

The builder and five contributors got Friendbot XLM, a USDC trustline and testnet USDC. The builder was KYC-approved in the reference identity registry, which a vault requires before it can be created.

| Step | Transaction |
|---|---|
| Send 5 USDC to the builder | [`827aa33b…`](https://stellar.expert/explorer/testnet/tx/827aa33b6fd8659e6bf469e549d1d80ec45e1e1c094f38d091bd5db158018b8f) |
| Send 15 USDC to c1 | [`54150e3a…`](https://stellar.expert/explorer/testnet/tx/54150e3a957146caf7828a7650a6b2fe0db1c894581ace0d45eb49cc046b5e02) |
| Send 10 USDC to c2 | [`c96d1d11…`](https://stellar.expert/explorer/testnet/tx/c96d1d11dd6c68faf9865281ccc82235a6fdd5e658bcca5a791fa9dd9aa4f6ae) |
| Send 10 USDC to c3 | [`77c1b2a9…`](https://stellar.expert/explorer/testnet/tx/77c1b2a9734aa842719c911c96c94130a728fb96befb2d0b776027052eaf19a6) |
| Send 10 USDC to c4 | [`e2c45359…`](https://stellar.expert/explorer/testnet/tx/e2c45359b3f1ec380ef09193d968f714779d40be851294e38f634c3ee0a6e4c3) |
| Send 10 USDC to c5 | [`3424fe74…`](https://stellar.expert/explorer/testnet/tx/3424fe749a508a2116c4eb3c0ea7753f163f3e9901f0a973831cfd51ded79153) |
| KYC-approve the builder | [`b104ac7a…`](https://stellar.expert/explorer/testnet/tx/b104ac7a8fe49458b5cdb401b25a660c46ba446611339b46ae7e17f9d55c3006) |

### Project A: completes

Goal 30 USDC in two milestones of 18 and 12, with a 3 USDC bond. c1 puts in 10 USDC and c2–c5 put in 5 each. The cap is 20% of 30, so c1 votes with 6. The capped total is 26, so a release needs more than 13 of weight, three wallets, and approvers holding more than 15 USDC.

| Step | Transaction |
|---|---|
| Create vault, lock 3 USDC bond, pay 1 USDC flat fee | [`ca0f0455…`](https://stellar.expert/explorer/testnet/tx/ca0f0455ba707aacccc5e7737e3452f97583dc1ba7177582a873cc06075e50ca) |
| Deposit of 4.99 USDC | Refused in simulation, `Error(Contract, #24)` BelowMinimumContribution |
| Deposit 10 USDC (c1) | [`15b348b6…`](https://stellar.expert/explorer/testnet/tx/15b348b6abdcdc895948bae12487832d1ac234d38bd8d375b4a92397f90ece60) |
| Deposit 5 USDC (c2) | [`07dbb58b…`](https://stellar.expert/explorer/testnet/tx/07dbb58b7e4255602bd361fcaf65a3532ea3e35c59b0e300e7cc8b6f619c7a84) |
| Deposit 5 USDC (c3) | [`f0cf5d1f…`](https://stellar.expert/explorer/testnet/tx/f0cf5d1fcaad14575549dc477deb5b972b84cb912ed82b641a4add1d8e34813c) |
| Deposit 5 USDC (c4) | [`92f956ea…`](https://stellar.expert/explorer/testnet/tx/92f956ea737849d4ca0c728c822d960c5478aa2011486992a8644b38a21a9fc0) |
| Deposit 5 USDC (c5), goal reached, raise closes | [`3797f538…`](https://stellar.expert/explorer/testnet/tx/3797f5383fd1a7854b79c7e2a9468fc6f5100f0ef1e8c832855510fb1efb87a4) |
| Open milestone 1 vote (builder) | [`031a72fc…`](https://stellar.expert/explorer/testnet/tx/031a72fcec2cc1fbc52ca4b9c94c22b5af61437180b055bdb5dc632244dea82a) |
| Approve milestone 1 (c1, weight 6) | [`52e2e046…`](https://stellar.expert/explorer/testnet/tx/52e2e0468f8bc4e2e47b1f4a7baa4d4bae9885df4de9cb7d6e18c3e9098eba4a) |
| Approve milestone 1 (c2, weight 5) | [`d2f2b00d…`](https://stellar.expert/explorer/testnet/tx/d2f2b00da1a54c67c9a68b1f6684a6909b60997afd7915f7d59423e992ac7add) |
| Release milestone 1 on two approvals (11 of weight, two wallets) | Refused in simulation, `Error(Contract, #20)` ThresholdNotMet |
| Approve milestone 1 (c3, weight 5) | [`0b69770e…`](https://stellar.expert/explorer/testnet/tx/0b69770eb91a37a3bc43eb3921cf588709eaa17629e7910e01481c1154c40c33) |
| Release milestone 1, 18 USDC, sent by the unrelated caller | [`d12da348…`](https://stellar.expert/explorer/testnet/tx/d12da3481af4c52e7aabc18475bee2ceb9d573e335ab9848ffbd01daba579572) |
| Open milestone 2 vote (builder) | [`65e6be7d…`](https://stellar.expert/explorer/testnet/tx/65e6be7d82c599cadb36799504578635ccb2748117c7b7a1c3752be188121eda) |
| Approve milestone 2 (c3, weight 5) | [`c7cafb86…`](https://stellar.expert/explorer/testnet/tx/c7cafb8683dbf3c18e6b7f42b240ca54b196d85871ae951197a3a04b115298c0) |
| Approve milestone 2 (c4, weight 5) | [`62a44f3e…`](https://stellar.expert/explorer/testnet/tx/62a44f3e374d045be6c12c6756837c7753bae6dd5694a23dfad0824c80d9a573) |
| Approve milestone 2 (c5, weight 5) | [`444a8e2c…`](https://stellar.expert/explorer/testnet/tx/444a8e2c073c06fcd34b862d0c252a924f731c88b0b76afae5fec24936565e51) |
| Release milestone 2 on 15 of weight from three wallets, holding 15 of 30 USDC | Refused in simulation, `Error(Contract, #20)` ThresholdNotMet. `get_milestone_stake` reads `(150000000, 150000001)` |
| Approve milestone 2 (c1, weight 6) | [`c014f98a…`](https://stellar.expert/explorer/testnet/tx/c014f98a8e356afc95169fbb8dfff77307dd3f1c30e97f05e3115269be601d20) |
| Release milestone 2, 12 USDC plus the 3 USDC bond, attestation written | [`99e01fee…`](https://stellar.expert/explorer/testnet/tx/99e01fee822412e1c7790ec3d80d7b1d8eedea7b2648efd90d90543125e7bf93) |

The script then checked:
- the vault is `Completed` and holds 0;
- the builder is up 29 USDC (30 raised + 3 bond back − 3 bond − 1 fee).

The registry reads:

```json
{"bond_posted":"30000000","builder":"GBOAWDAGAXHTQYHEPWLBHNVMKBOGZOLUAYONBTSWYTBB6PHF332YSQLO",
 "closed_at":1791295952,"milestones_approved":2,"milestones_total":2,"outcome":0,
 "project_id":1,"total_raised":"300000000","vault":"CBAISZEGETRWTXFW7OXBI37UYX3DMK6WVXDCRBKKJX3TRGLRDCB4UUIW"}
```

`outcome` 0 is `Completed`, and `closed_at` is 2026-10-06 14:12:32 UTC. Soroban RPC `getEvents`, filtered on the topics `(ATTEST, RECORDED, builder)`, returned the event from `99e01fee…` in ledger 5,054,473.

### Project B: fails closed

The same builder. Goal 25 USDC in milestones of 15 and 10, with a 2.5 USDC bond. c1–c5 put in 5 USDC each.

| Step | Transaction |
|---|---|
| Create vault, lock 2.5 USDC bond, pay 1 USDC flat fee | [`58413a7d…`](https://stellar.expert/explorer/testnet/tx/58413a7d8ffed4930a69263d20ea6409967f2b334f1abc1352d632fbbf205b5f) |
| Deposit 5 USDC (c1) | [`64cc04f7…`](https://stellar.expert/explorer/testnet/tx/64cc04f75d12f20b6c4ff26a4dcf08049ccad24d55cd61e419a0eb4a85824eb3) |
| Deposit 5 USDC (c2) | [`a83a4058…`](https://stellar.expert/explorer/testnet/tx/a83a4058fe9aea449bcd8325c67066fd6cd8500a4a917c50076508b17f529e9d) |
| Deposit 5 USDC (c3) | [`fc43fa69…`](https://stellar.expert/explorer/testnet/tx/fc43fa69cb2dd912b4e4d1cd6f33d607fcf12bb1d70b5dc7c0a30b815621392a) |
| Deposit 5 USDC (c4) | [`648917af…`](https://stellar.expert/explorer/testnet/tx/648917aff72505ebf7854e90bafb7efb002e592627094ff9ecd78f3fe74399e2) |
| Deposit 5 USDC (c5), goal reached | [`27697db5…`](https://stellar.expert/explorer/testnet/tx/27697db5972d7b625e844d38312b88cbda0e8b1e84b5792e8dca95a58080dcae) |
| Open milestone 1 vote (builder) | [`544c38d7…`](https://stellar.expert/explorer/testnet/tx/544c38d711195c912c8f39f2624e1bc84d1217ba27234b68e7325f4e7dcf15ea) |
| Approve milestone 1 (c1) | [`aa0e0c7d…`](https://stellar.expert/explorer/testnet/tx/aa0e0c7dd94c5d77e18bebb1f8bb31f7d71f4fa5504dc805a34551c7df16b85a) |
| Approve milestone 1 (c2) | [`a0fc5880…`](https://stellar.expert/explorer/testnet/tx/a0fc58807fb9d76554ba9b2cf4c44d0a14270bca8c795a986c3699b7331f5838) |
| Approve milestone 1 (c3) | [`8d7a3ee4…`](https://stellar.expert/explorer/testnet/tx/8d7a3ee484871b185f8ef903ee4acf16c52d32c8dfc06dfa784dbe73fe26c984) |
| Release milestone 1, 15 USDC, sent by the unrelated caller | [`abc95257…`](https://stellar.expert/explorer/testnet/tx/abc952576abd4a439318eefeebed501210f0ec59a4607ae525b5806bbc81ae9d) |
| Open milestone 2 vote (builder), window until 2026-10-13 14:14:52 UTC | [`335fe37e…`](https://stellar.expert/explorer/testnet/tx/335fe37eee015785d745489f55b562d696e3ce41e74a81334e3a79e001fe6726) |
| Approve milestone 2 (c1 only) | [`2b7cb2d6…`](https://stellar.expert/explorer/testnet/tx/2b7cb2d60601b2f9e11b608f72402840c94c19ed7f422155a753a56fce57c2ff) |
| Settle milestone 2 before its window closes | Refused in simulation, `Error(Contract, #22)` VotingWindowNotElapsed |

### Still to run

After 2026-10-13 14:14:52 UTC:

```bash
bash scripts/reference-scenario.sh project-b-finish
```

It submits and checks:
1. The unrelated caller settles milestone 2. Milestone 2 fails, the bond is slashed, and the registry records `FailedWithForfeiture`, all in one transaction.
2. Each of c1–c5 claims a refund of 2.5 USDC: 5/25 of the 10 USDC left after milestone 1, plus 5/25 of the 2.5 USDC bond. The vault ends at 0.
3. `getEvents` filtered by the builder topic returns the new attestation.
4. The builder's summary reads `(1, 1, 0)`: one completed, one forfeited, none unfunded.

Its transactions will be added here.

## Rerun it

```bash
bash scripts/build-contracts.sh
cargo test --workspace
bash scripts/deploy-contracts.sh --network testnet --source <identity> \
  --platform-fee 10000000 --out deployments/testnet-reference/contracts.env
bash scripts/reference-scenario.sh setup --funder <identity holding testnet USDC> --deployer <identity>
bash scripts/reference-scenario.sh project-a
bash scripts/reference-scenario.sh project-b-start
# seven days later
bash scripts/reference-scenario.sh project-b-finish
```

A rerun deploys new contracts and writes over the files in `deployments/testnet-reference/`, so run it in a fresh clone. The wasm hash depends on the build machine's cargo-registry path, so compare a deployed contract against a build made on the same paths, or against the hash the chain reports.

## Limits worth knowing

- **Event retention.** Soroban RPC keeps events for about a week. The record in contract storage is the permanent copy. History older than that comes from the registry's reads or from an indexer or archive that kept the events.
- **Storage rent.** Records live in persistent storage with a ~30-day TTL, extended when written. An entry left idle past its TTL is archived, not deleted. Anyone can restore it, unchanged.
- **Wallets, not people.** Contributors are not identity-gated, so the cap and the three-wallet rule count addresses. The money majority is what makes splitting a stake across wallets useless for carrying a release.
- **Production.** The app runs the same contracts as this reference deployment. Its factory differs only in starting its project ids at 12.
  - **Vault code:** since 2026-10-06 the app's factory has deployed this vault, `e9009410…`. The switch was [`9dd7ed93…`](https://stellar.expert/explorer/testnet/tx/9dd7ed938ad0ef0db7e357cc6567e70c1620abb296a7baa301932888d7a13508), made once the host's vote panel showed the money condition.
  - **Registries:** since 2026-10-07 the app uses a freshly deployed factory, attestation registry and identity registry built from this source ([the registry redeploy](../smart-contracts.md#the-registry-redeploy)).
  - **Older projects:** projects #1–#11 keep the older vault and registries they were created with.
