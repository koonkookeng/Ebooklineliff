'use client';

import React, { useState } from 'react';

// Zero-new-deps date label (date-fns is NOT installed): 'MMM dd, yyyy'.
export function formatTenantDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

interface TenantCompany {
  id: string;
  name: string;
  slug: string;
  status: string;
  packageTier: string;
  contactEmail: string;
  primaryColor: string;
  maxUsers: number;
  maxMonthlyLiffMAU: number;
  domains: Array<{ domain: string; status: string; isPrimary: boolean }>;
  activeSubscription?: { packageTier: string; monthlyFee: number; expiresAt: string } | null;
  domainCount: number;
  createdAt: string;
}

interface TenantListTableProps {
  tenants: TenantCompany[];
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onStatusChange: (tenantId: string, status: string) => void;
  onPackageChange: (tenantId: string, packageTier: string) => void;
  onDomainVerify: (tenantId: string, domain: string) => void;
  onCachePurge: (tenantId: string) => void;
  onViewDetail: (tenantId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PENDING_KYC: 'bg-yellow-100 text-yellow-800',
  TRIAL_ACTIVE: 'bg-blue-100 text-blue-800',
  TRIAL_EXPIRED: 'bg-orange-100 text-orange-800',
  SUSPENDED_PAYMENT_OVERDUE: 'bg-red-100 text-red-800',
  SUSPENDED_POLICY_VIOLATION: 'bg-red-100 text-red-800',
  MAINTENANCE: 'bg-gray-100 text-gray-800',
};

const TIER_COLORS: Record<string, string> = {
  STARTER_FREE: 'bg-gray-100 text-gray-800',
  PRO_CREATOR: 'bg-blue-100 text-blue-800',
  ENTERPRISE_ACADEMY: 'bg-purple-100 text-purple-800',
  CUSTOM_WHITE_LABEL: 'bg-amber-100 text-amber-800',
};

const DOMAIN_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PENDING_DNS: 'bg-yellow-100 text-yellow-800',
  PROVISIONING_SSL: 'bg-blue-100 text-blue-800',
  FAILED_DNS_NOT_FOUND: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING_KYC', label: 'Pending KYC' },
  { value: 'TRIAL_ACTIVE', label: 'Trial Active' },
  { value: 'TRIAL_EXPIRED', label: 'Trial Expired' },
  { value: 'SUSPENDED_PAYMENT_OVERDUE', label: 'Suspended - Payment' },
  { value: 'SUSPENDED_POLICY_VIOLATION', label: 'Suspended - Policy' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
];

const TIER_OPTIONS = [
  { value: 'STARTER_FREE', label: 'Starter Free' },
  { value: 'PRO_CREATOR', label: 'Pro Creator' },
  { value: 'ENTERPRISE_ACADEMY', label: 'Enterprise Academy' },
  { value: 'CUSTOM_WHITE_LABEL', label: 'Custom White Label' },
];

export const TenantListTable: React.FC<TenantListTableProps> = ({
  tenants,
  page,
  limit,
  total,
  onPageChange,
  onStatusChange,
  onPackageChange,
  onDomainVerify,
  onCachePurge,
  onViewDetail,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});

  const filteredTenants = tenants.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (tierFilter && t.packageTier !== tierFilter) return false;
    if (searchFilter) {
      const search = searchFilter.toLowerCase();
      return (
        t.name.toLowerCase().includes(search) ||
        t.slug.toLowerCase().includes(search) ||
        t.contactEmail.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleActionStart = (tenantId: string) => {
    setLoadingActions((prev) => ({ ...prev, [tenantId]: true }));
  };

  const handleActionEnd = (tenantId: string) => {
    setLoadingActions((prev) => ({ ...prev, [tenantId]: false }));
  };

  const primaryDomain = (t: TenantCompany) => t.domains.find((d) => d.isPrimary)?.domain || '-';

  const domainBadges = (t: TenantCompany) =>
    t.domains.map((d) => (
      <span
        key={d.domain}
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-1 mb-1 ${DOMAIN_STATUS_COLORS[d.status] || 'bg-gray-100 text-gray-800'}`}
      >
        {d.domain} {d.isPrimary && <span className="ml-1">★</span>}
        <span className="ml-1 text-xs opacity-70">({d.status})</span>
      </span>
    ));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by name, slug, email..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[180px]"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[180px]"
          >
            <option value="">All Tiers</option>
            {TIER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Company</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Slug</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Tier</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Primary Domain</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Users / MAU</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {filteredTenants.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: tenant.primaryColor }}
                    >
                      {tenant.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{tenant.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{tenant.contactEmail}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{tenant.slug}</code>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={tenant.status}
                    onChange={(e) => {
                      handleActionStart(tenant.id);
                      onStatusChange(tenant.id, e.target.value);
                      setTimeout(() => handleActionEnd(tenant.id), 500);
                    }}
                    disabled={loadingActions[tenant.id]}
                    className={`text-xs px-2 py-1 rounded border-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${STATUS_COLORS[tenant.status] || 'bg-gray-100 text-gray-800'}`}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={tenant.packageTier}
                    onChange={(e) => {
                      handleActionStart(tenant.id);
                      onPackageChange(tenant.id, e.target.value);
                      setTimeout(() => handleActionEnd(tenant.id), 500);
                    }}
                    disabled={loadingActions[tenant.id]}
                    className={`text-xs px-2 py-1 rounded border-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${TIER_COLORS[tenant.packageTier] || 'bg-gray-100 text-gray-800'}`}
                  >
                    {TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {domainBadges(tenant)}
                    {tenant.domainCount > 3 && (
                      <span className="px-2 py-0.5 rounded text-xs text-slate-500 dark:text-slate-400">
                        +{tenant.domainCount - 3} more
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                  <div>{tenant.activeSubscription?.packageTier || 'No active subscription'}</div>
                  <div className="text-xs text-slate-400">
                    Users: {tenant.maxUsers.toLocaleString()} | MAU: {tenant.maxMonthlyLiffMAU.toLocaleString()}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                  {formatTenantDate(tenant.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onViewDetail(tenant.id)}
                      className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                    >
                      View
                    </button>
                    <button
                      onClick={() => {
                        handleActionStart(tenant.id);
                        onCachePurge(tenant.id);
                        setTimeout(() => handleActionEnd(tenant.id), 1000);
                      }}
                      disabled={loadingActions[tenant.id]}
                      className="px-3 py-1.5 text-xs bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                      Purge Cache
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredTenants.length === 0 && (
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">
          No tenants found matching your criteria.
        </div>
      )}

      <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Showing {filteredTenants.length} of {total} tenants
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400">
            Page {page} of {Math.ceil(total / limit)}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= Math.ceil(total / limit)}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default TenantListTable;