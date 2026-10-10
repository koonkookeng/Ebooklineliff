'use client';

import React, { useState, useEffect } from 'react';
// Zero-new-deps close glyph (lucide-react is NOT installed): inline SVG.

interface TenantProvisioningDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTenantData) => Promise<void>;
  loading?: boolean;
}

interface CreateTenantData {
  companyName: string;
  slug: string;
  packageTier: string;
  primaryContactEmail: string;
  contactPhone?: string;
  logoUrl?: string;
  primaryColor?: string;
  customDomains: string[];
}

const TIER_OPTIONS = [
  { value: 'STARTER_FREE', label: 'Starter Free', desc: '10GB storage, 1,000 users, 5,000 MAU, no custom domains', price: 'Free' },
  { value: 'PRO_CREATOR', label: 'Pro Creator', desc: '100GB storage, 10,000 users, 25,000 MAU, 1 custom domain', price: '฿1,490/mo' },
  { value: 'ENTERPRISE_ACADEMY', label: 'Enterprise Academy', desc: '1TB storage, 100,000 users, 200,000 MAU, 3 custom domains', price: '฿14,900/mo' },
  { value: 'CUSTOM_WHITE_LABEL', label: 'Custom White Label', desc: '5TB storage, 999,999 users, 1M MAU, 10 custom domains', price: '฿49,900/mo' },
];

export const TenantProvisioningDrawer: React.FC<TenantProvisioningDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}) => {
  const [formData, setFormData] = useState<CreateTenantData>({
    companyName: '',
    slug: '',
    packageTier: 'STARTER_FREE',
    primaryContactEmail: '',
    contactPhone: '',
    logoUrl: '',
    primaryColor: '#10B981',
    customDomains: [],
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateTenantData, string>>>({});
  const [customDomainInput, setCustomDomainInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData({
        companyName: '',
        slug: '',
        packageTier: 'STARTER_FREE',
        primaryContactEmail: '',
        contactPhone: '',
        logoUrl: '',
        primaryColor: '#10B981',
        customDomains: [],
      });
      setErrors({});
      setCustomDomainInput('');
    }
  }, [isOpen]);

  const validateField = (name: string, value: string): string | undefined => {
    switch (name) {
      case 'companyName':
        if (!value.trim()) return 'Company name is required';
        if (value.length < 2 || value.length > 100) return 'Name must be 2-100 characters';
        break;
      case 'slug':
        if (!value.trim()) return 'Slug is required';
        if (!/^[a-z0-9-]+$/.test(value)) return 'Slug must be lowercase alphanumeric + hyphens only';
        if (value.length < 3 || value.length > 50) return 'Slug must be 3-50 characters';
        break;
      case 'primaryContactEmail':
        if (!value.trim()) return 'Contact email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email format';
        break;
      case 'customDomains':
        if (value && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return 'Invalid domain format';
        break;
    }
    return undefined;
  };

  const handleChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    const error = validateField(name, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleAddCustomDomain = () => {
    const error = validateField('customDomains', customDomainInput);
    if (error) {
      setErrors((prev) => ({ ...prev, customDomains: error }));
      return;
    }
    if (formData.customDomains.includes(customDomainInput)) {
      setErrors((prev) => ({ ...prev, customDomains: 'Domain already added' }));
      return;
    }
    setFormData((prev) => ({ ...prev, customDomains: [...prev.customDomains, customDomainInput] }));
    setCustomDomainInput('');
    setErrors((prev) => ({ ...prev, customDomains: undefined }));
  };

  const handleRemoveCustomDomain = (domain: string) => {
    setFormData((prev) => ({ ...prev, customDomains: prev.customDomains.filter((d) => d !== domain) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Partial<Record<keyof CreateTenantData, string>> = {};
    const companyErr = validateField('companyName', formData.companyName);
    if (companyErr) newErrors.companyName = companyErr;
    const slugErr = validateField('slug', formData.slug);
    if (slugErr) newErrors.slug = slugErr;
    const emailErr = validateField('primaryContactEmail', formData.primaryContactEmail);
    if (emailErr) newErrors.primaryContactEmail = emailErr;
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      await onSubmit(formData);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} />
        <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Provision New Tenant Company</h2>
              <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 max-h-[70vh] overflow-y-auto">
            <div className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => handleChange('companyName', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${errors.companyName ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'}`}
                    placeholder="Acme Corporation"
                  />
                  {errors.companyName && <p className="mt-1 text-xs text-red-500">{errors.companyName}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Slug <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) => handleChange('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${errors.slug ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'}`}
                    placeholder="acme-corp"
                  />
                  {errors.slug && <p className="mt-1 text-xs text-red-500">{errors.slug}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Primary Contact Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.primaryContactEmail}
                    onChange={(e) => handleChange('primaryContactEmail', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${errors.primaryContactEmail ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'}`}
                    placeholder="admin@acme.com"
                  />
                  {errors.primaryContactEmail && <p className="mt-1 text-xs text-red-500">{errors.primaryContactEmail}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.contactPhone}
                    onChange={(e) => handleChange('contactPhone', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="+66 2 123 4567"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Subscription Package <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {TIER_OPTIONS.map((tier) => (
                    <button
                      type="button"
                      onClick={() => handleChange('packageTier', tier.value)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        formData.packageTier === tier.value
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                          : 'border-slate-200 dark:border-slate-700 hover:border-emerald-300'
                      }`}
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">{tier.label}</div>
                      <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">{tier.price}</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tier.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Logo URL
                  </label>
                  <input
                    type="url"
                    value={formData.logoUrl}
                    onChange={(e) => handleChange('logoUrl', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="https://cdn.example.com/logo.png"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Primary Color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={formData.primaryColor}
                      onChange={(e) => handleChange('primaryColor', e.target.value)}
                      className="w-10 h-10 rounded border border-slate-300 dark:border-slate-600 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formData.primaryColor}
                      onChange={(e) => handleChange('primaryColor', e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="#10B981"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custom Domains (optional)
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={customDomainInput}
                    onChange={(e) => setCustomDomainInput(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="academy.acme.com"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomDomain}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
                  >
                    Add
                  </button>
                </div>
                {errors.customDomains && <p className="text-xs text-red-500 mb-2">{errors.customDomains}</p>}
                <div className="flex flex-wrap gap-2">
                  {formData.customDomains.map((domain) => (
                    <span key={domain} className="inline-flex items-center px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm">
                      {domain}
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomDomain(domain)}
                        className="ml-2 text-slate-500 hover:text-red-500"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Custom domains require CNAME pointing to <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">ingress.omnichannel-liff.com</code>. Verification is automatic after DNS propagation.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Provisioning...' : 'Provision Tenant'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TenantProvisioningDrawer;