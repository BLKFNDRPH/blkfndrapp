import { test } from "node:test";
import assert from "node:assert/strict";
import { listingTextProblems, looksLikeMash, textProblem } from "./listing-quality.ts";

test("the QA Cycle 7 title and tagline are caught (BF-117)", () => {
  assert.match(textProblem("title", "dwxaqsxwdfq")!, /doesn't read as words/);
  assert.match(textProblem("tagline", "gtrweunjr")!, /doesn't read as words/);
});

// Every title and tagline on the live testnet registry on 14 Oct 2026, except
// the one that repeats itself (below). None may be flagged.
const LIVE_TITLES = [
  "Project #1",
  "Helios-1: Community Micro-Grid Expansion",
  "Me Comida Restaurant and Bakeshop Improvements",
  "Mi Comida Resto Improvements",
  "AquaPure: Community Water Filtration Hub",
  "AgriTech: Autonomous Solar Irrigation Arrays",
  "AquaPure: Solar-Powered Modular Micro Filtration & Clean Drinking Water",
  "AquaPure 2: Solar-Powered Clean Water Hubs",
  "Ready Rangers",
  "RiverWatch Pangasinan: IoT Ultrasonic Flood Sentinels",
  "Municipal Knowledge Vault AI",
  "AquaSense: Real-Time Aquaculture Water Quality & SMS Alert Hub",
  "AGRIROVER: Autonomous Multipurpose Rover for Smart and Efficient Farm Operations",
  "B.R.A.I.N.S.: Plastic-to-Pavement Micro-Infrastructure",
  "Culture Shocked: A Virtual Reality Museum of Filipino Cultures and Heritages",
  "Biyahe Diaries",
  "PaperLine Client Portal",
  "AniDry - Smart Hybrid Rice Dryer",
  "TransitMesh AI: Decentralized Public Transit Telemetry & Autonomous Routing",
];
const LIVE_TAGLINES = [
  "Deploying clean solar power and battery storage for resilient off-grid communities.",
  "We serve memories",
  "Deploying solar-powered micro-desalination units for coastal communities.",
  "Smart, solar-powered drip irrigation for smallholder farming communities.",
  "Compact, modular edge computing board for environmental sensing and IoT mesh networks.",
  "Off-grid clean drinking water for coastal island communities.",
  "Free co-op typhoon survival game that teaches kids aged 7 to 10 how to prepare and stay safe.",
  "Solar-powered ultrasonic bridge sentinels broadcasting live river flood warnings via SMS.",
  "An AI digital knowledge hub that makes municipal services easier to access for every resident.",
  "IoT sensor buoys and real-time SMS alerts preventing fish kills for local fishpond growers.",
  "Farm Smarter. Work Faster. Grow Better.",
  "Empowering residents to clean streets for digital payouts, transforming plastic into infrastructure.",
  "POV: You just stepped into history.",
  "A community hub for Filipino commuters and transport workers to share, connect, and travel smarter",
  "Secure documents submission and client request management platform.",
  "Dry Smarter. Save More. Protect Every Harvest.",
  "Verifiable real-time transit telemetry and dynamic route optimization for growing metropolitan regio",
];

test("no live listing is flagged", () => {
  for (const t of LIVE_TITLES) assert.equal(textProblem("title", t), null, t);
  for (const t of LIVE_TAGLINES) assert.equal(textProblem("tagline", t), null, t);
});

test("a title pasted in twice is caught, as one on the live registry was (BF-078)", () => {
  assert.match(
    textProblem("title", "OpenNode: Open-Source IoT Edge Gateway OpenNode: Open-Source IoT Edge Gateway")!,
    /repeats itself/,
  );
});

test("Filipino and other non-English words pass", () => {
  for (const t of [
    "Bayanihan Solar sa Barangay Malinis",
    "Pagkain para sa Lahat: Community Kitchen",
    "Tubig at Kuryente para sa Isla",
    "Mga Batang Mangingisda",
    "Kōhanga Reo Whakatāne",
    "Ngozi's Bakery in Enugu",
    "Strengths-Based Tutoring for Rhythm and Music",
  ]) {
    assert.equal(textProblem("title", t), null, t);
  }
});

test("placeholder text and held-down keys are caught", () => {
  for (const t of ["test", "Test test", "asdf", "Lorem ipsum dolor sit amet", "TBD", "Soooooolar pump"]) {
    assert.ok(textProblem("title", t), t);
  }
});

test("keyboard runs are mash", () => {
  assert.equal(looksLikeMash("asdfgh"), true);
  assert.equal(looksLikeMash("qwerty"), true);
  assert.equal(looksLikeMash("Pangasinan"), false);
  assert.equal(looksLikeMash("BRAINS"), false);
});

test("one odd word among real ones is not enough", () => {
  assert.equal(textProblem("title", "Solar pump for the Brgy Xkcdq market garden"), null);
});

test("a description is judged on the whole, and may repeat a phrase", () => {
  const description =
    "We will install a solar pump for the market garden. Stage one buys the pump; stage two installs it. " +
    "Stakeholders can check progress through photos. Stage one buys the pump, as above.";
  assert.equal(textProblem("description", description), null);
  assert.ok(textProblem("description", "sdfkj wqerlkj zxcvmn qwpoeiru dsfkjhw"));
  assert.equal(textProblem("description", "Stay tuned.... more soon ---- really"), null);
});

test("a description pasted in more than once is caught, as three live ones were", () => {
  const once =
    "OpenNode is an open-source development board engineered for industrial and agricultural IoT deployments, " +
    "with built-in LoRa communication and low-power telemetry sensors.";
  assert.equal(textProblem("description", once), null);
  assert.match(textProblem("description", `${once} ${once}`)!, /repeats itself/);
});

test("listingTextProblems reports each field", () => {
  const problems = listingTextProblems({ title: "dwxaqsxwdfq", tagline: "gtrweunjr", description: "" });
  assert.deepEqual(
    problems.map((p) => p.field),
    ["title", "tagline"],
  );
});
