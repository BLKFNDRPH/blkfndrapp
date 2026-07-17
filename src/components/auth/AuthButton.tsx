"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, User as UserIcon, Settings, Cog } from "lucide-react";
import Link from "next/link";
import { CubeSpinner } from "../ui/CubeSpinner";

export function AuthButton() {
  const { user, login, logout, loading } = useAuth();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const handleRippleEffect = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget as HTMLElement;
    let ripple = target.querySelector(".ripple-span") as HTMLElement;
    if (!ripple) {
      ripple = document.createElement("span");
      ripple.className = "ripple-span";
      target.appendChild(ripple);
    }

    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
  };

  if (loading) {
    return (
      <Button variant="default" size="icon" disabled className="nav-button">
        <CubeSpinner />
      </Button>
    );
  }

  if (user) {
    return (
      <>
        <div className="relative">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className="rounded-full flex items-center justify-center nav-button"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatarUrl} alt={user.name} />
                  <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="sr-only">User Menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                    <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user.name}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <div
                  className="menu-item-ripple w-full"
                  onMouseMove={handleRippleEffect}
                >
                  <Link
                    href="/profile"
                    className="flex items-center cursor-pointer w-full h-full px-2 py-1.5"
                  >
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </Link>
                  <span className="ripple-span"></span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <div
                  className="menu-item-ripple w-full"
                  onMouseMove={handleRippleEffect}
                >
                  <Link
                    href="/settings"
                    className="flex items-center cursor-pointer w-full h-full px-2 py-1.5"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                  <span className="ripple-span"></span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowLogoutDialog(true)}
                className="menu-item-ripple"
                onMouseMove={handleRippleEffect}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
                <span className="ripple-span"></span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {user.role === "admin" && (
            <div className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-1 border-2 border-background z-10">
              <Cog className="h-3 w-3" />
            </div>
          )}
        </div>
        <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log out?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to log out of your account?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="focus-visible:ring-0 focus-visible:outline-none border-0">
                Cancel
              </AlertDialogCancel>
              <div className="px-2 pb-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 focus-visible:ring-0 focus-visible:outline-none border-0"
                  onClick={logout}
                >
                  Log out
                </Button>
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <Button
      onClick={() => login()}
      variant="default"
      size="icon"
      className="rounded-full nav-button"
    >
      <UserIcon className="h-5 w-5" />
      <span className="sr-only">Login</span>
    </Button>
  );
}
