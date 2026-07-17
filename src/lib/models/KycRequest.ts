import mongoose, { Schema, Document, Model } from "mongoose";

export interface IKycRequest extends Document {
  address: string;
  fullName: string;
  email: string;
  documentType: string;
  documentImage: string; // IPFS CID or URL
  detailsHash: string; // SHA-256 hex string
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  idNumber?: string;
  dob?: Date;
  expiryDate?: Date;
  residentialAddress?: string;
  consentFlag?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const KycRequestSchema = new Schema<IKycRequest>(
  {
    address: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    documentType: { type: String, required: true },
    documentImage: { type: String, required: true },
    detailsHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, default: "" },
    idNumber: { type: String },
    dob: { type: Date },
    expiryDate: { type: Date },
    residentialAddress: { type: String },
    consentFlag: { type: Boolean },
  },
  { timestamps: true }
);

const KycRequest: Model<IKycRequest> = mongoose.models.KycRequest || mongoose.model<IKycRequest>("KycRequest", KycRequestSchema);

export default KycRequest;
