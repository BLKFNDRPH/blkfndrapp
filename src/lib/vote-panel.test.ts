import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeVotePanel,
  encodeVotePanel,
  milestonesToCount,
  type PanelMilestone,
  type VotePanel,
} from "./vote-panel.ts";

const stage = (id: number, over: Partial<PanelMilestone> = {}): PanelMilestone => ({
  id,
  amount: 18_000_000_000n,
  released: false,
  failed: false,
  vote_opens_at: 0n,
  approved_weight: 0n,
  ...over,
});

/** Project #11 as testnet had it: two stages, both votes open, $600 of $1,500 yes. */
const panel: VotePanel = {
  tally: {
    milestones: [
      stage(1, { vote_opens_at: 1_760_250_000n, approved_weight: 6_000_000_000n }),
      stage(2, { amount: 12_000_000_000n, vote_opens_at: 1_760_250_120n, approved_weight: 6_000_000_000n }),
    ],
    raised: 30_000_000_000n,
    windowSecs: 604_800,
    token: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    requiredWeight: 15_000_000_000n,
    wallets: { 1: { supported: true, approvals: 1, required: 3 }, 2: null },
    stakes: { 1: { supported: true, approved: 6_000_000_000n, required: 15_000_000_001n }, 2: { supported: false } },
  },
  mine: { weight: 6_000_000_000n, voted: { 1: true, 2: false } },
};

test("a panel survives the trip through JSON unchanged", () => {
  const wire = JSON.parse(JSON.stringify(encodeVotePanel(panel)));
  assert.deepEqual(decodeVotePanel(wire), panel);
});

test("figures beyond 2^53 keep every digit", () => {
  const huge = 9_007_199_254_740_993_123n;
  const big: VotePanel = {
    tally: { ...panel.tally, raised: huge, requiredWeight: null },
    mine: null,
  };
  const wire = JSON.parse(JSON.stringify(encodeVotePanel(big)));
  assert.equal(wire.tally.raised, "9007199254740993123");
  assert.equal(decodeVotePanel(wire).tally.raised, huge);
  assert.equal(decodeVotePanel(wire).tally.requiredWeight, null);
  assert.equal(decodeVotePanel(wire).mine, null);
});

test("only open, unsettled votes are counted", () => {
  const list = [
    stage(1, { released: true, vote_opens_at: 5n }),
    stage(2, { vote_opens_at: 9n }),
    stage(3, { failed: true, vote_opens_at: 7n }),
    stage(4),
  ];
  assert.deepEqual(milestonesToCount(list).map((m) => m.id), [2]);
});

test("with no vote open, the first stage is still asked about", () => {
  assert.deepEqual(milestonesToCount([stage(1), stage(2)]).map((m) => m.id), [1]);
  assert.deepEqual(milestonesToCount([]), []);
});
