"use client";

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { PlusSquare } from 'lucide-react';
import Link from 'next/link';

export function CreateListingButton({ className, onAfterClick }: { className?: string; onAfterClick?: () => void; }) {
  const { user, login, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleCreateClick = () => {
    if (user) {
      router.push('/create-listing');
    } else {
      login();
    }
    if (onAfterClick) {
        onAfterClick();
    }
  };
  
  const isActive = pathname === '/create-listing';

  // This is for the hamburger menu
  if (className?.includes('text-lg')) {
    return (
      <button
        onClick={handleCreateClick}
        disabled={loading}
        className={cn(
          "flex items-center w-full",
          className
        )}
      >
        <PlusSquare />
        <span>Create</span>
      </button>
    );
  }
  
  // This is for the main nav (hidden for now)
  return (
    <Button
      onClick={handleCreateClick}
      disabled={loading}
      variant={isActive ? "secondary" : "ghost"}
      className={cn(
        "transition-colors text-sm",
        !isActive && "text-foreground/60",
        className
      )}
    >
      Create
    </Button>
  );
}
