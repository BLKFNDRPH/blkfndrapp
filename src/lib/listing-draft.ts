/**
 * A builder's unfinished listing, kept in this browser so that leaving the
 * page -- to verify their identity, to set up a wallet, or by a reload -- does
 * not throw the work away. The identity check used to send a builder off the
 * form mid-launch with everything they had typed lost.
 *
 * Local only: nothing here reaches BLKFNDR until the vault opens, and the
 * copy says "saved in this browser", not "saved to your account".
 */

const KEY = "blkfndr:listing-draft";

/** A picture larger than this, as text, is left out rather than crowding out the rest. */
const MAX_IMAGE_CHARS = 2_000_000;

export interface ListingDraft {
  v: 1;
  savedAt: number;
  values: {
    title: string;
    tagline: string;
    description: string;
    category: string;
    location: string;
    currencyType: string;
    /** Epoch ms, or null when the field was empty or half-typed. */
    fundingDeadline: number | null;
  };
  deadlineInput: string;
  stages: { id: number; title: string; description: string; amount: number }[];
  deposit: { kind: "min" } | { kind: "pct"; pct: number } | { kind: "amount"; amount: string };
  image?: { name: string; type: string; lastModified: number; dataUri: string };
}

export function loadDraft(): ListingDraft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ListingDraft;
    return draft?.v === 1 ? draft : null;
  } catch {
    return null;
  }
}

/** Save the draft; returns whether its picture was kept. */
export function saveDraft(draft: ListingDraft): boolean {
  const withImage = draft.image && draft.image.dataUri.length <= MAX_IMAGE_CHARS ? draft : { ...draft, image: undefined };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(withImage));
    return Boolean(withImage.image);
  } catch {
    // Storage full or blocked: try once more without the picture.
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...draft, image: undefined }));
    } catch {
      // Private mode or storage disabled; the form still works, unsaved.
    }
    return false;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** A draft worth offering back: something was typed. */
export function draftHasContent(draft: ListingDraft): boolean {
  const v = draft.values;
  return Boolean(
    v.title.trim() ||
      v.tagline.trim() ||
      v.description.trim() ||
      v.location.trim() ||
      draft.image ||
      draft.stages.some((s) => s.title.trim() || s.description.trim() || s.amount > 0),
  );
}

/** The saved picture as a FileList an <input type="file"> and the form accept. */
export async function draftImageFiles(image: NonNullable<ListingDraft["image"]>): Promise<FileList | null> {
  try {
    const blob = await (await fetch(image.dataUri)).blob();
    const file = new File([blob], image.name, { type: image.type, lastModified: image.lastModified });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer.files;
  } catch {
    return null;
  }
}
