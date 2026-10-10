'use client';

import React from 'react';

interface TenantMetricsWidgetProps {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  totalStorageGB: number;
  totalUsers: number;
  totalMAU: number;
  platformGMV: number;
}

const METRICS = [
  {
    label: 'Total Companies',
    value: 'totalTenants',
    icon: '🏢',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  },
  {
    label: 'Active',
    value: 'activeTenants',
    icon: '✅',
    color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  {
    label: 'Trial',
    value: 'trialTenants',
    icon: '⏳',
    color: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  {
    label: 'Suspended',
    value: 'suspendedTenants',
    icon: '⚠️',
    color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  },
  {
    label: 'Storage (GB)',
    value: 'totalStorageGB',
    icon: '💾',
    color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    format: (v: number) => v.toLocaleString(),
  },
  {
    label: 'Total Users',
    value: 'totalUsers',
    icon: '👥',
    color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    format: (v: number) => v.toLocaleString(),
  },
  {
    label: 'Monthly Active Users',
    value: 'totalMAU',
    icon: '📈',
    color: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    format: (v: number) => v.toLocaleString(),
  },
  {
    label: 'Platform GMV (THB)',
    value: 'platformGMV',
    icon: '💰',
    color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    format: (v: number) => `฿${v.toLocaleString()}`,
  },
];

export const TenantMetricsWidget: React.FC<TenantMetricsWidgetProps> = ({
  totalTenants,
  activeTenants,
  trialTenants,
  suspendedTenants,
  totalStorageGB,
  totalUsers,
  totalMAU,
  platformGMV,
}) => {
  const metrics = [
    totalTenants,
    activeTenants,
    trialTenants,
    suspendedTenants,
    totalStorageGB,
    totalUsers,
    totalMAU,
    platformGMV,
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
      {METRICS.map((metric, index) => (
        <div
          key={metric.value}
          className={`p-4 rounded-xl border ${metric.color} transition-all hover:shadow-md`}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl">{metric.icon}</span>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{metric.label}</p>
          </div>
          <div className="mt-2">
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {metric.format ? metric.format(metrics[index]) : metrics[index].toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TenantMetricsWidget;