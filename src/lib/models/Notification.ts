import mongoose, { Schema, Document, Model } from 'mongoose';

export interface INotification extends Document {
  userId: string;
  title: string;
  caption: string;
  timestamp: number;
  isRead: boolean;
  url: string | null;
  object: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    caption: { type: String, default: '' },
    timestamp: { type: Number, default: () => Date.now() },
    isRead: { type: Boolean, default: false },
    url: { type: String, default: null },
    object: { type: String, default: null },
  },
  { timestamps: true }
);

const Notification: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>('Notification', NotificationSchema);

export default Notification;