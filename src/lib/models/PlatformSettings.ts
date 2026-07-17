import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPlatformSettings extends Document {
  feeWalletEmail: string;
}

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    feeWalletEmail: { type: String, default: "admin@blkfndr.com" },
  },
  { timestamps: true }
);

const PlatformSettings: Model<IPlatformSettings> =
  mongoose.models.PlatformSettings || mongoose.model<IPlatformSettings>("PlatformSettings", PlatformSettingsSchema);

export default PlatformSettings;
