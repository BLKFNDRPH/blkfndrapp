import dns from "node:dns";
import https from "node:https";

if (typeof window === "undefined") {
  dns.setDefaultResultOrder("ipv4first");
  https.globalAgent.options.family = 4;
}

import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { connectToDatabase } from "./mongodb";
import ProjectCache from "./models/ProjectCache";
import EventLog from "./models/EventLog";
import IndexerState from "./models/IndexerState";
import { getIPFSFetchUrl } from "./pinata-client";
import { addressMatcher } from "./stellar-address";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "./stellar";
import { Client as VaultClient } from "../packages/blkfndr_vault/src";

// Factory Contract ID resolved dynamically inside runIndexer

const rpcServer = new rpc.Server(SOROBAN_RPC_URL!);

// Helper to decode base64 XDR ScVal to JS Native types
function decodeScVal(xdrBase64: string): any {
  try {
    const parsed = xdr.ScVal.fromXDR(xdrBase64, "base64");
    return scValToNative(parsed);
  } catch (err) {
    console.error("Failed to decode XDR ScVal:", err);
    return null;
  }
}

// Helper to fetch metadata JSON from IPFS
async function fetchMetadata(cid: string): Promise<any> {
  if (!cid || cid.trim() === "" || cid === "test_cid") {
    return null;
  }
  // Strict CID resolution only. The CID arrives from an on-chain event that any
  // project creator controls, so an absolute URL here would be an SSRF.
  const url = getIPFSFetchUrl(cid);
  if (!url) {
    console.warn(`[Indexer] Ignoring non-CID metadata reference: ${cid}`);
    return null;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      // Listing metadata is a small JSON object. Anyone can pin anything at a
      // CID, so cap what we are willing to pull into memory and parse.
      const MAX_METADATA_BYTES = 256 * 1024;
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_METADATA_BYTES) {
        console.warn(`[Indexer] Metadata for ${cid} exceeds ${MAX_METADATA_BYTES} bytes — ignoring`);
        return null;
      }
      const body = await response.text();
      if (body.length > MAX_METADATA_BYTES) {
        console.warn(`[Indexer] Metadata for ${cid} exceeds ${MAX_METADATA_BYTES} bytes — ignoring`);
        return null;
      }
      return JSON.parse(body);
    }
  } catch (err) {
    console.warn(`[Indexer] Could not fetch IPFS metadata for CID: ${cid}`, err);
  }
  return null;
}

export async function runIndexer() {
  await connectToDatabase();

  // 1. Get last processed ledger and verify bounds against latest ledger sequence
  let latestLedger = 0;
  try {
    const latestLedgerRes = await rpcServer.getLatestLedger();
    latestLedger = latestLedgerRes.sequence;
  } catch (err) {
    console.error("Failed to fetch latest ledger from RPC:", err);
  }

  let state = await IndexerState.findOne({ key: "last_processed_ledger" });
  let startLedger = 0;

  if (state) {
    startLedger = state.value + 1;
    // Clip startLedger if it is more than 30,000 blocks in the past or if it exceeds latestLedger
    if (latestLedger > 0 && (startLedger < latestLedger - 30000 || startLedger > latestLedger)) {
      console.log(`[Indexer] startLedger ${startLedger} is outside valid RPC bounds (latest: ${latestLedger}). Resetting to ${latestLedger - 10000}`);
      startLedger = Math.max(1, latestLedger - 10000);
      state.value = startLedger - 1;
      await state.save();
    }
  } else {
    // Fallback: start 10000 blocks back from latest ledger sequence
    startLedger = latestLedger > 0 ? Math.max(1, latestLedger - 10000) : 1;
    state = await IndexerState.create({ key: "last_processed_ledger", value: startLedger - 1 });
  }

  // 2. Fetch all watched contract addresses (Factory + deployed vault addresses)
  const cachedProjects = await ProjectCache.find({}, "vaultAddress").lean();
  const vaultAddresses = cachedProjects.map((p) => p.vaultAddress);
  
  // No fallback to the retired crowdfunding contract: it emits none of the
  // topics handled below, so falling back to it produced an indexer that ran
  // successfully and silently indexed nothing.
  const factoryContractId = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID;
  if (!factoryContractId) {
    console.error("[Indexer] Factory Contract ID not found in environment variables!");
    return { success: false, error: "Factory Contract ID not set" };
  }

  const contractIds = [factoryContractId];
  for (const addr of vaultAddresses) {
    if (addr && !contractIds.includes(addr)) {
      contractIds.push(addr);
    }
  }

  console.log(`[Indexer] Indexing from ledger ${startLedger} for contracts:`, contractIds);

  const chunkArray = <T>(arr: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

  const contractChunks = chunkArray(contractIds, 5);
  const allEvents: any[] = [];

  for (const chunk of contractChunks) {
    try {
      const response = await rpcServer.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: chunk,
          },
        ],
        limit: 100,
      });
      if (response && response.events) {
        allEvents.push(...response.events);
      }
    } catch (err) {
      console.error(`[Indexer] getEvents RPC call failed for chunk ${chunk.join(", ")}:`, err);
      return { success: false, error: String(err) };
    }
  }

  // 4. Secondary reconciliation pass for raising projects that are past their deadlines
  try {
    const expiredRaisingProjects = await ProjectCache.find({
      status: "raising",
      fundingDeadline: { $lt: Date.now() },
    });

    if (expiredRaisingProjects.length > 0) {
      console.log(`[Indexer] Found ${expiredRaisingProjects.length} expired raising projects. Checking on-chain state...`);
      // Process up to 10 projects
      const toReconcile = expiredRaisingProjects.slice(0, 10);
      for (const project of toReconcile) {
        if (!project.vaultAddress) continue;
        try {
          const vaultClient = new VaultClient({
            contractId: project.vaultAddress,
            rpcUrl: SOROBAN_RPC_URL!,
            networkPassphrase: NETWORK_PASSPHRASE,
          });

          let liveState: number | undefined;
          try {
            const stateTx = await vaultClient.get_state();
            const stateRes = await stateTx.simulate();
            liveState = stateRes.result;
          } catch (stateErr) {
            console.warn(`[Indexer] Failed to query live state for ${project.projectId}:`, stateErr);
          }

          let info: any;
          try {
            const infoTx = await vaultClient.get_info();
            const infoRes = await infoTx.simulate();
            info = infoRes.result;
          } catch (infoErr) {
            console.warn(`[Indexer] Failed to query live info for ${project.projectId}:`, infoErr);
          }

          if (liveState !== undefined) {
            const statusMap: Record<number, string> = {
              0: "raising",
              1: "funded",
              2: "active",
              3: "failed",
              4: "refunding",
              5: "completed",
            };

            let mappedStatus = statusMap[liveState] || project.status;

            const updateDoc: any = { status: mappedStatus };

            if (info) {
              if (mappedStatus === "raising" && !info.bond_posted) {
                mappedStatus = "pending";
                updateDoc.status = mappedStatus;
              }

              updateDoc.currentFunding = Number(info.raised_amount) / 10_000_000;
              updateDoc.currentFundingRaw = info.raised_amount.toString();
              updateDoc.fundingGoal = Number(info.goal) / 10_000_000;
              updateDoc.fundingGoalRaw = info.goal.toString();
              updateDoc.fundingDeadline = Number(info.deadline) * 1000;
              updateDoc.bondPosted = info.bond_posted;
              updateDoc.bondAmount = Number(info.bond_amount) / 10_000_000;
              updateDoc.releasedTotal = Number(info.released_total) / 10_000_000;

              let milestones = project.milestones || [];
              if (info.milestones && info.milestones.length > 0) {
                milestones = (project.milestones || []).map((m: any) => {
                  const liveM = info.milestones.find((lm: any) => Number(lm.id) === m.id);
                  return {
                    ...m,
                    released: liveM ? liveM.released : m.released,
                    amount: liveM ? Number(liveM.amount) / 10_000_000 : m.amount,
                  };
                });
              }
              updateDoc.milestones = milestones;
            }

            console.log(`[Indexer] Reconciling stale status of project ${project.projectId} (${project.title}) to ${mappedStatus}`);
            await ProjectCache.findOneAndUpdate(
              { projectId: project.projectId },
              { $set: updateDoc }
            );
          }
        } catch (chainErr) {
          console.warn(`[Indexer] Failed to reconcile project ${project.projectId} from chain:`, chainErr);
        }
      }
    }
  } catch (err) {
    console.error("[Indexer] Error in secondary reconciliation pass:", err);
  }

  if (allEvents.length === 0) {
    console.log("[Indexer] No new events found.");
    return { success: true, count: 0 };
  }

  // Sort events lexicographically by id to preserve order of emission
  allEvents.sort((a, b) => a.id.localeCompare(b.id));

  let processedCount = 0;
  let maxLedgerSeen = startLedger - 1;

  for (const rawEvent of allEvents) {
    maxLedgerSeen = Math.max(maxLedgerSeen, rawEvent.ledger);

    // Skip if already processed
    const existing = await EventLog.findOne({ eventId: rawEvent.id });
    if (existing) {
      continue;
    }

    // Decode topics & value
    const topics = (rawEvent.topic || []).map((t: any) => scValToNative(t));
    const value = scValToNative(rawEvent.value as any);

    // Save event log
    await EventLog.create({
      eventId: rawEvent.id,
      ledger: rawEvent.ledger,
      ledgerClosedAt: rawEvent.ledgerClosedAt,
      contractId: rawEvent.contractId,
      topic1: String(topics[0] || ""),
      topic2: String(topics[1] || ""),
      data: JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v),
      processed: true,
    });

    const topic1 = String(topics[0] || "");
    const topic2 = String(topics[1] || "");

    // Process event
    try {
      if (topic1 === "FACTORY" && topic2 === "DEPLOY") {
        // value is array: [counter, vault_address, creator, metadata_cid]
        const [counterVal, vaultAddress, creator, metadataCid] = value;
        const projectId = String(counterVal);

        console.log(`[Indexer] Processing DEPLOY for Project ${projectId}, Vault: ${vaultAddress}`);

        // Fetch metadata from IPFS
        const metadata = await fetchMetadata(metadataCid) || {};

        const existing = await ProjectCache.findOne({
          $or: [{ projectId }, { vaultAddress }]
        });

        await ProjectCache.findOneAndUpdate(
          { $or: [{ projectId }, { vaultAddress }] },
          {
            projectId,
            vaultAddress,
            title: metadata.title || (existing?.title) || `Project #${projectId}`,
            tagline: metadata.tagline || (existing?.tagline) || "",
            description: metadata.description || (existing?.description) || "",
            category: metadata.category || (existing?.category) || "Blockchain",
            imageUrl: metadata.imageUrl || (existing?.imageUrl) || "",
            creator: metadata.creator || creator,
            creatorAddress: creator,
            creatorAvatar: metadata.creatorAvatar || (existing?.creatorAvatar) || "",
            status: existing?.status || "pending",
            fundingDeadline: Number(metadata.fundingDeadline || existing?.fundingDeadline || Date.now() + 30 * 24 * 3600 * 1000),
            fundingGoal: Number(metadata.fundingGoal || existing?.fundingGoal || 100),
            fundingGoalRaw: String(metadata.fundingGoalRaw || existing?.fundingGoalRaw || "0"),
            currencyType: metadata.currencyType || existing?.currencyType || "USDC",
            milestones: (metadata.milestones && metadata.milestones.length > 0)
              ? metadata.milestones.map((m: any) => ({
                  id: Number(m.id),
                  amount: Number(m.amount),
                  released: false,
                  title: m.title || `Milestone ${m.id}`,
                  description: m.description || "",
                }))
              : (existing?.milestones || []),
            createdAtOnChain: new Date(rawEvent.ledgerClosedAt || Date.now()),
            metadataCid,
            lastUpdatedLedger: rawEvent.ledger,
          },
          { upsert: true, new: true }
        );

      } else if (topic1 === "VAULT" && topic2 === "INIT") {
        // [project_id, metadata_cid]
        const [projIdVal, metadataCid] = Array.isArray(value) ? value : [value, ""];
        const projectId = String(projIdVal);
        
        await ProjectCache.findOneAndUpdate(
          { $or: [{ projectId }, { vaultAddress: rawEvent.contractId }] },
          { projectId, status: "pending", lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "BOND" && topic2 === "POSTED") {
        // [project_id, bond_amount]
        const [projIdVal, bondAmountVal] = value;
        const projectId = String(projIdVal);
        const bondAmount = Number(bondAmountVal) / 10_000_000; // Assuming 7 decimals

        await ProjectCache.findOneAndUpdate(
          { projectId },
          { bondPosted: true, bondAmount, status: "raising", lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "BOND" && topic2 === "RETURNED") {
        // [project_id, bond_amount]
        const [projIdVal, bondAmountVal] = value;
        const projectId = String(projIdVal);

        console.log(`[Indexer] Processing BOND RETURNED for Project ${projectId}, Amount: ${bondAmountVal}`);

        await ProjectCache.findOneAndUpdate(
          { projectId },
          { bondPosted: false, lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "DEPOSIT" && topic2 === "CONTRIB") {
        // [project_id, contributor, amount, raised_amount]
        const [projIdVal, contributor, amountVal, raisedAmountVal] = value;
        const projectId = String(projIdVal);

        const project = await ProjectCache.findOne({ projectId });
        const currency = project?.currencyType || "USDC";
        const currentFunding = Number(raisedAmountVal) / 10_000_000; // Normalizing 7 decimals

        await ProjectCache.findOneAndUpdate(
          { projectId },
          {
            currentFunding,
            currentFundingRaw: String(raisedAmountVal),
            lastUpdatedLedger: rawEvent.ledger,
          }
        );

      } else if (topic1 === "VAULT" && topic2 === "FUNDED") {
        const vaultAddress = rawEvent.contractId;
        await ProjectCache.findOneAndUpdate(
          { vaultAddress },
          { status: "funded", lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "VAULT" && topic2 === "FAILED") {
        const vaultAddress = rawEvent.contractId;
        await ProjectCache.findOneAndUpdate(
          { vaultAddress },
          { status: "failed", lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "MILESTN" && topic2 === "RELEASE") {
        // [project_id, milestone_id, tranche_amount]
        const [projIdVal, milestoneId, amountVal] = value;
        const projectId = String(projIdVal);

        const project = await ProjectCache.findOne({ projectId });
        if (project) {
          const milestones = project.milestones.map((m) => {
            if (m.id === Number(milestoneId)) {
              return { ...m, released: true };
            }
            return m;
          });

          const releasedTotal = project.releasedTotal + Number(amountVal) / 10_000_000;
          const allReleased = milestones.every((m) => m.released);
          const nextStatus = allReleased ? "completed" : "active";

          await ProjectCache.findOneAndUpdate(
            { projectId },
            {
              status: nextStatus,
              milestones,
              releasedTotal,
              lastUpdatedLedger: rawEvent.ledger,
            }
          );
        }

      } else if (topic1 === "BOND" && topic2 === "SLASHED") {
        const vaultAddress = rawEvent.contractId;
        await ProjectCache.findOneAndUpdate(
          { vaultAddress },
          { status: "refunding", lastUpdatedLedger: rawEvent.ledger }
        );

      } else if (topic1 === "DEPOSIT" && topic2 === "REFUND") {
        // [project_id, contributor, refund_total]
        const [projIdVal, contributor, refundTotalVal] = value;
        const projectId = String(projIdVal);

        console.log(`[Indexer] Processing REFUND for Project ${projectId}, Contributor: ${contributor}, Refund Total: ${refundTotalVal}`);

        // Find all CONTRIB event logs for this project and contributor to sum the contribution amount
        const matcher = addressMatcher(String(contributor));
        if (!matcher) {
          console.warn(`[Indexer] REFUND event carried a malformed contributor address: ${contributor}`);
          continue;
        }
        const contribLogs = await EventLog.find({
          topic1: "DEPOSIT",
          topic2: "CONTRIB",
          data: { $regex: matcher }
        }).lean();

        let totalContributed = BigInt(0);
        for (const log of contribLogs) {
          try {
            const parsed = JSON.parse(log.data);
            if (Array.isArray(parsed) && parsed.length >= 3) {
              const [logProjIdVal, logContributor, amountVal] = parsed;
              if (String(logProjIdVal) === projectId && String(logContributor).toLowerCase() === String(contributor).toLowerCase()) {
                totalContributed += BigInt(amountVal);
              }
            }
          } catch (e) {
            console.error("Failed to parse log data inside event-indexer REFUND handler:", e);
          }
        }

        let contributionVal = totalContributed;
        if (contributionVal === BigInt(0)) {
          // Fallback: estimate from refund_total (refund_total = contribution * 1.03 in Failed state)
          contributionVal = (BigInt(refundTotalVal) * BigInt(100)) / BigInt(103);
        }

        const project = await ProjectCache.findOne({ projectId });
        if (project) {
          const currentRaw = BigInt(project.currentFundingRaw || "0");
          const newRaw = currentRaw > contributionVal ? currentRaw - contributionVal : BigInt(0);
          const currentFunding = Number(newRaw) / 10_000_000;

          await ProjectCache.findOneAndUpdate(
            { projectId },
            {
              currentFunding,
              currentFundingRaw: String(newRaw),
              lastUpdatedLedger: rawEvent.ledger,
            }
          );
        }
      }
    } catch (processErr) {
      console.error(`Error processing event ${rawEvent.id}:`, processErr);
    }

    processedCount++;
  }

  // 3. Update state with maximum ledger sequence seen
  if (state && maxLedgerSeen >= startLedger) {
    state.value = maxLedgerSeen;
    await state.save();
  }

  console.log(`[Indexer] Sync loop complete. Processed ${processedCount} events. New ledger height: ${maxLedgerSeen}`);
  return { success: true, count: processedCount, currentLedger: maxLedgerSeen };
}
