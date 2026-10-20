import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SENDS_PER_RUN,
  VAULT_STATE,
  runKeeperPass,
  type Assembled,
  type VaultClients,
  type VaultInfo,
} from "./governance-keeper-pass.ts";

/**
 * One keeper pass against stand-in vaults that answer get_state and get_info
 * the way the binding does, and refuse a call the way the binding surfaces a
 * contract refusal: when the simulation is read, not when the call is built.
 *
 * Run with `npm test`.
 */

const BOND = 7_500_000n; // 0.75 USDC

interface StandInVault {
  state: number;
  info: VaultInfo;
  /** Calls the vault refuses, by name, with the contract error it raises. */
  refuses?: Record<string, string>;
  /** A vault on a code shape the binding cannot decode. */
  unreadable?: boolean;
}

function standIn(vaults: Record<string, StandInVault>) {
  const built: string[] = [];
  const sent: string[] = [];

  const assembled = async (vault: string, call: string): Promise<Assembled> => {
    built.push(`${vault} ${call}`);
    const refusal = vaults[vault].refuses?.[call];
    return {
      get simulationData() {
        if (refusal) throw new Error(`HostError: Error(Contract, ${refusal})`);
        return {};
      },
      signAndSend: async () => {
        sent.push(`${vault} ${call}`);
        return { getTransactionResponse: { status: "SUCCESS" } };
      },
    };
  };

  const clients: VaultClients = {
    read: (vault) => ({
      get_state: async () => ({ result: vaults[vault].state }),
      get_info: async () => {
        if (vaults[vault].unreadable) throw new Error("Bad union switch: 7");
        return { result: vaults[vault].info };
      },
    }),
    write: (vault) => ({
      settle: () => assembled(vault, "settle"),
      return_bond: () => assembled(vault, "return_bond"),
      release_milestone: ({ milestone_id }) => assembled(vault, `release_milestone ${milestone_id}`),
      settle_lapsed_milestone: ({ milestone_id }) => assembled(vault, `settle_lapsed_milestone ${milestone_id}`),
    }),
  };

  return { clients, built, sent };
}

const failedFresh: VaultInfo = { attested: false, bond_amount: BOND, bond_returned: false };
const failedRecorded: VaultInfo = { attested: true, bond_amount: BOND, bond_returned: false };
const failedClosed: VaultInfo = { attested: true, bond_amount: BOND, bond_returned: true };

test("a freshly failed raise gets its record written, then its bond back, in one run", async () => {
  const { clients, sent } = standIn({ CFAIL: { state: VAULT_STATE.Failed, info: failedFresh } });
  const pass = await runKeeperPass(["CFAIL"], clients, false);
  assert.deepEqual(pass.actions, [
    { vault: "CFAIL", kind: "record-missed-goal", outcome: "sent" },
    { vault: "CFAIL", kind: "return-bond", outcome: "sent" },
  ]);
  assert.deepEqual(sent, ["CFAIL settle", "CFAIL return_bond"]);
  assert.equal(pass.sends, 2);
});

test("a failed raise already on the record, bond still held, gets only the bond back", async () => {
  const { clients, built } = standIn({ CFAIL: { state: VAULT_STATE.Failed, info: failedRecorded } });
  const pass = await runKeeperPass(["CFAIL"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CFAIL", kind: "return-bond", outcome: "sent" }]);
  assert.deepEqual(built, ["CFAIL return_bond"]);
});

test("a bond already returned is left alone", async () => {
  const { clients, built } = standIn({ CDONE: { state: VAULT_STATE.Failed, info: failedClosed } });
  const pass = await runKeeperPass(["CDONE"], clients, false);
  assert.deepEqual(pass.actions, []);
  assert.deepEqual(built, []);
  assert.equal(pass.sends, 0);
});

test("a failed raise with no bond gets its record and nothing else", async () => {
  const { clients, built } = standIn({
    CNOBOND: { state: VAULT_STATE.Failed, info: { attested: false, bond_amount: 0n, bond_returned: false } },
  });
  const pass = await runKeeperPass(["CNOBOND"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CNOBOND", kind: "record-missed-goal", outcome: "sent" }]);
  assert.deepEqual(built, ["CNOBOND settle"]);
});

test("a vault still raising is not touched, bond or not", async () => {
  const { clients, built } = standIn({ CRAISE: { state: VAULT_STATE.Raising, info: failedFresh } });
  const pass = await runKeeperPass(["CRAISE"], clients, false);
  assert.deepEqual(pass.actions, []);
  assert.deepEqual(built, []);
});

test("a dry run reports what it would send and sends nothing", async () => {
  const { clients, built, sent } = standIn({ CFAIL: { state: VAULT_STATE.Failed, info: failedFresh } });
  const pass = await runKeeperPass(["CFAIL"], clients, true);
  assert.deepEqual(pass.actions, [
    { vault: "CFAIL", kind: "record-missed-goal", outcome: "would-send" },
    { vault: "CFAIL", kind: "return-bond", outcome: "would-send" },
  ]);
  assert.deepEqual(built, ["CFAIL settle", "CFAIL return_bond"]);
  assert.deepEqual(sent, []);
  assert.equal(pass.sends, 0);
});

test("what the vault refuses is not sent: the key decides timing, never an outcome", async () => {
  // The database said failed; the vault, read fresh, says its bond is gone (#9).
  const { clients, sent } = standIn({
    CFAIL: { state: VAULT_STATE.Failed, info: failedFresh, refuses: { return_bond: "#9" } },
  });
  const pass = await runKeeperPass(["CFAIL"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CFAIL", kind: "record-missed-goal", outcome: "sent" }]);
  assert.deepEqual(sent, ["CFAIL settle"]);
});

test("a vault the binding cannot decode is skipped, not failed on", async () => {
  const { clients, built } = standIn({
    COLD: { state: VAULT_STATE.Failed, info: failedFresh, unreadable: true },
    CFAIL: { state: VAULT_STATE.Failed, info: failedRecorded },
  });
  const pass = await runKeeperPass(["COLD", "CFAIL"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CFAIL", kind: "return-bond", outcome: "sent" }]);
  assert.deepEqual(built, ["CFAIL return_bond"]);
});

test("the bond return counts against the per-run budget and waits for the next run past it", async () => {
  // Enough recorded failures to leave one send, then a fresh one that needs two.
  const vaults: Record<string, StandInVault> = {};
  const order: string[] = [];
  for (let i = 1; i < MAX_SENDS_PER_RUN; i++) {
    vaults[`C${i}`] = { state: VAULT_STATE.Failed, info: failedRecorded };
    order.push(`C${i}`);
  }
  vaults.CLAST = { state: VAULT_STATE.Failed, info: failedFresh };
  order.push("CLAST");
  vaults.CAFTER = { state: VAULT_STATE.Failed, info: failedRecorded };
  order.push("CAFTER");

  const { clients, built } = standIn(vaults);
  const pass = await runKeeperPass(order, clients, false);
  assert.equal(pass.sends, MAX_SENDS_PER_RUN);
  const last = pass.actions.filter((a) => a.vault === "CLAST");
  assert.deepEqual(last, [{ vault: "CLAST", kind: "record-missed-goal", outcome: "sent" }]);
  assert.ok(!built.includes("CLAST return_bond"));
  assert.ok(!built.includes("CAFTER return_bond"));
});

test("a carried stage is paid and the next stage waits for the next run", async () => {
  const { clients, built } = standIn({
    CFUND: {
      state: VAULT_STATE.Funded,
      info: {
        milestones: [
          { id: 1, released: false, vote_opens_at: 1_760_000_000n },
          { id: 2, released: false, vote_opens_at: 1_760_000_000n },
        ],
      },
    },
  });
  const pass = await runKeeperPass(["CFUND"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CFUND", kind: "release", milestoneId: 1, outcome: "sent" }]);
  assert.deepEqual(built, ["CFUND release_milestone 1"]);
});

test("a stage whose vote ended short is closed; one with no vote open is not asked about", async () => {
  const { clients, built } = standIn({
    CFUND: {
      state: VAULT_STATE.Funded,
      info: {
        milestones: [
          { id: 1, released: false, vote_opens_at: 1_760_000_000n },
          { id: 2, released: false, vote_opens_at: 0n },
        ],
      },
      refuses: { "release_milestone 1": "#16" },
    },
  });
  const pass = await runKeeperPass(["CFUND"], clients, false);
  assert.deepEqual(pass.actions, [{ vault: "CFUND", kind: "close-stage", milestoneId: 1, outcome: "sent" }]);
  assert.deepEqual(built, ["CFUND release_milestone 1", "CFUND settle_lapsed_milestone 1"]);
});
