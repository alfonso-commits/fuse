"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ChannelBarChartProps {
  data: { channel: string; visitors: number; sessions: number }[];
}

export function ChannelBarChart({ data }: ChannelBarChartProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-4">
        Visitors by Channel
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 120 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="channel" width={110} fontSize={12} />
          <Tooltip />
          <Bar dataKey="visitors" fill="#3b82f6" name="Visitors" />
          <Bar dataKey="sessions" fill="#93c5fd" name="Sessions" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
