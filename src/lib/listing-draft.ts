/**
 * A builder's unfinished listing, kept in this browser so that leaving the
 * page -- to verify their identity, to set up a wallet, or by a reload -- does
 * not throw the work away. The identity check used to send a builder off the
 * form mid-launch with everything they had typed lost.
 *
 * Local only: nothing here reaches BLKFNDR until the vault opens, and the
 * copy says "saved in this browser", not "saved to your account".
 *
 * One draft per account, so on a shared computer one person never sees
 * another's (QA Cycle 7, BF-113). A draft typed while signed out is kept under
 * no one and becomes the account's that signs in next on this browser: the
 * form sends a signed-out builder to sign in, and their work should come with
 * them. Signing out clears every draft in the browser.
 */

/** Signed out, and every draft before drafts were per account. */
const SIGNED_OUT_KEY = "blkfndr:listing-draft";

const keyFor = (uid: string | null) => (uid ? `${SIGNED_OUT_KEY}:${uid}` : SIGNED_OUT_KEY);

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

function read(key: string): ListingDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ListingDraft;
    return draft?.v === 1 ? draft : null;
  } catch {
    return null;
  }
}

/**
 * The draft for this account, or for a signed-out visitor when `uid` is null.
 * An account takes over a draft typed while signed out, when that is newer
 * than its own.
 */
export function loadDraft(uid: string | null): ListingDraft | null {
  const own = read(keyFor(uid));
  if (!uid) return own;
  const signedOut = read(SIGNED_OUT_KEY);
  if (!signedOut || (own && own.savedAt >= signedOut.savedAt)) return own;
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(signedOut));
    window.localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Storage blocked: offer it anyway; the next save writes it under the account.
  }
  return signedOut;
}

/** Save the draft; returns whether its picture was kept. */
export function saveDraft(draft: ListingDraft, uid: string | null): boolean {
  const key = keyFor(uid);
  const withImage = draft.image && draft.image.dataUri.length <= MAX_IMAGE_CHARS ? draft : { ...draft, image: undefined };
  try {
    window.localStorage.setItem(key, JSON.stringify(withImage));
    return Boolean(withImage.image);
  } catch {
    // Storage full or blocked: try once more without the picture.
    try {
      window.localStorage.setItem(key, JSON.stringify({ ...draft, image: undefined }));
    } catch {
      // Private mode or storage disabled; the form still works, unsaved.
    }
    return false;
  }
}

export function clearDraft(uid: string | null): void {
  try {
    window.localStorage.removeItem(keyFor(uid));
  } catch {
    // Nothing to clear.
  }
}

/**
 * Every listing draft in this browser, gone: on signing out, so the next
 * person on a shared computer starts with an empty form.
 */
export function clearAllDrafts(): void {
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === SIGNED_OUT_KEY || key?.startsWith(`${SIGNED_OUT_KEY}:`)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Storage blocked: nothing was kept.
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
