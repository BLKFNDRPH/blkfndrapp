"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AlertTriangle, ImagePlus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CubeSpinner } from "@/components/ui/CubeSpinner";
import { submitMilestoneProof } from "@/app/actions";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";

/**
 * Delivery proof, one per milestone: what the builder says was done, and
 * optionally a photo of it. Stakeholders read it before they vote on that
 * milestone's release, so it lives in the milestone's own card rather than in
 * one form that could only ever reach the first unreleased milestone.
 */

export interface MilestoneProof {
  description: string;
  imageUrl: string;
}

// Only https images are shown or linked; anything else the builder typed in is
// dropped rather than handed to an href.
function httpsUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

/**
 * A proof is JSON {description, imageUrl} since images could be attached, and
 * plain text before that. The builder writes it, so neither field is trusted
 * to be a string: an object here would crash the dialog when rendered. Null
 * when there is nothing to show.
 */
export function parseProof(raw: string | undefined): MilestoneProof | null {
  const value = raw?.trim();
  if (!value) return null;

  let proof: MilestoneProof = { description: value, imageUrl: "" };
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      proof = {
        description: typeof parsed.description === "string" ? parsed.description.trim() : "",
        imageUrl: httpsUrl(parsed.imageUrl),
      };
    } catch { }
  }
  return proof.description || proof.imageUrl ? proof : null;
}

interface MilestoneProofViewProps {
  milestoneId: number;
  proof: MilestoneProof | null;
  /** Paid out already, so a missing proof is final rather than still to come. */
  released: boolean;
  /** The builder's controls, when the viewer is the builder. */
  children?: ReactNode;
}

/** A milestone's proof as stakeholders see it, inside the milestone's card. */
export function MilestoneProofView({
  milestoneId,
  proof,
  released,
  children,
}: MilestoneProofViewProps) {
  return (
    <div className="mt-3 space-y-2 rounded-md border border-dashed p-3">
      <h6 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Proof from the builder
      </h6>
      {proof ? (
        <>
          {proof.description && (
            <p className="whitespace-pre-wrap break-words text-sm">{proof.description}</p>
          )}
          {proof.imageUrl && (
            <a
              href={proof.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proof.imageUrl}
                alt={`Photo posted as proof for milestone ${milestoneId}`}
                loading="lazy"
                className="max-h-64 rounded-md border object-contain"
              />
              <span className="sr-only"> (opens full size in a new tab)</span>
            </a>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {released ? "No proof was posted for this milestone." : "No proof posted yet."}
        </p>
      )}
      {children}
    </div>
  );
}

// Kept in step with /api/upload-image, which checks the same limits again.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_DESCRIPTION = 2000;
// setMilestoneProof refuses a stored proof longer than this.
const MAX_PROOF_LENGTH = 4000;
// A gateway address is under 100 characters; this leaves room for one.
const PHOTO_URL_ROOM = 200;

// The upload route and the auth guards answer in status words. Neither is
// fixed by trying again.
const STATUS_WORDS: Record<string, string> = {
  Unauthorized: "You're signed out. Sign in again, then save your proof.",
  Forbidden: "Only the account linked to this project's builder wallet can post its proof.",
};

function explain(error: unknown): { reason: string; retry: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  return message in STATUS_WORDS
    ? { reason: STATUS_WORDS[message], retry: false }
    : { reason: message, retry: true };
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A local preview of the chosen photo, released when it changes. */
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export interface ProofMilestone {
  id: number;
  title?: string;
  amount: number;
  proof?: string;
}

interface MilestoneProofDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The milestone being proven. The form reads its saved proof once, when it
   * mounts, so give the dialog a fresh `key` each time it opens.
   */
  milestone: ProofMilestone | null;
  vaultAddress: string;
  projectTitle: string;
  currency: string;
  /** The proof as stored, once the server has accepted it. */
  onSaved: (milestoneId: number, proof: string) => void;
  /**
   * The button that opened the form. Radix hands focus back to a
   * DialogTrigger, and this dialog has none, so without it keyboard focus
   * would land on the project dialog rather than where the builder was.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

type FormError = { title: string; detail?: string };

/** The builder's form for one milestone's proof. */
export function MilestoneProofDialog({
  open,
  onOpenChange,
  milestone,
  vaultAddress,
  projectTitle,
  currency,
  onSaved,
  returnFocusRef,
}: MilestoneProofDialogProps) {
  const saved = parseProof(milestone?.proof);
  // Fixed when the form opens, so the title doesn't flip while it closes on
  // the proof it just saved.
  const [editing] = useState(saved !== null);
  const [description, setDescription] = useState(saved?.description ?? "");
  const [keepSavedPhoto, setKeepSavedPhoto] = useState(Boolean(saved?.imageUrl));
  const [photo, setPhoto] = useState<File | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "saving">("idle");
  const previewUrl = useObjectUrl(photo);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const busy = step !== "idle";
  const shownPhoto = photo ? previewUrl : keepSavedPhoto ? saved?.imageUrl : null;

  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again after an error still fires.
    event.target.value = "";
    if (!file) return;
    setFormError(null);

    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError("That file isn't a PNG, JPEG, WebP or GIF image. Choose another.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`That photo is ${fileSize(file.size)}. Choose one of 8 MB or less.`);
      return;
    }
    setPhotoError(null);
    setPhoto(file);
    setKeepSavedPhoto(false);
  };

  const removePhoto = () => {
    setPhoto(null);
    setKeepSavedPhoto(false);
    setPhotoError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!milestone || busy) return;
    setFormError(null);

    const text = description.trim();
    if (!text) {
      setDescriptionError("Describe what you delivered for this milestone.");
      descriptionRef.current?.focus();
      return;
    }

    // The stored proof is JSON with a length cap, so check the size before
    // anything is uploaded, leaving room for the photo's address.
    let imageUrl = !photo && keepSavedPhoto ? saved?.imageUrl ?? "" : "";
    const reserved = photo ? PHOTO_URL_ROOM : imageUrl.length;
    if (JSON.stringify({ description: text, imageUrl: "" }).length + reserved > MAX_PROOF_LENGTH) {
      setDescriptionError("This is too long to save. Shorten the description and try again.");
      descriptionRef.current?.focus();
      return;
    }
    setDescriptionError(null);

    if (photo) {
      setStep("uploading");
      try {
        imageUrl = getIPFSGatewayUrl(await getPinataClient().uploadFile(photo));
      } catch (error) {
        const { reason, retry } = explain(error);
        setStep("idle");
        setFormError({
          title: "The photo didn't upload, so nothing was saved.",
          detail: retry
            ? `${reason} Try again, or remove the photo to save the description on its own.`
            : reason,
        });
        return;
      }
    }

    const proof = JSON.stringify({ description: text, imageUrl });
    setStep("saving");
    try {
      const result = await submitMilestoneProof(vaultAddress, milestone.id, proof);
      if (!result.success) {
        setStep("idle");
        setFormError({ title: "Your proof wasn't saved.", detail: explain(result.error).reason });
        return;
      }
    } catch (error) {
      setStep("idle");
      setFormError({ title: "Your proof wasn't saved.", detail: explain(error).reason });
      return;
    }

    setStep("idle");
    onSaved(milestone.id, proof);
  };

  const heading = milestone
    ? `Milestone ${milestone.id}${milestone.title?.trim() ? `: ${milestone.title.trim()}` : ""}`
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // An upload or save in flight finishes before the form can go away.
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto rounded-2xl sm:w-full"
        onCloseAutoFocus={(event) => {
          const opener = returnFocusRef?.current;
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-headline text-lg font-bold">
            {editing ? "Edit proof" : "Add proof"}
            {milestone && ` for milestone ${milestone.id}`}
          </DialogTitle>
          <DialogDescription>
            Stakeholders see this in the milestone&apos;s card when they vote on
            releasing its funds.
          </DialogDescription>
        </DialogHeader>

        {milestone && (
          <form id={`${id}-form`} onSubmit={submit} noValidate className="space-y-5">
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="break-words font-semibold">{heading}</p>
              <p className="text-muted-foreground">
                {milestone.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                {currency} · <span className="break-words">{projectTitle}</span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-description`}>
                What did you deliver?{" "}
                <span className="font-normal text-muted-foreground">(required)</span>
              </Label>
              <p id={`${id}-description-help`} className="text-sm text-muted-foreground">
                Describe the finished work in plain words, with anything
                stakeholders can check for themselves.
              </p>
              <Textarea
                id={`${id}-description`}
                ref={descriptionRef}
                rows={5}
                required
                maxLength={MAX_DESCRIPTION}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (descriptionError) setDescriptionError(null);
                }}
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={[
                  `${id}-description-help`,
                  descriptionError ? `${id}-description-error` : "",
                  `${id}-description-count`,
                ].filter(Boolean).join(" ")}
                disabled={busy}
                className="resize-y aria-[invalid=true]:border-destructive"
              />
              <div className="flex items-start justify-between gap-3 text-sm">
                <p id={`${id}-description-error`} className="font-medium text-destructive">
                  {descriptionError}
                </p>
                <p id={`${id}-description-count`} className="shrink-0 text-muted-foreground">
                  {description.length} of {MAX_DESCRIPTION} characters
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p id={`${id}-photo-label`} className="text-sm font-medium leading-none">
                Photo <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <p id={`${id}-photo-help`} className="text-sm text-muted-foreground">
                PNG, JPEG, WebP or GIF, up to 8 MB.
              </p>

              {shownPhoto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shownPhoto}
                  alt={photo ? `Selected photo: ${photo.name}` : "The photo saved with this proof"}
                  className="max-h-48 rounded-md border object-contain"
                />
              )}

              {/* Opened by the button below, which carries the label. Kept
                  rendered rather than display:none, which some mobile
                  browsers refuse to open a picker for. */}
              <input
                ref={photoInputRef}
                type="file"
                accept={PHOTO_TYPES.join(",")}
                onChange={choosePhoto}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => photoInputRef.current?.click()}
                  aria-describedby={[
                    `${id}-photo-label`,
                    `${id}-photo-help`,
                    photoError ? `${id}-photo-error` : "",
                  ].filter(Boolean).join(" ")}
                >
                  <ImagePlus aria-hidden="true" />
                  {shownPhoto ? "Replace photo" : "Add a photo"}
                </Button>
                {shownPhoto && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={removePhoto}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove photo
                  </Button>
                )}
              </div>
              {photo && (
                <p className="break-all text-sm text-muted-foreground">
                  {photo.name} · {fileSize(photo.size)}, uploaded when you save.
                </p>
              )}
              <p id={`${id}-photo-error`} role="alert" className="text-sm font-medium text-destructive">
                {photoError}
              </p>
            </div>

            <div role="alert">
              {formError && (
                <div className="flex gap-2 rounded-lg border border-destructive/50 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-semibold text-destructive">{formError.title}</p>
                    {formError.detail && <p className="break-words">{formError.detail}</p>}
                  </div>
                </div>
              )}
            </div>
          </form>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={busy || !milestone}>
            {busy && <CubeSpinner size="small" />}
            {step === "uploading" ? "Uploading photo…" : step === "saving" ? "Saving…" : "Save proof"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
