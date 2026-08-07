"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useTransition } from "react";
import { CubeSpinner } from "../ui/CubeSpinner";
import { updateUserDisplayName } from "@/app/settings/actions";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
});

export function DisplayNameForm() {
  const { toast } = useToast();
  const { user, refreshUser } = useAuth();
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: user?.name || "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({ name: user.name });
    }
  }, [user, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      const result = await updateUserDisplayName(values.name);

      if (result.success) {
        await refreshUser();
        toast({
          title: "Settings Saved",
          description: "Your display name has been updated.",
        });
      } else {
        toast({
          title: "Error",
          description: result.error || "Could not update display name.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Name</FormLabel>
              <FormControl>
                <Input placeholder="Your display name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isPending}>
          {isPending && <CubeSpinner />}
          Save Changes
        </Button>
      </form>
    </Form>
  );
}