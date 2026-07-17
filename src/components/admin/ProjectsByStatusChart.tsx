
"use client"

import { TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Project } from "@/lib/types"
import { useMemo } from "react"

const chartConfig = {
  count: {
    label: "Count",
  },
  pending: {
    label: "Pending",
    color: "hsl(var(--chart-1))",
  },
  approved: {
    label: "Approved",
    color: "hsl(var(--chart-2))",
  },
  featured: {
    label: "Featured",
    color: "hsl(var(--chart-3))",
  },
  funded: {
    label: "Funded",
    color: "hsl(var(--chart-4))",
  },
} satisfies ChartConfig

export function ProjectsByStatusChart({ projects }: { projects: Project[]}) {
  const chartData = useMemo(() => {
    const statuses: Project['status'][] = ['pending', 'approved', 'featured', 'funded'];
    return statuses.map(status => ({
        status: status.charAt(0).toUpperCase() + status.slice(1),
        count: projects.filter(p => p.status === status || (status === 'funded' && p.status === 'completed')).length,
        fill: `var(--color-${status})`
    }))
  }, [projects]);

  return (
    <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="status"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(value) => value.slice(0, 3)}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="dashed" />}
        />
        <Bar dataKey="count" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
