import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAuthChallenge extends Document {
  publicKey: string;
  nonce: string;
  createdAt: Date;
}

const AuthChallengeSchema = new Schema<IAuthChallenge>({
  publicKey: { type: String, required: true, unique: true, index: true },
  nonce: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 }, // Expires in 5 minutes
});

const AuthChallenge: Model<IAuthChallenge> =
  mongoose.models.AuthChallenge || mongoose.model<IAuthChallenge>("AuthChallenge", AuthChallengeSchema);

export default AuthChallenge;
