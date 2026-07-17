import mongoose, { Schema, Document, Model } from "mongoose";

export interface IIndexerState extends Document {
  key: string; // e.g., "last_processed_ledger"
  value: number;
}

const IndexerStateSchema = new Schema<IIndexerState>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Number, required: true },
  },
  { timestamps: true }
);

const IndexerState: Model<IIndexerState> =
  mongoose.models.IndexerState ||
  mongoose.model<IIndexerState>("IndexerState", IndexerStateSchema);

export default IndexerState;
