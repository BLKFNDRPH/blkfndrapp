import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  uid: string;
  email: string;
  name: string;
  creatorAvatar: string;
  role: "user" | "admin";
  wallet: "connected" | "disconnected";
  stellarPublicKey: string;
  lastLogin: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String },
    name: { type: String, default: "Anonymous" },
    creatorAvatar: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    wallet: {
      type: String,
      enum: ["connected", "disconnected"],
      default: "disconnected",
    },
    stellarPublicKey: { type: String, index: true },
    lastLogin: { type: String },
  },
  { timestamps: true },
);

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;