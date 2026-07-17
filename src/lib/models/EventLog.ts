import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEventLog extends Document {
  eventId: string; // unique ID format: ledger-txHash-index
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic1: string; // e.g. "FACTORY", "DEPOSIT", etc.
  topic2: string; // e.g. "DEPLOY", "CONTRIB", etc.
  data: string; // JSON serialized event data string
  processed: boolean;
}

const EventLogSchema = new Schema<IEventLog>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    ledger: { type: Number, required: true, index: true },
    ledgerClosedAt: { type: String },
    contractId: { type: String, required: true, index: true },
    topic1: { type: String, required: true, index: true },
    topic2: { type: String, required: true, index: true },
    data: { type: String, required: true },
    processed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const EventLog: Model<IEventLog> =
  mongoose.models.EventLog ||
  mongoose.model<IEventLog>("EventLog", EventLogSchema);

export default EventLog;
