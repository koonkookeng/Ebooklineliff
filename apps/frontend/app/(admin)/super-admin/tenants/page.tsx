// SSOT Phase 108 §6.1 — Super Admin Tenants Console Page
// Canonical: apps/frontend/app/(admin)/super-admin/tenants/page.tsx
// - 5-state UI: TENANT_INIT, IDLE, LOADING, SUCCESS, ERROR
// - Virtualized table, metrics widget, provisioning drawer, lifecycle switcher
// - Zero new deps (uses existing UI components)
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TenantListTable } from '@/components/super-admin/tenants/TenantListTable';
import { TenantMetricsWidget } from '@/components/super-admin/tenants/TenantMetricsWidget';
import { TenantProvisioningDrawer } from '@/components/super-admin/tenants/TenantProvisioningDrawer';

type TenantUiState = 'TENANT_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface TenantCompany {
  id: string;
  name: string;
  slug: string;
  status: string;
  packageTier: string;
  contactEmail: string;
  primaryColor: string;
  maxUsers: number;
  maxStorageBytes: string;
  maxMonthlyLiffMAU: number;
  domains: Array<{ domain: string; status: string; isPrimary: boolean }>;
  activeSubscription?: { packageTier: string; monthlyFee: number; expiresAt: string } | null;
  domainCount: number;
  createdAt: string;
}

interface TenantsResponse {
  items: TenantCompany[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface MetricsResponse {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  totalStorageGB: number;
  totalUsers: number;
  totalMAU: number;
  platformGMV: number;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

export default function SuperAdminTenantsPage() {
  const [uiState, setUiState] = useState<TenantUiState>('TENANT_INIT');
  const [tenants, setTenants] = useState<TenantCompany[]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: '', packageTier: '', search: '' });
  const [isProvisioningDrawerOpen, setIsProvisioningDrawerOpen] = useState(false);
  const [provisioningLoading, setProvisioningLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchTenants = useCallback(async () => {
    setUiState('LOADING');
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(filters.status && { status: filters.status }),
        ...(filters.packageTier && { packageTier: filters.packageTier }),
        ...(filters.search && { search: filters.search }),
      });

      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants?${params}`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });

      if (!res.ok) throw new Error(`Failed to fetch tenants: ${res.status}`);

      const data: TenantsResponse = await res.json();
      setTenants(data.items);
      setTotal(data.meta.total);
      setUiState('IDLE');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
      setUiState('ERROR');
    }
  }, [page, limit, filters]);

  const fetchMetrics = useCallback(async () => {
    try {
      // This would be a separate metrics endpoint in a real implementation
      // For now, compute from tenants data
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants?limit=1000`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data: TenantsResponse = await res.json();
        const items = data.items;
        setMetrics({
          totalTenants: items.length,
          activeTenants: items.filter((t) => t.status === 'ACTIVE').length,
          trialTenants: items.filter((t) => t.status === 'TRIAL_ACTIVE').length,
          suspendedTenants: items.filter((t) =>
            t.status.startsWith('SUSPENDED')
          ).length,
          totalStorageGB: items.reduce((sum, t) => sum + Number(t.maxStorageBytes) / 1e9, 0),
          totalUsers: items.reduce((sum, t) => sum + t.maxUsers, 0),
          totalMAU: items.reduce((sum, t) => sum + t.maxMonthlyLiffMAU, 0),
          platformGMV: 0, // Would come from finance module
        });
      }
    } catch {
      // Metrics are optional
    }
  }, []);

  useEffect(() => {
    fetchTenants();
    fetchMetrics();
  }, [fetchTenants, fetchMetrics]);

  const handleStatusChange = async (tenantId: string, status: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants/${tenantId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, reason: 'Status updated via console' }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setSuccessMessage(`Status updated to ${status}`);
      fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handlePackageChange = async (tenantId: string, packageTier: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants/${tenantId}/package`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ packageTier }),
      });
      if (!res.ok) throw new Error('Failed to update package');
      setSuccessMessage(`Package updated to ${packageTier}`);
      fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update package');
    }
  };

  const handleDomainVerify = async (tenantId: string, domain: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants/${tenantId}/domains/${domain}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to verify domain');
      setSuccessMessage(`Domain verification initiated for ${domain}`);
      fetchTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify domain');
    }
  };

  const handleCachePurge = async (tenantId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants/${tenantId}/cache/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) throw new Error('Failed to purge cache');
      setSuccessMessage('Cache purged successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to purge cache');
    }
  };

  const handleProvisionTenant = async (data: any) => {
    setProvisioningLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/super-admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to provision tenant');
      }
      setSuccessMessage(`Tenant "${data.companyName}" provisioned successfully!`);
      setIsProvisioningDrawerOpen(false);
      setUiState('SUCCESS');
      fetchTenants();
      window.setTimeout(() => setUiState('IDLE'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to provision tenant');
    } finally {
      setProvisioningLoading(false);
    }
  };

  const handleViewDetail = (tenantId: string) => {
    // Navigate to detail page or open modal
    window.location.href = `/super-admin/tenants/${tenantId}`;
  };

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              Tenant Orchestration Console
            </h1>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              Manage companies, packages, domains, and quotas across the platform
            </p>
          </div>
          <button
            onClick={() => setIsProvisioningDrawerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Provision New Tenant
          </button>
        </div>

        {/* Messages */}
        {(error || successMessage) && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-lg border" role="alert">
            {error && (
              <>
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="text-red-600 dark:text-red-400 flex-1">{error}</span>
                <button onClick={clearMessages} className="text-slate-500 hover:text-slate-700">×</button>
              </>
            )}
            {successMessage && (
              <>
                <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-emerald-600 dark:text-emerald-400 flex-1">{successMessage}</span>
                <button onClick={clearMessages} className="text-slate-500 hover:text-slate-700">×</button>
              </>
            )}
          </div>
        )}

        {/* Metrics Widget */}
        {metrics && <TenantMetricsWidget {...metrics} />}

        {/* Skeleton during first load (TENANT_INIT) / refetch (LOADING) */}
        {(uiState === 'TENANT_INIT' || (uiState === 'LOADING' && tenants.length === 0)) && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-8 animate-pulse" aria-busy="true">
            <div className="h-6 w-1/3 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
            <div className="space-y-3">
              <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded" />
              <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded" />
              <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded" />
            </div>
          </div>
        )}

        {/* Tenant List Table */}
        <TenantListTable
          tenants={tenants}
          page={page}
          limit={limit}
          total={total}
          onPageChange={setPage}
          onStatusChange={handleStatusChange}
          onPackageChange={handlePackageChange}
          onDomainVerify={handleDomainVerify}
          onCachePurge={handleCachePurge}
          onViewDetail={handleViewDetail}
        />

        {/* Provisioning Drawer */}
        <TenantProvisioningDrawer
          isOpen={isProvisioningDrawerOpen}
          onClose={() => setIsProvisioningDrawerOpen(false)}
          onSubmit={handleProvisionTenant}
          loading={provisioningLoading}
        />
      </div>
    </div>
  );
}