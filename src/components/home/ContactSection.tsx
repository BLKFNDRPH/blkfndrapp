"use client";

import { useState } from "react";
import { Github, Mail, Send, ShieldAlert, HardHat } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Every address the landing page hands out, in one place. There is no contact
 * inbox wired into the app, so the form composes a message and hands it to the
 * visitor's own mail client rather than pretending to deliver it. Point these at
 * real mailboxes before launch.
 */
export const CONTACT = {
  general: "hello@blkfndr.com",
  builders: "builders@blkfndr.com",
  security: "security@blkfndr.com",
  repo: "https://github.com/BLKFNDRPH/blkfndrapp",
};

const CHANNELS = [
  {
    icon: Mail,
    title: "General enquiries",
    body: "Questions about the platform, partnerships, or anything that does not fit the boxes below.",
    action: CONTACT.general,
    href: `mailto:${CONTACT.general}`,
  },
  {
    icon: HardHat,
    title: "Builders and developers",
    body: "Planning a raise, or want your project reviewed before you post it. Bring the blueprints, the timeline and the funding goal.",
    action: CONTACT.builders,
    href: `mailto:${CONTACT.builders}`,
  },
  {
    icon: ShieldAlert,
    title: "Security disclosures",
    body: "Found something in the contracts or the app. Report it privately first and give us a window to fix it before you publish.",
    action: CONTACT.security,
    href: `mailto:${CONTACT.security}`,
  },
  {
    icon: Github,
    title: "Source and issues",
    body: "The contracts, the app and the docs are public. Read the code, open an issue, or check a deployment against the build hashes.",
    action: "BLKFNDRPH/blkfndrapp",
    href: CONTACT.repo,
  },
];

const TOPICS = [
  { value: "general", label: "General enquiry", to: CONTACT.general },
  { value: "builder", label: "I want to fund a build", to: CONTACT.builders },
  { value: "contributor", label: "Question about contributing", to: CONTACT.general },
  { value: "security", label: "Security disclosure", to: CONTACT.security },
];

export function ContactSection() {
  const [topic, setTopic] = useState("general");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const selected = TOPICS.find((t) => t.value === topic) ?? TOPICS[0];

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const subject = `[blkfndr] ${selected.label}${name ? ` — ${name}` : ""}`;
    const body = [
      message,
      "",
      "—",
      name ? `Name: ${name}` : null,
      email ? `Reply to: ${email}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n");

    window.location.href = `mailto:${selected.to}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <section
      id="contact"
      className="relative scroll-mt-20 border-t bg-card py-20 sm:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Contact"
          title="Talk to the people building it"
          lead="Whether you are bringing a project to BLKFNDR, weighing up a stake in one, or you have found a hole in the contracts, there is a direct way to reach us."
        />

        <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {CHANNELS.map(({ icon: Icon, title, body, action, href }) => (
              <a
                key={title}
                href={href}
                {...(href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="group flex gap-4 rounded-xl border bg-background p-5 transition-all hover:border-accent/50 hover:shadow-md"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-headline text-base font-semibold">
                    {title}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                    {body}
                  </span>
                  <span className="mt-2 block break-all font-code text-xs text-accent group-hover:underline">
                    {action}
                  </span>
                </span>
              </a>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-xl border bg-background p-6 sm:p-8"
          >
            <h3 className="font-headline text-lg font-semibold">
              Send us a message
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This composes the message and opens it in your own mail client, so
              nothing is stored here and you keep a copy of what you sent.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="contact-name">Name</Label>
                <Input
                  id="contact-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contact-email">Email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              <Label htmlFor="contact-topic">What is this about</Label>
              <Select value={topic} onValueChange={setTopic}>
                <SelectTrigger id="contact-topic">
                  <SelectValue placeholder="Choose a topic" />
                </SelectTrigger>
                <SelectContent>
                  {TOPICS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Goes to{" "}
                <span className="font-code text-accent">{selected.to}</span>
              </p>
            </div>

            <div className="mt-4 grid gap-2">
              <Label htmlFor="contact-message">Message</Label>
              <Textarea
                id="contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                required
                placeholder="Tell us what you are working on, or what you need to know."
              />
            </div>

            <Button type="submit" size="lg" className="mt-6 w-full sm:w-auto">
              <Send className="h-4 w-4" />
              Open in my mail client
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
