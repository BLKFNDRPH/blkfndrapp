import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
if (typeof window !== "undefined") {
    //@ts-ignore Buffer exists
    window.Buffer = window.Buffer || Buffer;
}
export const Errors = {
    1: { message: "NotAuthorized" },
    10: { message: "AlreadyInitialized" },
    11: { message: "NotInitialized" },
    12: { message: "InvalidThreshold" },
    13: { message: "NotASigner" },
    14: { message: "AlreadyApproved" },
    15: { message: "SignerAlreadyExists" },
    16: { message: "SignerNotFound" },
    17: { message: "ThresholdExceedsSigners" }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAAEEludmFsaWRUaHJlc2hvbGQAAAAMAAAAAAAAAApOb3RBU2lnbmVyAAAAAAANAAAAAAAAAA9BbHJlYWR5QXBwcm92ZWQAAAAADgAAAAAAAAATU2lnbmVyQWxyZWFkeUV4aXN0cwAAAAAPAAAAAAAAAA5TaWduZXJOb3RGb3VuZAAAAAAAEAAAAAAAAAAXVGhyZXNob2xkRXhjZWVkc1NpZ25lcnMAAAAAEQ==",
            "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAHU2lnbmVycwAAAAAAAAAAAAAAAAlUaHJlc2hvbGQAAAAAAAABAAAAAAAAABFNaWxlc3RvbmVBcHByb3ZhbAAAAAAAAAIAAAAGAAAABAAAAAEAAAAAAAAADVNsYXNoQXBwcm92YWwAAAAAAAABAAAABg==",
            "AAAAAAAAAE1Jbml0aWFsaXplIHRoZSBhcHByb3ZhbCBtb2R1bGUgd2l0aCBhbiBhZG1pbiwgbGlzdCBvZiBzaWduZXJzLCBhbmQgdGhyZXNob2xkLgAAAAAAAAppbml0aWFsaXplAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB3NpZ25lcnMAAAAD6gAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAA",
            "AAAAAAAAADhSZWNvcmQgYSBzaWduZXIncyBhcHByb3ZhbCBmb3IgYSBtaWxlc3RvbmUgaW4gYSBwcm9qZWN0LgAAABFhcHByb3ZlX21pbGVzdG9uZQAAAAAAAAMAAAAAAAAABnNpZ25lcgAAAAAAEwAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAA=",
            "AAAAAAAAAEVDaGVjayBpZiBhIG1pbGVzdG9uZSBoYXMgcmVhY2hlZCB0aGUgcmVxdWlyZWQgdGhyZXNob2xkIG9mIGFwcHJvdmFscy4AAAAAAAALaXNfYXBwcm92ZWQAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAEAAAAB",
            "AAAAAAAAAEFSZWNvcmQgYSBzaWduZXIncyBhcHByb3ZhbCB0byBzbGFzaCBhIHByb2plY3QncyBwZXJmb3JtYW5jZSBib25kLgAAAAAAAA1hcHByb3ZlX3NsYXNoAAAAAAAAAgAAAAAAAAAGc2lnbmVyAAAAAAATAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAA==",
            "AAAAAAAAAElDaGVjayBpZiBhIHNsYXNoIHJlcXVlc3QgaGFzIHJlYWNoZWQgdGhlIHJlcXVpcmVkIHRocmVzaG9sZCBvZiBhcHByb3ZhbHMuAAAAAAAAEWlzX3NsYXNoX2FwcHJvdmVkAAAAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAEAAAAB",
            "AAAAAAAAADBBZGQgYSBuZXcgc2lnbmVyIHRvIHRoZSBhdXRob3JpemVkIG11bHRpc2lnIHNldC4AAAAKYWRkX3NpZ25lcgAAAAAAAQAAAAAAAAAKbmV3X3NpZ25lcgAAAAAAEwAAAAA=",
            "AAAAAAAAADFSZW1vdmUgYSBzaWduZXIgZnJvbSB0aGUgYXV0aG9yaXplZCBtdWx0aXNpZyBzZXQuAAAAAAAADXJlbW92ZV9zaWduZXIAAAAAAAABAAAAAAAAAAZzaWduZXIAAAAAABMAAAAA",
            "AAAAAAAAADRVcGRhdGUgdGhlIG11bHRpc2lnIHRocmVzaG9sZCByZXF1aXJlZCBmb3IgYXBwcm92YWwuAAAAEHVwZGF0ZV90aHJlc2hvbGQAAAABAAAAAAAAAA1uZXdfdGhyZXNob2xkAAAAAAAABAAAAAA=",
            "AAAAAAAAAAAAAAALZ2V0X3NpZ25lcnMAAAAAAAAAAAEAAAPqAAAAEw==",
            "AAAAAAAAAAAAAAANZ2V0X3RocmVzaG9sZAAAAAAAAAAAAAABAAAABA==",
            "AAAAAAAAAAAAAAAXZ2V0X21pbGVzdG9uZV9hcHByb3ZhbHMAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAABgAAAAAAAAAMbWlsZXN0b25lX2lkAAAABAAAAAEAAAPqAAAAEw==",
            "AAAAAAAAAAAAAAATZ2V0X3NsYXNoX2FwcHJvdmFscwAAAAABAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAGAAAAAQAAA+oAAAAT"]), options);
        this.options = options;
    }
    fromJSON = {
        initialize: (this.txFromJSON),
        approve_milestone: (this.txFromJSON),
        is_approved: (this.txFromJSON),
        approve_slash: (this.txFromJSON),
        is_slash_approved: (this.txFromJSON),
        add_signer: (this.txFromJSON),
        remove_signer: (this.txFromJSON),
        update_threshold: (this.txFromJSON),
        get_signers: (this.txFromJSON),
        get_threshold: (this.txFromJSON),
        get_milestone_approvals: (this.txFromJSON),
        get_slash_approvals: (this.txFromJSON)
    };
}
