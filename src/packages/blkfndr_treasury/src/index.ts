import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"NotAuthorized"},
  10: {message:"AlreadyInitialized"},
  11: {message:"NotInitialized"},
  20: {message:"NotAShareholder"},
  21: {message:"SharesMustTotalBps"},
  22: {message:"TooManyShareholders"},
  23: {message:"DuplicateShareholder"},
  24: {message:"ZeroShare"},
  30: {message:"NoCycleOpen"},
  31: {message:"CycleAlreadyOpen"},
  32: {message:"NothingToRelease"},
  33: {message:"AlreadyVoted"},
  34: {message:"VotingClosed"},
  35: {message:"ThresholdNotMet"},
  36: {message:"ThresholdAlreadyMet"},
  37: {message:"NotPayable"},
  38: {message:"AlreadyClaimed"},
  39: {message:"ReleaseTooSoon"},
  40: {message:"NoProposalOpen"},
  41: {message:"ProposalAlreadyOpen"},
  42: {message:"FeeOutOfRange"},
  43: {message:"OpsFundingNotSet"}
}


export interface Shareholder {
  address: string;
  /**
 * Basis points of every release. All shares must total exactly 10 000.
 */
share_bps: u32;
}

export enum CycleState {
  Voting = 0,
  Payable = 1,
  Lapsed = 2,
}


export interface Cycle {
  /**
 * The contract's balance of `token` when the cycle opened. Fees arriving
 * afterwards belong to the next cycle, so a vote settles a fixed sum
 * rather than a moving one.
 */
amount: i128;
  /**
 * How many owners have approved. The rule is two-to-one by headcount, so
 * this is the number that decides, not the share weight beside it.
 */
approvals: u32;
  closes_at: u64;
  id: u32;
  opened_at: u64;
  /**
 * The register as it stood at open. A cycle pays what was agreed when it
 * started, whatever the register does later.
 */
roster: Array<Shareholder>;
  state: CycleState;
  token: string;
}

/**
 * What a carried proposal does.
 * 
 * An enum rather than a fee-only entrypoint, because this contract can be the
 * factory's admin and the factory has eight admin-gated functions. Reaching
 * only one of them would strand the other seven — including `update_wasm_hash`,
 * which is how vaults are upgraded, and `transfer_admin`, which is the only
 * way to hand control back. A treasury that can take factory admin but never
 * return it is a trap, so `TransferAdmin` is here from the start.
 */
export type GovernedAction = {tag: "SetFee", values: readonly [i128]} | {tag: "TransferAdmin", values: readonly [string]} | {tag: "SetShareholders", values: readonly [Array<Shareholder>]} | {tag: "SetBondBps", values: readonly [u64]} | {tag: "SetWasmHash", values: readonly [Buffer]} | {tag: "SetFeeWallet", values: readonly [string]} | {tag: "SetIdentityRegistry", values: readonly [string]} | {tag: "SetVotingWindow", values: readonly [u64]} | {tag: "SetMinContribution", values: readonly [i128]} | {tag: "SetOwners", values: readonly [Array<string>]} | {tag: "SetOpsFunding", values: readonly [OpsFundingTerms]};


export interface Proposal {
  action: GovernedAction;
  approvals: u32;
  closes_at: u64;
  id: u32;
  opened_at: u64;
  roster: Array<Shareholder>;
}


/**
 * How the treasury funds operations gas: where it goes, which asset it routes
 * (the native token — XLM), and the monthly cut in basis points.
 */
export interface OpsFundingTerms {
  /**
 * Basis points of the unreserved balance, moved every thirty days.
 */
bps: u32;
  token: string;
  vault: string;
}

export type DataKey = {tag: "Factory", values: void} | {tag: "Shareholders", values: void} | {tag: "VoteWindow", values: void} | {tag: "NextCycleId", values: void} | {tag: "Cycle", values: readonly [u32]} | {tag: "OpenCycleId", values: void} | {tag: "Reserved", values: readonly [string]} | {tag: "ClaimCount", values: readonly [u32]} | {tag: "LastReleaseAt", values: void} | {tag: "CycleVote", values: readonly [u32, string]} | {tag: "Claimed", values: readonly [u32, string]} | {tag: "Proposal", values: void} | {tag: "NextProposalId", values: void} | {tag: "ProposalVote", values: readonly [u32, string]} | {tag: "OpsFunding", values: void} | {tag: "LastOpsFundingAt", values: void};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Configure the treasury. `factory` is the contract whose fee this
   * treasury may change; it must set this contract as its admin for that to
   * work, which is a separate deliberate act.
   * 
   * `deployer` must sign. Without that signature this is a land grab: a
   * treasury sitting deployed and unconfigured for even one ledger can be
   * claimed by whoever calls this first, naming themselves the entire
   * register. Deploy and initialize are separate transactions, so that
   * window is real rather than theoretical.
   */
  initialize: ({deployer, factory, shareholders}: {deployer: string, factory: string, shareholders: Array<Shareholder>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a open_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open a cycle over the treasury's *unreserved* balance of `token`.
   * 
   * Any shareholder may open one. There is no privileged proposer, because a
   * proposer who could refuse to act would be able to withhold everyone
   * else's earnings indefinitely.
   * 
   * Only a cycle still being voted on blocks a new one. A payable cycle does
   * not: its money is reserved, so a later cycle cannot reach it, and there
   * is no reason to make everyone wait for the last shareholder to get round
   * to claiming. An earlier design blocked on payable and deadlocked the
   * contract the moment a cycle was fully claimed — the state stayed payable
   * forever and no further cycle could ever open.
   */
  open_cycle: ({opener, token}: {opener: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve the open cycle. One vote per shareholder, weighted by share.
   */
  approve_cycle: ({voter}: {voter: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a settle_lapsed_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mark a cycle that closed below threshold as lapsed.
   * 
   * Permissionless, and it pays nobody. Nothing was reserved, so the balance
   * simply stays here and is picked up by the next cycle: an unfinished vote
   * delays a payout rather than destroying it.
   */
  settle_lapsed_cycle: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim your share of a payable cycle.
   * 
   * Named by cycle id, because several may be payable at once: a shareholder
   * who is slow to claim never blocks the next cycle, and never loses what
   * they are owed from an earlier one.
   * 
   * Pulled rather than pushed, so one recipient that cannot receive the token
   * cannot strand everyone else's money behind their problem.
   */
  claim: ({shareholder, cycle_id}: {shareholder: string, cycle_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a propose transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a governed action: the listing fee, factory admin, or the
   * shareholder register.
   * 
   * The fee stays a flat amount. SOW v4 states a flat-fee model three times
   * and frames it as a Philippine SEC/BSP constraint — "BLKFNDR charges flat
   * fees, never takes a percentage of funds" — so what a vote adjusts is the
   * amount, not the shape.
   */
  propose: ({proposer, action}: {proposer: string, action: GovernedAction}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve_proposal: ({voter}: {voter: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a execute_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a carried proposal to the factory.
   * 
   * Permissionless once the vote has carried: execution should not depend on
   * the goodwill of whoever proposed it. This contract must be the factory's
   * admin for the call to authorise.
   */
  execute_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a fund_operations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Move this month's operations funding to the Operations Vault.
   * 
   * Permissionless and time-gated: anyone may trigger it — the indexer cron
   * does — but only once every thirty days, so no caller can drain the cut by
   * calling in a loop. It moves a set percentage of the *unreserved* balance
   * of the configured asset, never a shareholder's owed money, and only while
   * no cycle is mid-vote — a cycle has already snapshotted the balance it will
   * pay, and moving money out from under that snapshot could leave the treasury
   * unable to honour it.
   * 
   * The owners set the vault, asset and percentage once, by vote
   * (SetOpsFunding); after that this needs no further approval, which is the
   * point — the gas budget refills itself.
   */
  fund_operations: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a next_release_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * When the next cycle may open. Zero if none has ever carried.
   */
  next_release_at: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_shareholders transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_shareholders: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Shareholder>>>

  /**
   * Construct and simulate a get_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_cycle: ({cycle_id}: {cycle_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Cycle>>>

  /**
   * Construct and simulate a get_open_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The cycle currently being voted on, if any.
   */
  get_open_cycle: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Cycle>>>

  /**
   * Construct and simulate a get_reserved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What is still owed to shareholders of payable cycles, and so cannot be
   * taken by a new one.
   */
  get_reserved: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_available transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What a cycle opened right now would settle.
   */
  get_available: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Proposal>>>

  /**
   * Construct and simulate a get_factory transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_factory: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a has_claimed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_claimed: ({cycle_id, shareholder}: {cycle_id: u32, shareholder: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a balance_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance_of: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_ops_funding transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The operations funding terms, if the owners have set them.
   */
  get_ops_funding: (options?: MethodOptions) => Promise<AssembledTransaction<Option<OpsFundingTerms>>>

  /**
   * Construct and simulate a next_ops_funding_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * When operations funding may next run. Zero if it has never run — the first
   * call is allowed the moment funding is configured.
   */
  next_ops_funding_at: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a ops_funding_available transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What the next funding run would move: bps of the unreserved balance of the
   * configured asset. Zero if funding is not configured.
   */
  ops_funding_available: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAAD05vdEFTaGFyZWhvbGRlcgAAAAAUAAAAAAAAABJTaGFyZXNNdXN0VG90YWxCcHMAAAAAABUAAAAAAAAAE1Rvb01hbnlTaGFyZWhvbGRlcnMAAAAAFgAAAAAAAAAURHVwbGljYXRlU2hhcmVob2xkZXIAAAAXAAAAAAAAAAlaZXJvU2hhcmUAAAAAAAAYAAAAAAAAAAtOb0N5Y2xlT3BlbgAAAAAeAAAAAAAAABBDeWNsZUFscmVhZHlPcGVuAAAAHwAAAAAAAAAQTm90aGluZ1RvUmVsZWFzZQAAACAAAAAAAAAADEFscmVhZHlWb3RlZAAAACEAAAAAAAAADFZvdGluZ0Nsb3NlZAAAACIAAAAAAAAAD1RocmVzaG9sZE5vdE1ldAAAAAAjAAAAAAAAABNUaHJlc2hvbGRBbHJlYWR5TWV0AAAAACQAAAAAAAAACk5vdFBheWFibGUAAAAAACUAAAAAAAAADkFscmVhZHlDbGFpbWVkAAAAAAAmAAAAAAAAAA5SZWxlYXNlVG9vU29vbgAAAAAAJwAAAAAAAAAOTm9Qcm9wb3NhbE9wZW4AAAAAACgAAAAAAAAAE1Byb3Bvc2FsQWxyZWFkeU9wZW4AAAAAKQAAAAAAAAANRmVlT3V0T2ZSYW5nZQAAAAAAACoAAAAAAAAAEE9wc0Z1bmRpbmdOb3RTZXQAAAAr",
        "AAAAAQAAAAAAAAAAAAAAC1NoYXJlaG9sZGVyAAAAAAIAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAERCYXNpcyBwb2ludHMgb2YgZXZlcnkgcmVsZWFzZS4gQWxsIHNoYXJlcyBtdXN0IHRvdGFsIGV4YWN0bHkgMTAgMDAwLgAAAAlzaGFyZV9icHMAAAAAAAAE",
        "AAAAAwAAAAAAAAAAAAAACkN5Y2xlU3RhdGUAAAAAAAMAAAAQT3BlbiBmb3Igdm90aW5nLgAAAAZWb3RpbmcAAAAAAAAAAAAqVGhyZXNob2xkIGNhcnJpZWQ7IHNoYXJlaG9sZGVycyBtYXkgY2xhaW0uAAAAAAAHUGF5YWJsZQAAAAABAAAAa1RoZSB3aW5kb3cgY2xvc2VkIHNob3J0LiBOb3RoaW5nIGlzIHBhaWQ7IHRoZSBiYWxhbmNlIHJvbGxzIGludG8gdGhlCm5leHQgY3ljbGUgcmF0aGVyIHRoYW4gYmVpbmcgc3RyYW5kZWQuAAAAAAZMYXBzZWQAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAABUN5Y2xlAAAAAAAACAAAAKNUaGUgY29udHJhY3QncyBiYWxhbmNlIG9mIGB0b2tlbmAgd2hlbiB0aGUgY3ljbGUgb3BlbmVkLiBGZWVzIGFycml2aW5nCmFmdGVyd2FyZHMgYmVsb25nIHRvIHRoZSBuZXh0IGN5Y2xlLCBzbyBhIHZvdGUgc2V0dGxlcyBhIGZpeGVkIHN1bQpyYXRoZXIgdGhhbiBhIG1vdmluZyBvbmUuAAAAAAZhbW91bnQAAAAAAAsAAACHSG93IG1hbnkgb3duZXJzIGhhdmUgYXBwcm92ZWQuIFRoZSBydWxlIGlzIHR3by10by1vbmUgYnkgaGVhZGNvdW50LCBzbwp0aGlzIGlzIHRoZSBudW1iZXIgdGhhdCBkZWNpZGVzLCBub3QgdGhlIHNoYXJlIHdlaWdodCBiZXNpZGUgaXQuAAAAAAlhcHByb3ZhbHMAAAAAAAAEAAAAAAAAAAljbG9zZXNfYXQAAAAAAAAGAAAAAAAAAAJpZAAAAAAABAAAAAAAAAAJb3BlbmVkX2F0AAAAAAAABgAAAHFUaGUgcmVnaXN0ZXIgYXMgaXQgc3Rvb2QgYXQgb3Blbi4gQSBjeWNsZSBwYXlzIHdoYXQgd2FzIGFncmVlZCB3aGVuIGl0CnN0YXJ0ZWQsIHdoYXRldmVyIHRoZSByZWdpc3RlciBkb2VzIGxhdGVyLgAAAAAAAAZyb3N0ZXIAAAAAA+oAAAfQAAAAC1NoYXJlaG9sZGVyAAAAAAAAAAAFc3RhdGUAAAAAAAfQAAAACkN5Y2xlU3RhdGUAAAAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAgAAAdlXaGF0IGEgY2FycmllZCBwcm9wb3NhbCBkb2VzLgoKQW4gZW51bSByYXRoZXIgdGhhbiBhIGZlZS1vbmx5IGVudHJ5cG9pbnQsIGJlY2F1c2UgdGhpcyBjb250cmFjdCBjYW4gYmUgdGhlCmZhY3RvcnkncyBhZG1pbiBhbmQgdGhlIGZhY3RvcnkgaGFzIGVpZ2h0IGFkbWluLWdhdGVkIGZ1bmN0aW9ucy4gUmVhY2hpbmcKb25seSBvbmUgb2YgdGhlbSB3b3VsZCBzdHJhbmQgdGhlIG90aGVyIHNldmVuIOKAlCBpbmNsdWRpbmcgYHVwZGF0ZV93YXNtX2hhc2hgLAp3aGljaCBpcyBob3cgdmF1bHRzIGFyZSB1cGdyYWRlZCwgYW5kIGB0cmFuc2Zlcl9hZG1pbmAsIHdoaWNoIGlzIHRoZSBvbmx5CndheSB0byBoYW5kIGNvbnRyb2wgYmFjay4gQSB0cmVhc3VyeSB0aGF0IGNhbiB0YWtlIGZhY3RvcnkgYWRtaW4gYnV0IG5ldmVyCnJldHVybiBpdCBpcyBhIHRyYXAsIHNvIGBUcmFuc2ZlckFkbWluYCBpcyBoZXJlIGZyb20gdGhlIHN0YXJ0LgAAAAAAAAAAAAAOR292ZXJuZWRBY3Rpb24AAAAAAAsAAAABAAAAKENoYW5nZSB0aGUgZmxhdCBsaXN0aW5nIGZlZSwgaW4gc3Ryb29wcy4AAAAGU2V0RmVlAAAAAAABAAAACwAAAAEAAAC1SGFuZCBmYWN0b3J5IGFkbWluIHRvIHNvbWVvbmUgZWxzZSDigJQgdGhlIGVzY2FwZSBoYXRjaC4gQSB2b3RlIGNhbiBhbHdheXMKcmV0dXJuIGNvbnRyb2wgdG8gYSBodW1hbiwgc28gcG9pbnRpbmcgZmFjdG9yeSBhZG1pbiBhdCB0aGlzIGNvbnRyYWN0IGlzCnJldmVyc2libGUgcmF0aGVyIHRoYW4gcGVybWFuZW50LgAAAAAAAA1UcmFuc2ZlckFkbWluAAAAAAAAAQAAABMAAAABAAACUFJlcGxhY2UgdGhlIHNoYXJlaG9sZGVyIHJlZ2lzdGVyLgoKVGhpcyBpcyBoZXJlLCBiZWhpbmQgYSB2b3RlLCBiZWNhdXNlIHRoZSBhbHRlcm5hdGl2ZSB3YXMgY2F0YXN0cm9waGljLgpgc2V0X3NoYXJlaG9sZGVyc2AgdXNlZCB0byBuZWVkIG9uZSBzaGFyZWhvbGRlcidzIHNpZ25hdHVyZSBhbmQgbm8gdm90ZSwKd2hpY2ggbWFkZSB0aGUgcmVnaXN0ZXIgdGhlIGRyYWluOiB0aGUgKnNtYWxsZXN0KiBob2xkZXIgY291bGQgcmV3cml0ZSBpdAp0byBuYW1lIHRoZW1zZWx2ZXMgYXQgMTAwJSwgb3BlbiBhIGN5Y2xlLCBjYXJyeSBpdCBhbG9uZSwgYW5kIGNsYWltIHRoZQpsb3QuIFRocmVlIHRyYW5zYWN0aW9ucywgb25lIGtleSwgYW5kIHRoZSBvdGhlciBwYXJ0bmVycyBnZXQgbm90aGluZy4KCkV2ZXJ5dGhpbmcgZWxzZSBpbiB0aGlzIGNvbnRyYWN0IHdhcyBjYXJlZnVsbHkgdm90ZS1nYXRlZCwgc28gdGhlIHJlZ2lzdGVyCmJlaW5nIGEgc2luZ2xlLXNpZ25hdHVyZSB3cml0ZSBtZWFudCB0aGUgd2hvbGUgZGVzaWduIGNvdWxkIGJlIGJ5cGFzc2VkIGJ5CmNoYW5naW5nIHdobyAiZXZlcnlvbmUiIGlzIGJlZm9yZSBhc2tpbmcgdGhlbS4AAAAPU2V0U2hhcmVob2xkZXJzAAAAAAEAAAPqAAAH0AAAAAtTaGFyZWhvbGRlcgAAAAABAAABfkNoYW5nZSB0aGUgcGVyZm9ybWFuY2UgYm9uZCwgaW4gYmFzaXMgcG9pbnRzIG9mIHRoZSByYWlzZS4KClRoZSBib25kIGlzIHdoYXQgYSBidWlsZGVyIGZvcmZlaXRzIGJ5IG1pc3NpbmcgYSBtaWxlc3RvbmUsIHNvIGl0IGlzIHRoZQpudW1iZXIgdGhhdCBkZWNpZGVzIGhvdyBtdWNoIGEgcHJvbWlzZSBjb3N0cyB0byBicmVhay4gUmFpc2luZyBpdCBtYWtlcwpsaXN0aW5nIG1vcmUgZXhwZW5zaXZlIGFuZCBmYWlsdXJlIG1vcmUgcGFpbmZ1bDsgbG93ZXJpbmcgaXQgZG9lcyB0aGUKcmV2ZXJzZS4gRWl0aGVyIGRpcmVjdGlvbiBpcyBhIHBvbGljeSBjaGFuZ2UsIHdoaWNoIGlzIHdoeSBpdCBpcyBoZXJlCnJhdGhlciB0aGFuIG9uIG9uZSBhZG1pbidzIHNpZ25hdHVyZS4AAAAAAApTZXRCb25kQnBzAAAAAAABAAAABgAAAAEAAAFQUG9pbnQgbmV3IHZhdWx0cyBhdCBhIGRpZmZlcmVudCB3YXNtIOKAlCBob3cgdGhlIHZhdWx0IGNvbnRyYWN0IGlzIHVwZ3JhZGVkLgoKVGhlIG1vc3QgcG93ZXJmdWwgYWN0aW9uIGluIHRoaXMgZW51bSBieSBzb21lIGRpc3RhbmNlOiBpdCBkZWNpZGVzIHRoZQpjb2RlIGV2ZXJ5IGZ1dHVyZSB2YXVsdCBydW5zLiBFeGlzdGluZyB2YXVsdHMga2VlcCB0aGUgY29kZSB0aGV5IHdlcmUKZGVwbG95ZWQgd2l0aCwgc28gdGhpcyBpcyBub3QgYSByZXRyb2FjdGl2ZSByZXdyaXRlLCBidXQgYSB2b3RlIGhlcmUKY2hvb3NlcyB3aGF0IGV2ZXJ5IGJ1aWxkZXIgYWZ0ZXIgaXQgaXMgdHJ1c3RpbmcuAAAAC1NldFdhc21IYXNoAAAAAAEAAAPuAAAAIAAAAAEAAAEXU2VuZCBsaXN0aW5nIGZlZXMgc29tZXdoZXJlIGVsc2Ug4oCUIGluY2x1ZGluZyB0byBhIHJlcGxhY2VtZW50IHRyZWFzdXJ5LgoKTmVjZXNzYXJ5IHJhdGhlciB0aGFuIG9wdGlvbmFsLiBPbmNlIHRoaXMgY29udHJhY3QgaXMgdGhlIGZhY3RvcnkncyBhZG1pbgppdCBpcyB0aGUgb25seSB0aGluZyB0aGF0IGNhbiByZXBvaW50IGZlZXMsIHNvIHdpdGhvdXQgdGhpcyBhIHRyZWFzdXJ5CnRoYXQgbmVlZGVkIHJlcGxhY2luZyBjb3VsZCBuZXZlciBoYW5kIG92ZXIgaXRzIG93biBpbmNvbWUuAAAAAAxTZXRGZWVXYWxsZXQAAAABAAAAEwAAAAEAAAAzQ2hhbmdlIHdoaWNoIHJlZ2lzdHJ5IHZvdWNoZXMgZm9yIGJ1aWxkZXIgaWRlbnRpdHkuAAAAABNTZXRJZGVudGl0eVJlZ2lzdHJ5AAAAAAEAAAATAAAAAQAAADlDaGFuZ2UgaG93IGxvbmcgY29udHJpYnV0b3JzIGhhdmUgdG8gdm90ZSBvbiBhIG1pbGVzdG9uZS4AAAAAAAAPU2V0Vm90aW5nV2luZG93AAAAAAEAAAAGAAAAAQAAADVDaGFuZ2UgdGhlIHNtYWxsZXN0IGNvbnRyaWJ1dGlvbiBhIHZhdWx0IHdpbGwgYWNjZXB0LgAAAAAAABJTZXRNaW5Db250cmlidXRpb24AAAAAAAEAAAALAAAAAQAAAlVSZXBsYWNlIHRoZSBvd25lcnMsIHNwbGl0dGluZyB0aGUgdHJlYXN1cnkgZXF1YWxseSBiZXR3ZWVuIHRoZW0uCgpUaGUgb3JkaW5hcnkgd2F5IHRvIGFkZCBvciByZW1vdmUgYW4gb3duZXIuIE93bmVycyBob2xkIGVxdWFsIHNoYXJlcyBieQpkZWZhdWx0LCBzbyBuYW1pbmcgdGhlIHBlb3BsZSBpcyBlbm91Z2ggYW5kIG5vYm9keSBoYXMgdG8gY29tcHV0ZSBiYXNpcwpwb2ludHMgdGhhdCBtdXN0IGxhbmQgb24gZXhhY3RseSAxMCAwMDAuIFNldFNoYXJlaG9sZGVycyBhYm92ZSByZW1haW5zCmZvciB0aGUgZGVsaWJlcmF0ZSBleGNlcHRpb24g4oCUIGFuIHVuZXF1YWwgc3BsaXQgdGhlIG93bmVycyBoYXZlIHZvdGVkIGZvci4KCkFkZGluZyBhbiBvd25lciBkaWx1dGVzIHRoZSBleGlzdGluZyBvbmVzLCB3aGljaCBpcyB0aGUgaW50ZW5kZWQgbWVhbmluZzoKb3duZXJzIG93biB0aGUgcGxhdGZvcm0sIHNvIGFkbWl0dGluZyBvbmUgaXMgYSBmaW5hbmNpYWwgZGVjaXNpb24uIFN0YWZmCndobyBuZWVkIGNvbnNvbGUgYWNjZXNzIHdpdGhvdXQgYSBzaGFyZSBhcmUgYSBzZXBhcmF0ZSByb2xlIGVudGlyZWx5IGFuZApuZXZlciBhcHBlYXIgaGVyZS4AAAAAAAAJU2V0T3duZXJzAAAAAAAAAQAAA+oAAAATAAAAAQAAAW1Sb3V0ZSBhIG1vbnRobHkgc2hhcmUgb2YgdGhlIHRyZWFzdXJ5J3MgZ2FzIGFzc2V0IHRvIHRoZSBPcGVyYXRpb25zClZhdWx0LCB3aGljaCBwYXlzIGZvciB0aGUgcGxhdGZvcm0ncyBtb2RlcmF0aW9uIGdhcy4gT3duZXJzIHNldCB0aGUgdmF1bHQsCnRoZSBhc3NldCAoWExNKSBhbmQgdGhlIHBlcmNlbnRhZ2Ugb25jZTsgdGhlcmVhZnRlciBmdW5kX29wZXJhdGlvbnMgbW92ZXMKdGhhdCBzaGFyZSBldmVyeSB0aGlydHkgZGF5cywgcGVybWlzc2lvbmxlc3NseS4gRGVsaWJlcmF0ZWx5IGEgcGVyY2VudGFnZQpvZiB0aGUgKnVucmVzZXJ2ZWQqIGJhbGFuY2UsIHNvIGl0IG5ldmVyIHRvdWNoZXMgYSBzaGFyZWhvbGRlcidzIG93ZWQgcGF5LgAAAAAAAA1TZXRPcHNGdW5kaW5nAAAAAAAAAQAAB9AAAAAPT3BzRnVuZGluZ1Rlcm1zAA==",
        "AAAAAQAAAAAAAAAAAAAACFByb3Bvc2FsAAAABgAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADkdvdmVybmVkQWN0aW9uAAAAAAAAAAAACWFwcHJvdmFscwAAAAAAAAQAAAAAAAAACWNsb3Nlc19hdAAAAAAAAAYAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAlvcGVuZWRfYXQAAAAAAAAGAAAAAAAAAAZyb3N0ZXIAAAAAA+oAAAfQAAAAC1NoYXJlaG9sZGVyAA==",
        "AAAAAQAAAIxIb3cgdGhlIHRyZWFzdXJ5IGZ1bmRzIG9wZXJhdGlvbnMgZ2FzOiB3aGVyZSBpdCBnb2VzLCB3aGljaCBhc3NldCBpdCByb3V0ZXMKKHRoZSBuYXRpdmUgdG9rZW4g4oCUIFhMTSksIGFuZCB0aGUgbW9udGhseSBjdXQgaW4gYmFzaXMgcG9pbnRzLgAAAAAAAAAPT3BzRnVuZGluZ1Rlcm1zAAAAAAMAAABAQmFzaXMgcG9pbnRzIG9mIHRoZSB1bnJlc2VydmVkIGJhbGFuY2UsIG1vdmVkIGV2ZXJ5IHRoaXJ0eSBkYXlzLgAAAANicHMAAAAABAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAV2YXVsdAAAAAAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAEAAAAAAAAAAAAAAAB0ZhY3RvcnkAAAAAAAAAAAAAAAAMU2hhcmVob2xkZXJzAAAAAAAAAAAAAAAKVm90ZVdpbmRvdwAAAAAAAAAAAAAAAAALTmV4dEN5Y2xlSWQAAAAAAQAAAI1jeWNsZV9pZCAtPiBDeWNsZS4gS2V5ZWQsIG5vdCBhIHNpbmdsZSBzbG90OiBhIHBheWFibGUgY3ljbGUgdGhhdCBzb21lCnNoYXJlaG9sZGVyIGhhcyBub3QgZ290IHJvdW5kIHRvIGNsYWltaW5nIG11c3Qgbm90IGJsb2NrIHRoZSBuZXh0IG9uZS4AAAAAAAAFQ3ljbGUAAAAAAAABAAAABAAAAAAAAABiVGhlIGN5Y2xlIGN1cnJlbnRseSBiZWluZyB2b3RlZCBvbiwgaWYgYW55LiBDbGVhcmVkIHRoZSBtb21lbnQgdm90aW5nCmVuZHMsIHdoaWNoZXZlciB3YXkgaXQgd2VudC4AAAAAAAtPcGVuQ3ljbGVJZAAAAAABAAAAyXRva2VuIC0+IHRoZSBzdW0gc3RpbGwgb3dlZCB0byBzaGFyZWhvbGRlcnMgb2YgcGF5YWJsZSBjeWNsZXMuIEEgbmV3CmN5Y2xlIG1heSBvbmx5IHRha2UgdGhlIGJhbGFuY2UgKmFib3ZlKiB0aGlzLCBzbyBub2JvZHkncyB1bmNsYWltZWQKc2hhcmUgY2FuIGJlIHN3ZXB0IGludG8gYSBsYXRlciBjeWNsZSBhbmQgcGFpZCB0byBzb21lYm9keSBlbHNlLgAAAAAAAAhSZXNlcnZlZAAAAAEAAAATAAAAAQAAAC9jeWNsZV9pZCAtPiBob3cgbWFueSBzaGFyZWhvbGRlcnMgaGF2ZSBjbGFpbWVkLgAAAAAKQ2xhaW1Db3VudAAAAAAAAQAAAAQAAAAAAAAAR1doZW4gYSBjeWNsZSBsYXN0IGNhcnJpZWQuIFJlbGVhc2VzIGFyZSBtb250aGx5LCBhbmQgdGhpcyBpcyB0aGUgY2xvY2suAAAAAA1MYXN0UmVsZWFzZUF0AAAAAAAAAQAAABooY3ljbGVfaWQsIHZvdGVyKSAtPiB2b3RlZAAAAAAACUN5Y2xlVm90ZQAAAAAAAAIAAAAEAAAAEwAAAAEAAAAiKGN5Y2xlX2lkLCBzaGFyZWhvbGRlcikgLT4gY2xhaW1lZAAAAAAAB0NsYWltZWQAAAAAAgAAAAQAAAATAAAAAAAAAAAAAAAIUHJvcG9zYWwAAAAAAAAAAAAAAA5OZXh0UHJvcG9zYWxJZAAAAAAAAQAAAB0ocHJvcG9zYWxfaWQsIHZvdGVyKSAtPiB2b3RlZAAAAAAAAAxQcm9wb3NhbFZvdGUAAAACAAAABAAAABMAAAAAAAAAQVRoZSBPcGVyYXRpb25zIFZhdWx0IGZ1bmRpbmcgdGVybXMg4oCUIHZhdWx0LCBhc3NldCwgbW9udGhseSBicHMuAAAAAAAACk9wc0Z1bmRpbmcAAAAAAAAAAACOV2hlbiBvcGVyYXRpb25zIGZ1bmRpbmcgbGFzdCByYW4uIE1vbnRobHksIGFuZCB0aGlzIGlzIGl0cyBjbG9jayDigJQKc2VwYXJhdGUgZnJvbSBMYXN0UmVsZWFzZUF0IHNvIGdhcyB0b3AtdXBzIGFuZCBkaXZpZGVuZHMgbmV2ZXIgc2hhcmUgb25lLgAAAAAAEExhc3RPcHNGdW5kaW5nQXQ=",
        "AAAAAAAAAepDb25maWd1cmUgdGhlIHRyZWFzdXJ5LiBgZmFjdG9yeWAgaXMgdGhlIGNvbnRyYWN0IHdob3NlIGZlZSB0aGlzCnRyZWFzdXJ5IG1heSBjaGFuZ2U7IGl0IG11c3Qgc2V0IHRoaXMgY29udHJhY3QgYXMgaXRzIGFkbWluIGZvciB0aGF0IHRvCndvcmssIHdoaWNoIGlzIGEgc2VwYXJhdGUgZGVsaWJlcmF0ZSBhY3QuCgpgZGVwbG95ZXJgIG11c3Qgc2lnbi4gV2l0aG91dCB0aGF0IHNpZ25hdHVyZSB0aGlzIGlzIGEgbGFuZCBncmFiOiBhCnRyZWFzdXJ5IHNpdHRpbmcgZGVwbG95ZWQgYW5kIHVuY29uZmlndXJlZCBmb3IgZXZlbiBvbmUgbGVkZ2VyIGNhbiBiZQpjbGFpbWVkIGJ5IHdob2V2ZXIgY2FsbHMgdGhpcyBmaXJzdCwgbmFtaW5nIHRoZW1zZWx2ZXMgdGhlIGVudGlyZQpyZWdpc3Rlci4gRGVwbG95IGFuZCBpbml0aWFsaXplIGFyZSBzZXBhcmF0ZSB0cmFuc2FjdGlvbnMsIHNvIHRoYXQKd2luZG93IGlzIHJlYWwgcmF0aGVyIHRoYW4gdGhlb3JldGljYWwuAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAIZGVwbG95ZXIAAAATAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAAAAAADHNoYXJlaG9sZGVycwAAA+oAAAfQAAAAC1NoYXJlaG9sZGVyAAAAAAA=",
        "AAAAAAAAAoZPcGVuIGEgY3ljbGUgb3ZlciB0aGUgdHJlYXN1cnkncyAqdW5yZXNlcnZlZCogYmFsYW5jZSBvZiBgdG9rZW5gLgoKQW55IHNoYXJlaG9sZGVyIG1heSBvcGVuIG9uZS4gVGhlcmUgaXMgbm8gcHJpdmlsZWdlZCBwcm9wb3NlciwgYmVjYXVzZSBhCnByb3Bvc2VyIHdobyBjb3VsZCByZWZ1c2UgdG8gYWN0IHdvdWxkIGJlIGFibGUgdG8gd2l0aGhvbGQgZXZlcnlvbmUKZWxzZSdzIGVhcm5pbmdzIGluZGVmaW5pdGVseS4KCk9ubHkgYSBjeWNsZSBzdGlsbCBiZWluZyB2b3RlZCBvbiBibG9ja3MgYSBuZXcgb25lLiBBIHBheWFibGUgY3ljbGUgZG9lcwpub3Q6IGl0cyBtb25leSBpcyByZXNlcnZlZCwgc28gYSBsYXRlciBjeWNsZSBjYW5ub3QgcmVhY2ggaXQsIGFuZCB0aGVyZQppcyBubyByZWFzb24gdG8gbWFrZSBldmVyeW9uZSB3YWl0IGZvciB0aGUgbGFzdCBzaGFyZWhvbGRlciB0byBnZXQgcm91bmQKdG8gY2xhaW1pbmcuIEFuIGVhcmxpZXIgZGVzaWduIGJsb2NrZWQgb24gcGF5YWJsZSBhbmQgZGVhZGxvY2tlZCB0aGUKY29udHJhY3QgdGhlIG1vbWVudCBhIGN5Y2xlIHdhcyBmdWxseSBjbGFpbWVkIOKAlCB0aGUgc3RhdGUgc3RheWVkIHBheWFibGUKZm9yZXZlciBhbmQgbm8gZnVydGhlciBjeWNsZSBjb3VsZCBldmVyIG9wZW4uAAAAAAAKb3Blbl9jeWNsZQAAAAAAAgAAAAAAAAAGb3BlbmVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAA",
        "AAAAAAAAAERBcHByb3ZlIHRoZSBvcGVuIGN5Y2xlLiBPbmUgdm90ZSBwZXIgc2hhcmVob2xkZXIsIHdlaWdodGVkIGJ5IHNoYXJlLgAAAA1hcHByb3ZlX2N5Y2xlAAAAAAAAAQAAAAAAAAAFdm90ZXIAAAAAAAATAAAAAA==",
        "AAAAAAAAAPFNYXJrIGEgY3ljbGUgdGhhdCBjbG9zZWQgYmVsb3cgdGhyZXNob2xkIGFzIGxhcHNlZC4KClBlcm1pc3Npb25sZXNzLCBhbmQgaXQgcGF5cyBub2JvZHkuIE5vdGhpbmcgd2FzIHJlc2VydmVkLCBzbyB0aGUgYmFsYW5jZQpzaW1wbHkgc3RheXMgaGVyZSBhbmQgaXMgcGlja2VkIHVwIGJ5IHRoZSBuZXh0IGN5Y2xlOiBhbiB1bmZpbmlzaGVkIHZvdGUKZGVsYXlzIGEgcGF5b3V0IHJhdGhlciB0aGFuIGRlc3Ryb3lpbmcgaXQuAAAAAAAAE3NldHRsZV9sYXBzZWRfY3ljbGUAAAAAAAAAAAA=",
        "AAAAAAAAAV1DbGFpbSB5b3VyIHNoYXJlIG9mIGEgcGF5YWJsZSBjeWNsZS4KCk5hbWVkIGJ5IGN5Y2xlIGlkLCBiZWNhdXNlIHNldmVyYWwgbWF5IGJlIHBheWFibGUgYXQgb25jZTogYSBzaGFyZWhvbGRlcgp3aG8gaXMgc2xvdyB0byBjbGFpbSBuZXZlciBibG9ja3MgdGhlIG5leHQgY3ljbGUsIGFuZCBuZXZlciBsb3NlcyB3aGF0CnRoZXkgYXJlIG93ZWQgZnJvbSBhbiBlYXJsaWVyIG9uZS4KClB1bGxlZCByYXRoZXIgdGhhbiBwdXNoZWQsIHNvIG9uZSByZWNpcGllbnQgdGhhdCBjYW5ub3QgcmVjZWl2ZSB0aGUgdG9rZW4KY2Fubm90IHN0cmFuZCBldmVyeW9uZSBlbHNlJ3MgbW9uZXkgYmVoaW5kIHRoZWlyIHByb2JsZW0uAAAAAAAABWNsYWltAAAAAAAAAgAAAAAAAAALc2hhcmVob2xkZXIAAAAAEwAAAAAAAAAIY3ljbGVfaWQAAAAEAAAAAA==",
        "AAAAAAAAAU1Qcm9wb3NlIGEgZ292ZXJuZWQgYWN0aW9uOiB0aGUgbGlzdGluZyBmZWUsIGZhY3RvcnkgYWRtaW4sIG9yIHRoZQpzaGFyZWhvbGRlciByZWdpc3Rlci4KClRoZSBmZWUgc3RheXMgYSBmbGF0IGFtb3VudC4gU09XIHY0IHN0YXRlcyBhIGZsYXQtZmVlIG1vZGVsIHRocmVlIHRpbWVzCmFuZCBmcmFtZXMgaXQgYXMgYSBQaGlsaXBwaW5lIFNFQy9CU1AgY29uc3RyYWludCDigJQgIkJMS0ZORFIgY2hhcmdlcyBmbGF0CmZlZXMsIG5ldmVyIHRha2VzIGEgcGVyY2VudGFnZSBvZiBmdW5kcyIg4oCUIHNvIHdoYXQgYSB2b3RlIGFkanVzdHMgaXMgdGhlCmFtb3VudCwgbm90IHRoZSBzaGFwZS4AAAAAAAAHcHJvcG9zZQAAAAACAAAAAAAAAAhwcm9wb3NlcgAAABMAAAAAAAAABmFjdGlvbgAAAAAH0AAAAA5Hb3Zlcm5lZEFjdGlvbgAAAAAAAA==",
        "AAAAAAAAAAAAAAAQYXBwcm92ZV9wcm9wb3NhbAAAAAEAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAANxBcHBseSBhIGNhcnJpZWQgcHJvcG9zYWwgdG8gdGhlIGZhY3RvcnkuCgpQZXJtaXNzaW9ubGVzcyBvbmNlIHRoZSB2b3RlIGhhcyBjYXJyaWVkOiBleGVjdXRpb24gc2hvdWxkIG5vdCBkZXBlbmQgb24KdGhlIGdvb2R3aWxsIG9mIHdob2V2ZXIgcHJvcG9zZWQgaXQuIFRoaXMgY29udHJhY3QgbXVzdCBiZSB0aGUgZmFjdG9yeSdzCmFkbWluIGZvciB0aGUgY2FsbCB0byBhdXRob3Jpc2UuAAAAEGV4ZWN1dGVfcHJvcG9zYWwAAAAAAAAAAA==",
        "AAAAAAAAAsVNb3ZlIHRoaXMgbW9udGgncyBvcGVyYXRpb25zIGZ1bmRpbmcgdG8gdGhlIE9wZXJhdGlvbnMgVmF1bHQuCgpQZXJtaXNzaW9ubGVzcyBhbmQgdGltZS1nYXRlZDogYW55b25lIG1heSB0cmlnZ2VyIGl0IOKAlCB0aGUgaW5kZXhlciBjcm9uCmRvZXMg4oCUIGJ1dCBvbmx5IG9uY2UgZXZlcnkgdGhpcnR5IGRheXMsIHNvIG5vIGNhbGxlciBjYW4gZHJhaW4gdGhlIGN1dCBieQpjYWxsaW5nIGluIGEgbG9vcC4gSXQgbW92ZXMgYSBzZXQgcGVyY2VudGFnZSBvZiB0aGUgKnVucmVzZXJ2ZWQqIGJhbGFuY2UKb2YgdGhlIGNvbmZpZ3VyZWQgYXNzZXQsIG5ldmVyIGEgc2hhcmVob2xkZXIncyBvd2VkIG1vbmV5LCBhbmQgb25seSB3aGlsZQpubyBjeWNsZSBpcyBtaWQtdm90ZSDigJQgYSBjeWNsZSBoYXMgYWxyZWFkeSBzbmFwc2hvdHRlZCB0aGUgYmFsYW5jZSBpdCB3aWxsCnBheSwgYW5kIG1vdmluZyBtb25leSBvdXQgZnJvbSB1bmRlciB0aGF0IHNuYXBzaG90IGNvdWxkIGxlYXZlIHRoZSB0cmVhc3VyeQp1bmFibGUgdG8gaG9ub3VyIGl0LgoKVGhlIG93bmVycyBzZXQgdGhlIHZhdWx0LCBhc3NldCBhbmQgcGVyY2VudGFnZSBvbmNlLCBieSB2b3RlCihTZXRPcHNGdW5kaW5nKTsgYWZ0ZXIgdGhhdCB0aGlzIG5lZWRzIG5vIGZ1cnRoZXIgYXBwcm92YWwsIHdoaWNoIGlzIHRoZQpwb2ludCDigJQgdGhlIGdhcyBidWRnZXQgcmVmaWxscyBpdHNlbGYuAAAAAAAAD2Z1bmRfb3BlcmF0aW9ucwAAAAAAAAAAAA==",
        "AAAAAAAAADxXaGVuIHRoZSBuZXh0IGN5Y2xlIG1heSBvcGVuLiBaZXJvIGlmIG5vbmUgaGFzIGV2ZXIgY2FycmllZC4AAAAPbmV4dF9yZWxlYXNlX2F0AAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAAQZ2V0X3NoYXJlaG9sZGVycwAAAAAAAAABAAAD6gAAB9AAAAALU2hhcmVob2xkZXIA",
        "AAAAAAAAAAAAAAAJZ2V0X2N5Y2xlAAAAAAAAAQAAAAAAAAAIY3ljbGVfaWQAAAAEAAAAAQAAA+gAAAfQAAAABUN5Y2xlAAAA",
        "AAAAAAAAACtUaGUgY3ljbGUgY3VycmVudGx5IGJlaW5nIHZvdGVkIG9uLCBpZiBhbnkuAAAAAA5nZXRfb3Blbl9jeWNsZQAAAAAAAAAAAAEAAAPoAAAH0AAAAAVDeWNsZQAAAA==",
        "AAAAAAAAAFpXaGF0IGlzIHN0aWxsIG93ZWQgdG8gc2hhcmVob2xkZXJzIG9mIHBheWFibGUgY3ljbGVzLCBhbmQgc28gY2Fubm90IGJlCnRha2VuIGJ5IGEgbmV3IG9uZS4AAAAAAAxnZXRfcmVzZXJ2ZWQAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAACtXaGF0IGEgY3ljbGUgb3BlbmVkIHJpZ2h0IG5vdyB3b3VsZCBzZXR0bGUuAAAAAA1nZXRfYXZhaWxhYmxlAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMZ2V0X3Byb3Bvc2FsAAAAAAAAAAEAAAPoAAAH0AAAAAhQcm9wb3NhbA==",
        "AAAAAAAAAAAAAAALZ2V0X2ZhY3RvcnkAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAALaGFzX2NsYWltZWQAAAAAAgAAAAAAAAAIY3ljbGVfaWQAAAAEAAAAAAAAAAtzaGFyZWhvbGRlcgAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKYmFsYW5jZV9vZgAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAADpUaGUgb3BlcmF0aW9ucyBmdW5kaW5nIHRlcm1zLCBpZiB0aGUgb3duZXJzIGhhdmUgc2V0IHRoZW0uAAAAAAAPZ2V0X29wc19mdW5kaW5nAAAAAAAAAAABAAAD6AAAB9AAAAAPT3BzRnVuZGluZ1Rlcm1zAA==",
        "AAAAAAAAAH5XaGVuIG9wZXJhdGlvbnMgZnVuZGluZyBtYXkgbmV4dCBydW4uIFplcm8gaWYgaXQgaGFzIG5ldmVyIHJ1biDigJQgdGhlIGZpcnN0CmNhbGwgaXMgYWxsb3dlZCB0aGUgbW9tZW50IGZ1bmRpbmcgaXMgY29uZmlndXJlZC4AAAAAABNuZXh0X29wc19mdW5kaW5nX2F0AAAAAAAAAAABAAAABg==",
        "AAAAAAAAAH9XaGF0IHRoZSBuZXh0IGZ1bmRpbmcgcnVuIHdvdWxkIG1vdmU6IGJwcyBvZiB0aGUgdW5yZXNlcnZlZCBiYWxhbmNlIG9mIHRoZQpjb25maWd1cmVkIGFzc2V0LiBaZXJvIGlmIGZ1bmRpbmcgaXMgbm90IGNvbmZpZ3VyZWQuAAAAABVvcHNfZnVuZGluZ19hdmFpbGFibGUAAAAAAAAAAAAAAQAAAAs=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<null>,
        open_cycle: this.txFromJSON<null>,
        approve_cycle: this.txFromJSON<null>,
        settle_lapsed_cycle: this.txFromJSON<null>,
        claim: this.txFromJSON<null>,
        propose: this.txFromJSON<null>,
        approve_proposal: this.txFromJSON<null>,
        execute_proposal: this.txFromJSON<null>,
        fund_operations: this.txFromJSON<null>,
        next_release_at: this.txFromJSON<u64>,
        get_shareholders: this.txFromJSON<Array<Shareholder>>,
        get_cycle: this.txFromJSON<Option<Cycle>>,
        get_open_cycle: this.txFromJSON<Option<Cycle>>,
        get_reserved: this.txFromJSON<i128>,
        get_available: this.txFromJSON<i128>,
        get_proposal: this.txFromJSON<Option<Proposal>>,
        get_factory: this.txFromJSON<string>,
        has_claimed: this.txFromJSON<boolean>,
        balance_of: this.txFromJSON<i128>,
        get_ops_funding: this.txFromJSON<Option<OpsFundingTerms>>,
        next_ops_funding_at: this.txFromJSON<u64>,
        ops_funding_available: this.txFromJSON<i128>
  }
}