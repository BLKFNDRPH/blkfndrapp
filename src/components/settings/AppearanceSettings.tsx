
"use client"

import { useTheme } from "next-themes"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
} from "@/components/ui/form"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { Laptop, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const appearanceFormSchema = z.object({
  theme: z.enum(["light", "dark", "system"], {
    required_error: "Please select a theme.",
  }),
})

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>

export function AppearanceSettings({ isMenu = false }: { isMenu?: boolean }) {
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const [isMounted, setIsMounted] = useState(false);

  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
  })

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && theme) {
      form.reset({
        theme: (theme as "light" | "dark" | "system") || "system",
      })
    }
  }, [theme, form, isMounted])

  function onSubmit(data: AppearanceFormValues) {
    setTheme(data.theme)
    if (!isMenu) {
        toast({
            title: "Theme Updated",
            description: `Switched to ${data.theme.charAt(0).toUpperCase() + data.theme.slice(1)} theme.`,
        })
    }
  }

  const handleRippleEffect = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget as HTMLElement;
    let ripple = target.querySelector('.ripple-span') as HTMLElement;
    if (!ripple) {
        ripple = document.createElement('span');
        ripple.className = 'ripple-span';
        target.appendChild(ripple);
    }
    
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
  };

  if (!isMounted) {
    return null;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="theme"
          render={({ field }) => (
            <FormItem className="space-y-3">
              {!isMenu && (
                <>
                    <FormLabel>Theme</FormLabel>
                    <FormDescription>
                        Select the theme for the dashboard.
                    </FormDescription>
                </>
              )}
              <FormControl>
                {isMenu ? (
                  <RadioGroup
                    onValueChange={(value) => {
                      field.onChange(value);
                      setTheme(value);
                    }}
                    defaultValue={field.value}
                    className="flex justify-around items-center rounded-lg bg-muted p-1"
                  >
                    <FormItem className="w-20">
                      <div className="menu-item-ripple" onMouseMove={handleRippleEffect}>
                        <FormLabel className={cn("flex flex-col items-center justify-center gap-1 rounded-md p-2 cursor-pointer", field.value === 'light' && "bg-accent text-accent-foreground shadow-sm")}>
                          <FormControl>
                            <RadioGroupItem value="light" className="sr-only" />
                          </FormControl>
                          <Sun className="h-5 w-5" />
                          <span className="text-xs">Light</span>
                        </FormLabel>
                        <span className="ripple-span"></span>
                      </div>
                    </FormItem>
                     <FormItem className="w-20">
                       <div className="menu-item-ripple" onMouseMove={handleRippleEffect}>
                        <FormLabel className={cn("flex flex-col items-center justify-center gap-1 rounded-md p-2 cursor-pointer", field.value === 'dark' && "bg-accent text-accent-foreground shadow-sm")}>
                          <FormControl>
                            <RadioGroupItem value="dark" className="sr-only" />
                          </FormControl>
                          <Moon className="h-5 w-5" />
                          <span className="text-xs">Dark</span>
                        </FormLabel>
                        <span className="ripple-span"></span>
                      </div>
                    </FormItem>
                     <FormItem className="w-20">
                       <div className="menu-item-ripple" onMouseMove={handleRippleEffect}>
                        <FormLabel className={cn("flex flex-col items-center justify-center gap-1 rounded-md p-2 cursor-pointer", field.value === 'system' && "bg-accent text-accent-foreground shadow-sm")}>
                          <FormControl>
                            <RadioGroupItem value="system" className="sr-only" />
                          </FormControl>
                          <Laptop className="h-5 w-5" />
                          <span className="text-xs">System</span>
                        </FormLabel>
                        <span className="ripple-span"></span>
                      </div>
                    </FormItem>
                  </RadioGroup>
                ) : (
                <RadioGroup
                  onValueChange={(value) => {
                    field.onChange(value);
                    setTheme(value);
                  }}
                  defaultValue={field.value}
                  className="grid max-w-md grid-cols-1 pt-2 md:grid-cols-3 gap-8"
                >
                  <FormItem>
                    <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer">
                      <FormControl>
                        <RadioGroupItem value="light" className="sr-only" />
                      </FormControl>
                      <div className="items-center rounded-md border-2 border-muted p-1 hover:border-accent">
                        <div className="space-y-2 rounded-sm bg-[#ecedef] p-2">
                          <div className="space-y-2 rounded-md bg-white p-2 shadow-sm">
                            <div className="h-2 w-[80px] rounded-lg bg-[#ecedef]" />
                            <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                          </div>
                          <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-[#ecedef]" />
                            <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                          </div>
                          <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-[#ecedef]" />
                            <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                          </div>
                        </div>
                      </div>
                       <span className="block w-full p-2 text-center font-normal">
                        Light
                      </span>
                    </FormLabel>
                  </FormItem>
                  <FormItem>
                    <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer">
                      <FormControl>
                        <RadioGroupItem value="dark" className="sr-only" />
                      </FormControl>
                      <div className="items-center rounded-md border-2 border-muted bg-popover p-1 hover:border-accent">
                        <div className="space-y-2 rounded-sm bg-slate-950 p-2">
                          <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-sm">
                            <div className="h-2 w-[80px] rounded-lg bg-slate-400" />
                            <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                          </div>
                          <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-slate-400" />
                            <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                          </div>
                          <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                            <div className="h-4 w-4 rounded-full bg-slate-400" />
                            <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                          </div>
                        </div>
                      </div>
                      <span className="block w-full p-2 text-center font-normal">
                        Dark
                      </span>
                    </FormLabel>
                  </FormItem>
                  <FormItem>
                    <FormLabel className="[&:has([data-state=checked])>div]:border-primary cursor-pointer">
                      <FormControl>
                        <RadioGroupItem value="system" className="sr-only" />
                      </FormControl>
                      <div className="items-center rounded-md border-2 border-muted p-1 hover:border-accent">
                        <div className="flex items-center justify-center h-[116px] bg-muted rounded-md">
                           <Laptop className="h-10 w-10 text-muted-foreground" />
                        </div>
                      </div>
                       <span className="block w-full p-2 text-center font-normal">
                        System
                      </span>
                    </FormLabel>
                  </FormItem>
                </RadioGroup>
                )}
              </FormControl>
            </FormItem>
          )}
        />
        
        {!isMenu && <Button type="submit">Update Theme</Button>}
      </form>
    </Form>
  )
}
