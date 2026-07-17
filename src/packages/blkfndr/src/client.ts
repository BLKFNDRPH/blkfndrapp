import {
  ProjectData,
  ReceiptData,
  PlatformData,
  ProposalData,
  CreateProjectInput,
  ShareRules,
  Status,
} from "./types.js";
import {
  Spec,
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
} from "@stellar/stellar-sdk/contract";
import { Address } from "@stellar/stellar-sdk";

export interface Client {
  initialize(
    {
      admin,
      fee_wallet_address,
      fee_wallet_email,
    }: {
      admin: string | Address;
      fee_wallet_address: string | Address;
      fee_wallet_email: string;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  get_project(
    { project_id }: { project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<ProjectData>>;
  get_receipt(
    { receipt_id }: { receipt_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<ReceiptData>>;
  burn_receipt(
    {
      investor,
      receipt_id,
    }: { investor: string | Address; receipt_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  edit_project(
    {
      creator,
      project_id,
      title,
      tagline,
      description,
      category,
      goal,
      blob_id,
      funding_deadline,
    }: {
      creator: string | Address;
      project_id: bigint;
      title: string;
      tagline: string;
      description: string;
      category: string;
      goal: bigint;
      blob_id: string;
      funding_deadline: bigint;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  fund_project(
    {
      investor,
      project_id,
      amount,
      image_url,
    }: {
      investor: string | Address;
      project_id: bigint;
      amount: bigint;
      image_url: string;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  get_platform_info(
    options?: MethodOptions,
  ): Promise<AssembledTransaction<PlatformData>>;
  get_proposal(
    { project_id }: { project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<ProposalData>>;
  create_project(
    {
      creator,
      input,
    }: { creator: string | Address; input: CreateProjectInput },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<bigint>>;
  delete_project(
    { caller, project_id }: { caller: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  set_fee_wallet(
    {
      admin,
      fee_wallet_address,
      fee_wallet_email,
    }: {
      admin: string | Address;
      fee_wallet_address: string | Address;
      fee_wallet_email: string;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  get_share_rules(
    options?: MethodOptions,
  ): Promise<AssembledTransaction<ShareRules>>;
  refund_investor(
    {
      investor,
      receipt_id,
      project_id,
    }: { investor: string | Address; receipt_id: bigint; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  get_platform_fee(
    options?: MethodOptions,
  ): Promise<AssembledTransaction<bigint>>;
  add_multisig_admin(
    {
      admin,
      new_admin,
    }: { admin: string | Address; new_admin: string | Address },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  donate_to_platform(
    {
      donor,
      token_address,
      amount,
      message,
    }: {
      donor: string | Address;
      token_address: string | Address;
      amount: bigint;
      message: string;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  execute_withdrawal(
    { creator, project_id }: { creator: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  propose_withdrawal(
    { creator, project_id }: { creator: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  update_share_rules(
    {
      admin,
      min_percentage,
      max_percentage,
      description,
    }: {
      admin: string | Address;
      min_percentage: bigint;
      max_percentage: bigint;
      description: string;
    },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  is_project_approved(
    { project_id }: { project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<boolean>>;
  update_platform_fee(
    { admin, new_fee_bps }: { admin: string | Address; new_fee_bps: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  admin_delete_project(
    {
      admin,
      project_id,
      reason,
    }: { admin: string | Address; project_id: bigint; reason: string },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  mark_project_expired(
    { caller, project_id }: { caller: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  remove_multisig_admin(
    { admin, target }: { admin: string | Address; target: string | Address },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  update_project_status(
    {
      admin,
      project_id,
      new_status,
    }: { admin: string | Address; project_id: bigint; new_status: Status },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  has_pending_withdrawal(
    { project_id }: { project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<boolean>>;
  submit_project_for_review(
    { creator, project_id }: { creator: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  approve_withdrawal_proposal(
    {
      approver,
      project_id,
    }: { approver: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
  withdraw_project_from_review(
    { creator, project_id }: { creator: string | Address; project_id: bigint },
    options?: MethodOptions,
  ): Promise<AssembledTransaction<void>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec([
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAGAAAAAAAAAAITm90QWRtaW4AAAAAAAAAAAAAAAtOb3RNdWx0aVNpZwAAAAABAAAAAAAAABJQcm9qZWN0Tm90QXBwcm92ZWQAAAAAAAMAAAAAAAAAEUluc3VmZmljaWVudEZ1bmRzAAAAAAAABAAAAAAAAAASR29hbEFscmVhZHlSZWFjaGVkAAAAAAAFAAAAAAAAABFJbnZhbGlkUGVyY2VudGFnZQAAAAAAAAYAAAAAAAAAEU5vdFByb2plY3RDcmVhdG9yAAAAAAAABwAAAAAAAAAQUHJvamVjdE5vdEZ1bmRlZAAAAAgAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAAJAAAAAAAAAA9JbnZhbGlkQ3VycmVuY3kAAAAACgAAAAAAAAAPUHJvamVjdEhhc0Z1bmRzAAAAAAsAAAAAAAAAFFByb2plY3RBbHJlYWR5RnVuZGVkAAAADAAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAA0AAAAAAAAADEFscmVhZHlWb3RlZAAAAA4AAAAAAAAAFUluc3VmZmljaWVudEFwcHJvdmFscwAAAAAAAA8AAAAAAAAAFUZ1bmRpbmdEZWFkbGluZVBhc3NlZAAAAAAAABAAAAAAAAAAD1Byb2plY3RNaXNtYXRjaAAAAAARAAAAAAAAAA9Ob0Z1bmRzVG9SZWZ1bmQAAAAAEgAAAAAAAAAVUHJvcG9zYWxBbHJlYWR5RXhpc3RzAAAAAAAAEwAAAAAAAAAMSW5jb3JyZWN0RmVlAAAAFAAAAAAAAAAKSW52YWxpZEZlZQAAAAAAFQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAABYAAAAAAAAAD1Byb2plY3ROb3RGb3VuZAAAAAAXAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAABg=",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAABwAAAAAAAAAGSGlkZGVuAAAAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAEAAAAAAAAACFJlamVjdGVkAAAAAgAAAAAAAAAIQXBwcm92ZWQAAAADAAAAAAAAAAZGdW5kZWQAAAAAAAQAAAAAAAAACUNvbXBsZXRlZAAAAAAAAAUAAAAAAAAAB0V4cGlyZWQAAAAABg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAACFBsYXRmb3JtAAAAAQAAAAAAAAAHUHJvamVjdAAAAAABAAAABgAAAAEAAAAAAAAACFByb3Bvc2FsAAAAAQAAAAYAAAABAAAAAAAAAAdSZWNlaXB0AAAAAAEAAAAGAAAAAAAAAAAAAAAOUmVjZWlwdENvdW50ZXIAAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAABJmZWVfd2FsbGV0X2FkZHJlc3MAAAAAABMAAAAAAAAAEGZlZV93YWxsZXRfZW1haWwAAAAQAAAAAA==",
        "AAAAAAAAAAAAAAALZ2V0X3Byb2plY3QAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAfQAAAAC1Byb2plY3REYXRhAA==",
        "AAAAAAAAAAAAAAALZ2V0X3JlY2VpcHQAAAAAAQAAAAAAAAAKcmVjZWlwdF9pZAAAAAAABgAAAAEAAAfQAAAAC1JlY2VpcHREYXRhAA==",
        "AAAAAAAAAAAAAAAMYnVybl9yZWNlaXB0AAAAAgAAAAAAAAAIaW52ZXN0b3IAAAATAAAAAAAAAApyZWNlaXB0X2lkAAAAAAAGAAAAAA==",
        "AAAAAAAAAAAAAAAMZWRpdF9wcm9qZWN0AAAACQAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAB3RhZ2xpbmUAAAAAEAAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAIY2F0ZWdvcnkAAAAQAAAAAAAAAARnb2FsAAAACwAAAAAAAAAHYmxvYl9pZAAAAAAQAAAAAAAAABBmdW5kaW5nX2RlYWRsaW5lAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAMZnVuZF9wcm9qZWN0AAAABAAAAAAAAAAIaW52ZXN0b3IAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACWltYWdlX3VybAAAAAAAABAAAAAA",
        "AAAAAAAAAAAAAAAMZ2V0X3BsYXRmb3JtAAAAAAAAAAEAAAfQAAAADFBsYXRmb3JtRGF0YQ==",
        "AAAAAAAAAAAAAAAMZ2V0X3Byb3Bvc2FsAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAfQAAAADFByb3Bvc2FsRGF0YQ==",
        "AAAAAQAAAAAAAAAAAAAAClNoYXJlUnVsZXMAAAAAAAMAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADm1heF9wZXJjZW50YWdlAAAAAAAGAAAAAAAAAA5taW5fcGVyY2VudGFnZQAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAAC1Byb2plY3REYXRhAAAAABEAAAAAAAAAB2JhbGFuY2UAAAAACwAAAAAAAAAHYmxvYl9pZAAAAAAQAAAAAAAAAAhjYXRlZ29yeQAAABAAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAOY3VycmVuY3lfbGFiZWwAAAAAABAAAAAAAAAADmN1cnJlbmN5X3Rva2VuAAAAAAATAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAABBmdW5kaW5nX2RlYWRsaW5lAAAABgAAAAAAAAAEZ29hbAAAAAsAAAAAAAAAFmhhc19wZW5kaW5nX3dpdGhkcmF3YWwAAAAAAAEAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAADXJhaXNlZF9hbW91bnQAAAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAAAAAAAB3RhZ2xpbmUAAAAAEAAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAh0b2tlbl9pZAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAC1JlY2VpcHREYXRhAAAAAAoAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAOY3VycmVuY3lfbGFiZWwAAAAAABAAAAAAAAAACGZlZV9wYWlkAAAACwAAAAAAAAAJaW1hZ2VfdXJsAAAAAAAAEAAAAAAAAAAPaW52ZXN0bWVudF9kYXRlAAAAAAYAAAAAAAAACGludmVzdG9yAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAANcHJvamVjdF90aXRsZQAAAAAAABAAAAAAAAAACnJlY2VpcHRfaWQAAAAAAAYAAAAAAAAAEHNoYXJlX3BlcmNlbnRhZ2UAAAAG",
        "AAAAAAAAAAAAAAAOY3JlYXRlX3Byb2plY3QAAAAAAAIAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFaW5wdXQAAAAAAAfQAAAAEkNyZWF0ZVByb2plY3RJbnB1dAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAAOZGVsZXRlX3Byb2plY3QAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAOc2V0X2ZlZV93YWxsZXQAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAASZmVlX3dhbGxldF9hZGRyZXNzAAAAAAATAAAAAAAAABBmZWVfd2FsbGV0X2VtYWlsAAAAEAAAAAA=",
        "AAAAAQAAAAAAAAAAAAAADFBsYXRmb3JtRGF0YQAAAAgAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAOZmVlX3BlcmNlbnRhZ2UAAAAAAAYAAAAAAAAAEmZlZV93YWxsZXRfYWRkcmVzcwAAAAAAEwAAAAAAAAAQZmVlX3dhbGxldF9lbWFpbAAAABAAAAAAAAAAEG11bHRpX3NpZ19hZG1pbnMAAAPqAAAAEwAAAAAAAAAPcHJvamVjdF9jb3VudGVyAAAAAAYAAAAAAAAAC3NoYXJlX3J1bGVzAAAAB9AAAAAKU2hhcmVSdWxlcwAAAAAAAAAAABR0b3RhbF9mZWVzX2NvbGxlY3RlZAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAADFByb3Bvc2FsRGF0YQAAAAQAAAAAAAAACWFwcHJvdmFscwAAAAAAA+oAAAATAAAAAAAAAAtpc19leGVjdXRlZAAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAA5yZXF1aXJlZF92b3RlcwAAAAAABg==",
        "AAAAAAAAAAAAAAAPZ2V0X3NoYXJlX3J1bGVzAAAAAAAAAAABAAAH0AAAAApTaGFyZVJ1bGVzAAA=",
        "AAAAAAAAAAAAAAAPcmVmdW5kX2ludmVzdG9yAAAAAAMAAAAAAAAACGludmVzdG9yAAAAEwAAAAAAAAAKcmVjZWlwdF9pZAAAAAAABgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAQZ2V0X3BsYXRmb3JtX2ZlZQAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAASYWRkX211bHRpc2lnX2FkbWluAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAASZG9uYXRlX3RvX3BsYXRmb3JtAAAAAAAEAAAAAAAAAAVkb25vcgAAAAAAABMAAAAAAAAADXRva2VuX2FkZHJlc3MAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAB21lc3NhZ2UAAAAAEAAAAAA=",
        "AAAAAAAAAAAAAAASZXhlY3V0ZV93aXRoZHJhd2FsAAAAAAACAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAAScHJvcG9zZV93aXRoZHJhd2FsAAAAAAACAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAASdXBkYXRlX3NoYXJlX3J1bGVzAAAAAAAEAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADm1pbl9wZXJjZW50YWdlAAAAAAAGAAAAAAAAAA5tYXhfcGVyY2VudGFnZQAAAAAABgAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAA=",
        "AAAAAAAAAAAAAAATaXNfcHJvamVjdF9hcHByb3ZlZAAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAATdXBkYXRlX3BsYXRmb3JtX2ZlZQAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAC25ld19mZWVfYnBzAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAAUYWRtaW5fZGVsZXRlX3Byb2plY3QAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAA=",
        "AAAAAAAAAAAAAAAUbWFya19wcm9qZWN0X2V4cGlyZWQAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACnByb2plY3RfaWQAAAAAAAYAAAAA",
        "AAAAAQAAAAAAAAAAAAAAEkNyZWF0ZVByb2plY3RJbnB1dAAAAAAACgAAAAAAAAAHYmxvYl9pZAAAAAAQAAAAAAAAAAhjYXRlZ29yeQAAABAAAAAAAAAADmN1cnJlbmN5X2xhYmVsAAAAAAAQAAAAAAAAAA5jdXJyZW5jeV90b2tlbgAAAAAAEwAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAQZnVuZGluZ19kZWFkbGluZQAAAAYAAAAAAAAABGdvYWwAAAALAAAAAAAAAAlpc19wdWJsaWMAAAAAAAABAAAAAAAAAAd0YWdsaW5lAAAAABAAAAAAAAAABXRpdGxlAAAAAAAAEA==",
        "AAAAAAAAAAAAAAAVcmVtb3ZlX211bHRpc2lnX2FkbWluAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAVdXBkYXRlX3Byb2plY3Rfc3RhdHVzAAAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAAAAAApuZXdfc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAAA==",
        "AAAAAAAAAAAAAAAWaGFzX3BlbmRpbmdfd2l0aGRyYXdhbAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAAB",
        "AAAAAAAAAAAAAAAZc3VibWl0X3Byb2plY3RfZm9yX3JldmlldwAAAAAAAAIAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAbYXBwcm92ZV93aXRoZHJhd2FsX3Byb3Bvc2FsAAAAAAIAAAAAAAAACGFwcHJvdmVyAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAcd2l0aGRyYXdfcHJvamVjdF9mcm9tX3JldmlldwAAAAIAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAA=",
      ]),
      options,
    );
  }

  static deploy<T = Client>(
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        wasmHash: Buffer | string;
        salt?: Buffer | Uint8Array;
        format?: "hex" | "base64";
        address?: string;
      },
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<void>,
    get_project: this.txFromJSON<ProjectData>,
    get_receipt: this.txFromJSON<ReceiptData>,
    burn_receipt: this.txFromJSON<void>,
    edit_project: this.txFromJSON<void>,
    fund_project: this.txFromJSON<void>,
    get_platform_info: this.txFromJSON<PlatformData>,
    get_proposal: this.txFromJSON<ProposalData>,
    create_project: this.txFromJSON<bigint>,
    delete_project: this.txFromJSON<void>,
    set_fee_wallet: this.txFromJSON<void>,
    get_share_rules: this.txFromJSON<ShareRules>,
    refund_investor: this.txFromJSON<void>,
    get_platform_fee: this.txFromJSON<bigint>,
    add_multisig_admin: this.txFromJSON<void>,
    donate_to_platform: this.txFromJSON<void>,
    execute_withdrawal: this.txFromJSON<void>,
    propose_withdrawal: this.txFromJSON<void>,
    update_share_rules: this.txFromJSON<void>,
    is_project_approved: this.txFromJSON<boolean>,
    update_platform_fee: this.txFromJSON<void>,
    admin_delete_project: this.txFromJSON<void>,
    mark_project_expired: this.txFromJSON<void>,
    remove_multisig_admin: this.txFromJSON<void>,
    update_project_status: this.txFromJSON<void>,
    has_pending_withdrawal: this.txFromJSON<boolean>,
    submit_project_for_review: this.txFromJSON<void>,
    approve_withdrawal_proposal: this.txFromJSON<void>,
    withdraw_project_from_review: this.txFromJSON<void>,
  };
}
