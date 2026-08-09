# Crypto File Storage Migration: Tusky to Pinata

## Migration Summary

This document outlines the migration from Tusky to Pinata for file storage in the blkfndr project.

## What Changed

### Files Modified
1. **`src/components/create/ListingForm.tsx`** — Updated to use Pinata for image uploads
2. **`src/components/create/ProjectEditForm.tsx`** — Updated to use Pinata for image uploads
3. **`src/components/project/ProjectEditForm.tsx`** — Updated to use Pinata for image uploads
4. **`src/app/testing/page.tsx`** — Updated to use Pinata for testing file uploads

### Files Created
1. **`src/lib/pinata-client.ts`** — New Pinata client utility module with:
   - `PinataClient` class for handling file uploads
   - `getPinataClient()` helper function
   - `getPublicUrl()` static method for constructing gateway URLs

## Key Differences from Tusky

### Upload Flow
- **Tusky**: Required uploading file, getting uploadId, then polling for blobId until it became available (async processing)
- **Pinata**: Returns IPFS hash immediately upon successful upload

### URL Format
- **Tusky**: `https://walrus.tusky.io/{blobId}`
- **Pinata**: `https://gateway.pinata.cloud/ipfs/{ipfsHash}`

### Environment Variables
Replace Tusky environment variables with Pinata credentials:

**Remove:**
- `NEXT_PUBLIC_TUSKY_VAULT_ID`
- `NEXT_PUBLIC_TUSKY_API_KEY`

**Add to `.env.local`** — server-side only. Never prefix a Pinata credential
with `NEXT_PUBLIC_`: that inlines it into the browser bundle at build time and
lets anyone pin to the platform's paid account. The live code reads a server-side
`PINATA_JWT` (fetched from Supabase Vault); see [deployment.md](deployment.md).
```bash
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY_URL=your_dedicated_gateway_host
```

## Next Steps

### 1. Remove Tusky Dependency
```bash
npm uninstall @tusky-io/ts-sdk
```

### 2. Install Pinata SDK (if not already installed)
```bash
npm install pinata --save
```

### 3. Configure Pinata Credentials
1. Go to [Pinata Cloud](https://app.pinata.cloud/)
2. Create an API key with file upload permissions
3. Get your API key and secret
4. Add to your environment variables (server-side only — not `NEXT_PUBLIC_`):
   ```bash
   PINATA_JWT=your_jwt_here
   ```

### 4. Update Database/Records (if needed)
If there are any existing records storing image URLs with the old Tusky format, consider:
- Migrating images to Pinata
- Updating URL references
- Or keeping the old URLs if they still work

## Technical Details

### Pinata Client Implementation
The new `PinataClient` class provides:
- **`uploadFile(file: File)`**: Uploads a file and returns IPFS hash
- **`getPublicUrl(ipfsHash)`**: Constructs the public gateway URL

### Error Handling
- Validates environment variables on initialization
- Throws descriptive errors if credentials are missing
- Handles upload failures with user-friendly toast messages

### Integration Points
All image uploads now go through:
1. File selection
2. Pinata upload to get IPFS hash
3. Hash stored on-chain or in database
4. Hash resolved to gateway URL for display

## Migration Notes
- The polling mechanism is simplified since Pinata returns the hash immediately
- Max attempts and interval are kept in the code for potential future use
- All error messages have been updated to reference Pinata instead of Tusky
- Cooldown mechanism (5 seconds between uploads) remains unchanged

## Testing
Use the admin testing page at `/testing` to verify image uploads work correctly with Pinata.