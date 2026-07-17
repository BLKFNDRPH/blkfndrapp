import mongoose, { Schema, Document, Model } from "mongoose";

export interface IClaimRequest extends Document {
  projectId: string;
  requestedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClaimRequestSchema = new Schema<IClaimRequest>(
  {
    projectId: { type: String, required: true, unique: true, index: true },
    requestedBy: { type: String, required: true },
  },
  { timestamps: true }
);

const ClaimRequest: Model<IClaimRequest> =
  mongoose.models.ClaimRequest ||
  mongoose.model<IClaimRequest>("ClaimRequest", ClaimRequestSchema);

export default ClaimRequest;
