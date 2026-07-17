"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Bell, ExternalLink, X, Briefcase, MessageSquareText } from 'lucide-react';
import type { Notification, Project } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import Link from 'next/link';
import { useProjectDetails } from '@/context/ProjectDetailsContext';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useProjects } from '@/context/BlockchainContext';
import { getProjectById } from '@/lib/data.client';

const POLL_INTERVAL = 60_000; // 60 seconds

export function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { openProjectDetails } = useProjectDetails();
  const { getProjectById: getProjectFromContext } = useProjects();
  const [isReasonDialogOpen, setIsReasonDialogOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data: Notification[] = await res.json();
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.isRead).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [user]);

  // Initial fetch + polling every 60s
  useEffect(() => {
    if (!user) return;

    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, fetchNotifications]);

  // Listen for client-side refresh notifications event
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      fetchNotifications();
    };
    window.addEventListener('refresh-notifications', handleRefresh);
    return () => {
      window.removeEventListener('refresh-notifications', handleRefresh);
    };
  }, [fetchNotifications]);

  const handleOpenChange = async (open: boolean) => {
    if (open && unreadCount > 0) {
      const unreadIds = notifications.filter(n => !n.isRead).map(n => n.id);
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: unreadIds }),
        });
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setUnreadCount(0);
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }
  };

  const handleDismiss = async (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await fetch(`/api/notifications?id=${notificationId}`, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      setUnreadCount(prev => {
        const notif = notifications.find(n => n.id === notificationId);
        return notif && !notif.isRead ? prev - 1 : prev;
      });
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  const handleDismissAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) return;
    try {
      await fetch(`/api/notifications?all=true`, { method: 'DELETE' });
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to dismiss all notifications:', err);
    }
  };

  const handleViewProject = async (e: React.MouseEvent, objectId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const project = getProjectFromContext(objectId) || await getProjectById(objectId);
    if (project) openProjectDetails(project);
  };

  const handleViewReason = (e: React.MouseEvent, notif: Notification) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedNotification(notif);
    setIsReasonDialogOpen(true);
  };

  const handleRippleEffect = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget as HTMLElement;
    let ripple = target.querySelector('.ripple-span') as HTMLElement;
    if (!ripple) {
      ripple = document.createElement('span');
      ripple.className = 'ripple-span';
      target.appendChild(ripple);
    }
    const rect = target.getBoundingClientRect();
    ripple.style.left = `${e.clientX - rect.left}px`;
    ripple.style.top = `${e.clientY - rect.top}px`;
  };

  const getFirstSentence = (text: string): string => {
    if (!text) return '';
    const match = text.match(/[^.]+\./);
    return match ? match[0].trim() : text;
  };

  const formatReasonForPopup = (text: string | undefined): React.ReactNode => {
    if (!text) return null;
    const match = text.match(/[^.]+\./);
    if (match) {
      const first = match[0].trim();
      const rest = text.substring(match[0].length).trim();
      return <>{first}{rest && <><br /><br />{rest}</>}</>;
    }
    return text;
  };

  if (!user) return null;

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <div className="relative">
            <Button variant="default" size="icon" className="rounded-full nav-button">
              <Bell className="h-4 w-4" />
              <span className="sr-only">Notifications</span>
            </Button>
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4 h-5 w-5 justify-center p-0"
              >
                {unreadCount}
              </Badge>
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-96" align="end">
          <div className="flex items-center justify-between pr-2">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismissAll}
              disabled={notifications.length === 0}
              className="text-xs"
            >
              Clear
            </Button>
          </div>
          <DropdownMenuSeparator />
          <ScrollArea className="h-[300px]">
            {notifications.length > 0 ? (
              notifications.map((notif) => (
                <DropdownMenuItem key={notif.id} asChild className="p-0 group menu-item-ripple focus:bg-transparent">
                  <div className="w-full" onMouseMove={handleRippleEffect}>
                    <div className="flex items-start gap-3 relative w-full p-3">
                      {!notif.isRead && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-accent" />
                      )}
                      <div className={cn("flex-grow min-w-0 space-y-1", !notif.isRead && "pl-4")}>
                        <p className="font-semibold whitespace-normal">{notif.title}</p>
                        <p className="text-sm text-muted-foreground whitespace-normal break-words group-focus:text-accent-foreground truncate">
                          {notif.title.includes('Removed') ? getFirstSentence(notif.caption) : notif.caption}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          {notif.object && (
                            <Button asChild variant="secondary" size="sm" className="h-7 group-focus:bg-primary/20 group-focus:text-accent-foreground group-focus:hover:bg-primary/30" onClick={(e) => handleViewProject(e, notif.object!)}>
                              <Link href="#">
                                <Briefcase className="mr-2 h-3 w-3" />
                                View Project
                              </Link>
                            </Button>
                          )}
                          {notif.url && (
                            <Button asChild variant="secondary" size="sm" className="h-7 group-focus:bg-primary/20 group-focus:text-accent-foreground group-focus:hover:bg-primary/30">
                              <Link href={notif.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                                <ExternalLink className="mr-2 h-3 w-3" />
                                View Transaction
                              </Link>
                            </Button>
                          )}
                          {!notif.url && !notif.object && (
                            <Button variant="secondary" size="sm" className="h-7 group-focus:bg-primary/20 group-focus:text-accent-foreground group-focus:hover:bg-primary/30" onClick={(e) => handleViewReason(e, notif)}>
                              <MessageSquareText className="mr-2 h-3 w-3" />
                              View Reason
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground pt-1 group-focus:text-accent-foreground">
                          {formatDistanceToNow(notif.timestamp, { addSuffix: true })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-6 w-6 shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100"
                        onClick={(e) => handleDismiss(e, notif.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="ripple-span"></span>
                  </div>
                </DropdownMenuItem>
              ))
            ) : (
              <div className="text-center text-sm text-muted-foreground py-4">
                No notifications yet.
              </div>
            )}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isReasonDialogOpen} onOpenChange={setIsReasonDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedNotification?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground whitespace-pre-wrap">
              {formatReasonForPopup(selectedNotification?.caption)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedNotification(null)}>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}