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
    12: { message: "AlreadyAnAdmin" },
    13: { message: "NotAnAdmin" },
    /**
     * The owner may not remove themselves, which would leave the roster with
     * nobody able to change it.
     */
    14: { message: "WouldOrphanRoster" }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABgAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAACgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAsAAAAAAAAADkFscmVhZHlBbkFkbWluAAAAAAAMAAAAAAAAAApOb3RBbkFkbWluAAAAAAANAAAAYFRoZSBvd25lciBtYXkgbm90IHJlbW92ZSB0aGVtc2VsdmVzLCB3aGljaCB3b3VsZCBsZWF2ZSB0aGUgcm9zdGVyIHdpdGgKbm9ib2R5IGFibGUgdG8gY2hhbmdlIGl0LgAAABFXb3VsZE9ycGhhblJvc3RlcgAAAAAAAA4=",
            "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAArVGhlIGFjY291bnQgdGhhdCBtYXkgYWRkIGFuZCByZW1vdmUgYWRtaW5zLgAAAAAFT3duZXIAAAAAAAAAAAAAAAAAAAZBZG1pbnMAAA==",
            "AAAAAAAAAKlCaW5kIHRoZSByb3N0ZXIgdG8gYW4gb3duZXIsIHdobyBiZWNvbWVzIGl0cyBmaXJzdCBhZG1pbi4KCmBvd25lcmAgbXVzdCBhdXRob3Jpc2UsIHNvIGEgZGVwbG95ZWQtYnV0LXVuY29uZmlndXJlZCByZWdpc3RyeSBjYW5ub3QKYmUgY2xhaW1lZCBieSB3aG9ldmVyIG5vdGljZXMgaXQgZmlyc3QuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=",
            "AAAAAAAAAAAAAAAJYWRkX2FkbWluAAAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
            "AAAAAAAAAAAAAAAMcmVtb3ZlX2FkbWluAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
            "AAAAAAAAAEhIYW5kIHRoZSByb3N0ZXIgdG8gYSBuZXcgb3duZXIsIHdobyBpcyBhZGRlZCBhcyBhbiBhZG1pbiBpZiBub3QgYWxyZWFkeS4AAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAA==",
            "AAAAAAAAAAAAAAAIaXNfYWRtaW4AAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAQ==",
            "AAAAAAAAAAAAAAAKZ2V0X2FkbWlucwAAAAAAAAAAAAEAAAPqAAAAEw==",
            "AAAAAAAAAAAAAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAAT",
            "AAAAAAAAAAAAAAALYWRtaW5fY291bnQAAAAAAAAAAAEAAAAE"]), options);
        this.options = options;
    }
    fromJSON = {
        initialize: (this.txFromJSON),
        add_admin: (this.txFromJSON),
        remove_admin: (this.txFromJSON),
        transfer_ownership: (this.txFromJSON),
        is_admin: (this.txFromJSON),
        get_admins: (this.txFromJSON),
        get_owner: (this.txFromJSON),
        admin_count: (this.txFromJSON)
    };
}
