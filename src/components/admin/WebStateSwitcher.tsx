"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WebState = "on-chain";

interface WebStateSwitcherProps {
  initialState: WebState;
}

export function WebStateSwitcher({ initialState }: WebStateSwitcherProps) {
  const [selectedValue, setSelectedValue] = useState<WebState>(initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Web State</CardTitle>
        <CardDescription>
          The application is currently running in "On-Chain" mode.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Select value={selectedValue} disabled>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select a web state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on-chain">On-Chain Data</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
