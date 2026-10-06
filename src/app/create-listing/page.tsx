
import { ListingForm } from '@/components/create/ListingForm';

export default async function CreateListingPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-12">
      <div className="mx-auto mb-8 max-w-3xl space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">Open a vault for your project</h1>
        <p className="text-muted-foreground text-lg">
          Your project gets its own vault. You lock a deposit in it, people stake, and stakeholders vote
          on each payout.
        </p>
      </div>
      <ListingForm />
    </div>
  );
}
