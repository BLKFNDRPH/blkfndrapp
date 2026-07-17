
import { ListingForm } from '@/components/create/ListingForm';
import { StellarLogo } from '@/components/layout/StellarLogo';
export default async function CreateListingPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12">
      <div className="space-y-4 mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">Create a New Project</h1>
        <p className="text-muted-foreground text-lg">
          Bring your idea to life on the <span className="inline-flex items-baseline gap-1"><StellarLogo className="h-5 w-5" /> Stellar</span> blockchain. Fill out the details below to get started.
        </p>
      </div>
      <ListingForm />
    </div>
  );
}
