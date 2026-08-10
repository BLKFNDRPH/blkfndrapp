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
  11: {message:"NotInitialized"},
  20: {message:"NotAnOwner"},
  21: {message:"TooManyOwners"},
  22: {message:"DuplicateOwner"},
  23: {message:"NoOwners"},
  40: {message:"NoProposalOpen"},
  41: {message:"ProposalAlreadyOpen"},
  42: {message:"AlreadyVoted"},
  43: {message:"VotingClosed"},
  44: {message:"ThresholdNotMet"},
  45: {message:"ThresholdAlreadyMet"},
  50: {message:"InvalidAmount"},
  51: {message:"InsufficientFunds"},
  52: {message:"InvalidBatch"}
}


/**
 * The terms of a spend: how much of which token goes where.
 */
export interface ReleaseTerms {
  amount: i128;
  to: string;
  token: string;
}

/**
 * What a carried proposal does.
 */
export type GovernedAction = {tag: "Release", values: readonly [ReleaseTerms]} | {tag: "ReleaseMany", values: readonly [Array<ReleaseTerms>]} | {tag: "SetOwners", values: readonly [Array<string>]} | {tag: "SetVotingWindow", values: readonly [u64]};


export interface Proposal {
  action: GovernedAction;
  approvals: u32;
  closes_at: u64;
  id: u32;
  opened_at: u64;
  /**
 * The owner set as it stood when the proposal opened. A vote is decided
 * against this snapshot, so changing the owners mid-vote cannot move the
 * threshold or the electorate under an in-flight proposal.
 */
owners: Array<string>;
}

export type DataKey = {tag: "Owners", values: void} | {tag: "VoteWindow", values: void} | {tag: "Proposal", values: void} | {tag: "NextProposalId", values: void} | {tag: "ProposalVote", values: readonly [u32, string]};

export interface Client {
  /**
   * Construct and simulate a propose transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a governed action: a release, a change of owners, or a change of
   * the voting window. The proposer must be an owner.
   */
  propose: ({proposer, action}: {proposer: string, action: GovernedAction}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve the open proposal. One vote per owner, decided against the owner
   * snapshot the proposal took when it opened.
   */
  approve: ({voter}: {voter: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a carried proposal.
   * 
   * Permissionless once the vote has carried: executing it should not depend on
   * the goodwill of whoever proposed it. A release moves the vault's own
   * balance, which the contract authorises for itself — no owner key signs the
   * transfer, the carried vote is the authority.
   */
  execute: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_owners transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_owners: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a is_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_owner: ({who}: {who: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Proposal>>>

  /**
   * Construct and simulate a vote_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  vote_window: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a balance_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance_of: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {deployer, owners}: {deployer: string, owners: Array<string>},
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
    return ContractClient.deploy({deployer, owners}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAACk5vdEFuT3duZXIAAAAAABQAAAAAAAAADVRvb01hbnlPd25lcnMAAAAAAAAVAAAAAAAAAA5EdXBsaWNhdGVPd25lcgAAAAAAFgAAAAAAAAAITm9Pd25lcnMAAAAXAAAAAAAAAA5Ob1Byb3Bvc2FsT3BlbgAAAAAAKAAAAAAAAAATUHJvcG9zYWxBbHJlYWR5T3BlbgAAAAApAAAAAAAAAAxBbHJlYWR5Vm90ZWQAAAAqAAAAAAAAAAxWb3RpbmdDbG9zZWQAAAArAAAAAAAAAA9UaHJlc2hvbGROb3RNZXQAAAAALAAAAAAAAAATVGhyZXNob2xkQWxyZWFkeU1ldAAAAAAtAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAMgAAAAAAAAARSW5zdWZmaWNpZW50RnVuZHMAAAAAAAAzAAAAAAAAAAxJbnZhbGlkQmF0Y2gAAAA0",
        "AAAAAQAAADlUaGUgdGVybXMgb2YgYSBzcGVuZDogaG93IG11Y2ggb2Ygd2hpY2ggdG9rZW4gZ29lcyB3aGVyZS4AAAAAAAAAAAAADFJlbGVhc2VUZXJtcwAAAAMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAACdG8AAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAgAAAB1XaGF0IGEgY2FycmllZCBwcm9wb3NhbCBkb2VzLgAAAAAAAAAAAAAOR292ZXJuZWRBY3Rpb24AAAAAAAQAAAABAAAAOVBheSBvcGVyYXRpbmcgZnVuZHMgb3V0IHRvIGEgZGVzdGluYXRpb24gdGhlIG93bmVycyBuYW1lLgAAAAAAAAdSZWxlYXNlAAAAAAEAAAfQAAAADFJlbGVhc2VUZXJtcwAAAAEAAAEkUGF5IHNldmVyYWwgZGVzdGluYXRpb25zIGluIG9uZSBjYXJyaWVkIHZvdGUg4oCUIHRoZSBtb250aGx5IGdhcyB0b3AtdXAgdG8KZXZlcnkgYWN0aXZlIGN1c3RvZGlhbCB3YWxsZXQgYXQgb25jZSwgcmF0aGVyIHRoYW4gYSB2b3RlIHBlciB3YWxsZXQuIEl0CmlzIGFsbC1vci1ub3RoaW5nOiBpZiBhbnkgc2luZ2xlIHRyYW5zZmVyIGNhbm5vdCBiZSBjb3ZlcmVkIHRoZSB3aG9sZQpleGVjdXRpb24gcmV2ZXJ0cywgc28gYSBiYXRjaCBuZXZlciBmdW5kcyBzb21lIHdhbGxldHMgYW5kIHN0cmFuZHMgb3RoZXJzLgAAAAtSZWxlYXNlTWFueQAAAAABAAAD6gAAB9AAAAAMUmVsZWFzZVRlcm1zAAAAAQAAAJNSZXBsYWNlIHRoZSBvd25lciBzZXQg4oCUIHRoZSB2b3RlcnMuIFRoZSBvbmx5IHdheSB0byBhZGQgb3IgcmVtb3ZlIG9uZSwgc28KdGhlIGJvZHkgdGhhdCBkZWNpZGVzIGhvdyBtb25leSBtb3ZlcyBpcyBjaGFuZ2VkIHRoZSBzYW1lIHdheSBtb25leSBpcy4AAAAACVNldE93bmVycwAAAAAAAAEAAAPqAAAAEwAAAAEAAAAiQ2hhbmdlIGhvdyBsb25nIGEgdm90ZSBzdGF5cyBvcGVuLgAAAAAAD1NldFZvdGluZ1dpbmRvdwAAAAABAAAABg==",
        "AAAAAQAAAAAAAAAAAAAACFByb3Bvc2FsAAAABgAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADkdvdmVybmVkQWN0aW9uAAAAAAAAAAAACWFwcHJvdmFscwAAAAAAAAQAAAAAAAAACWNsb3Nlc19hdAAAAAAAAAYAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAlvcGVuZWRfYXQAAAAAAAAGAAAAxVRoZSBvd25lciBzZXQgYXMgaXQgc3Rvb2Qgd2hlbiB0aGUgcHJvcG9zYWwgb3BlbmVkLiBBIHZvdGUgaXMgZGVjaWRlZAphZ2FpbnN0IHRoaXMgc25hcHNob3QsIHNvIGNoYW5naW5nIHRoZSBvd25lcnMgbWlkLXZvdGUgY2Fubm90IG1vdmUgdGhlCnRocmVzaG9sZCBvciB0aGUgZWxlY3RvcmF0ZSB1bmRlciBhbiBpbi1mbGlnaHQgcHJvcG9zYWwuAAAAAAAABm93bmVycwAAAAAD6gAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABk93bmVycwAAAAAAAAAAAAAAAAAKVm90ZVdpbmRvdwAAAAAAAAAAAAAAAAAIUHJvcG9zYWwAAAAAAAAAAAAAAA5OZXh0UHJvcG9zYWxJZAAAAAAAAQAAAB0ocHJvcG9zYWxfaWQsIHZvdGVyKSAtPiB2b3RlZAAAAAAAAAxQcm9wb3NhbFZvdGUAAAACAAAABAAAABM=",
        "AAAAAAAAAU1Db25maWd1cmUgdGhlIHZhdWx0IHdpdGggaXRzIG93bmVycyDigJQgdGhlIHZvdGVycy4KCkEgY29uc3RydWN0b3I6IGl0IHJ1bnMgaW5zaWRlIHRoZSBkZXBsb3kgdHJhbnNhY3Rpb24sIHNvIHRoZSB2YXVsdCBpcwpuZXZlciBkZXBsb3llZC1idXQtdW5jb25maWd1cmVkIGZvciBldmVuIG9uZSBsZWRnZXIuIFRoYXQgY2xvc2VzIHRoZQp3aW5kb3cgYSBzZXBhcmF0ZSBgaW5pdGlhbGl6ZWAgbGVmdCBvcGVuLCBpbiB3aGljaCB3aG9ldmVyIGNhbGxlZCBpdCBmaXJzdApjb3VsZCBuYW1lIHRoZW1zZWx2ZXMgdGhlIG9ubHkgb3duZXIuIGBkZXBsb3llcmAgc2lnbnMgdGhlIGRlcGxveS4AAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAACGRlcGxveWVyAAAAEwAAAAAAAAAGb3duZXJzAAAAAAPqAAAAEwAAAAA=",
        "AAAAAAAAAHpQcm9wb3NlIGEgZ292ZXJuZWQgYWN0aW9uOiBhIHJlbGVhc2UsIGEgY2hhbmdlIG9mIG93bmVycywgb3IgYSBjaGFuZ2Ugb2YKdGhlIHZvdGluZyB3aW5kb3cuIFRoZSBwcm9wb3NlciBtdXN0IGJlIGFuIG93bmVyLgAAAAAAB3Byb3Bvc2UAAAAAAgAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAOR292ZXJuZWRBY3Rpb24AAAAAAAA=",
        "AAAAAAAAAHNBcHByb3ZlIHRoZSBvcGVuIHByb3Bvc2FsLiBPbmUgdm90ZSBwZXIgb3duZXIsIGRlY2lkZWQgYWdhaW5zdCB0aGUgb3duZXIKc25hcHNob3QgdGhlIHByb3Bvc2FsIHRvb2sgd2hlbiBpdCBvcGVuZWQuAAAAAAdhcHByb3ZlAAAAAAEAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAASVBcHBseSBhIGNhcnJpZWQgcHJvcG9zYWwuCgpQZXJtaXNzaW9ubGVzcyBvbmNlIHRoZSB2b3RlIGhhcyBjYXJyaWVkOiBleGVjdXRpbmcgaXQgc2hvdWxkIG5vdCBkZXBlbmQgb24KdGhlIGdvb2R3aWxsIG9mIHdob2V2ZXIgcHJvcG9zZWQgaXQuIEEgcmVsZWFzZSBtb3ZlcyB0aGUgdmF1bHQncyBvd24KYmFsYW5jZSwgd2hpY2ggdGhlIGNvbnRyYWN0IGF1dGhvcmlzZXMgZm9yIGl0c2VsZiDigJQgbm8gb3duZXIga2V5IHNpZ25zIHRoZQp0cmFuc2ZlciwgdGhlIGNhcnJpZWQgdm90ZSBpcyB0aGUgYXV0aG9yaXR5LgAAAAAAAAdleGVjdXRlAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAKZ2V0X293bmVycwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAAIaXNfb3duZXIAAAABAAAAAAAAAAN3aG8AAAAAEwAAAAEAAAAB",
        "AAAAAAAAAAAAAAAMZ2V0X3Byb3Bvc2FsAAAAAAAAAAEAAAPoAAAH0AAAAAhQcm9wb3NhbA==",
        "AAAAAAAAAAAAAAALdm90ZV93aW5kb3cAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAAAAAAAKYmFsYW5jZV9vZgAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAs=" ]),
      options
    )
  }
  public readonly fromJSON = {
    propose: this.txFromJSON<null>,
        approve: this.txFromJSON<null>,
        execute: this.txFromJSON<null>,
        get_owners: this.txFromJSON<Array<string>>,
        is_owner: this.txFromJSON<boolean>,
        get_proposal: this.txFromJSON<Option<Proposal>>,
        vote_window: this.txFromJSON<u64>,
        balance_of: this.txFromJSON<i128>
  }
}