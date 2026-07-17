const mongoose = require("mongoose");
require("dotenv").config({ path: ".env.local" });
const MONGODB_URI = process.env.MONGODB_URI;

async function check() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const users = await db.collection("users").find({}).toArray();
  for (const u of users) {
    if (u.name?.includes("Clarence") || u.zkLoginAddress?.includes("0x2f95") || u.autoAddress?.includes("0x2f95") || u.activeSlushAddress?.includes("0x2f95")) {
      console.log("Found user:", u);
    }
  }
  process.exit(0);
}
check();
