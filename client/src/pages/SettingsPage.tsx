import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api';
import type { Settings } from '../lib/types';
import { Button, Card, Input, Loading, PageHeader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/toast';

export default function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const [f, setF] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return <Loading />;
  const set = (k: keyof Settings) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/settings', {
        shopName: f.shopName, address: f.address, phone: f.phone, email: f.email, receiptWidth: Number(f.receiptWidth), defaultPrintFormat: f.defaultPrintFormat,
        receiptFooter: f.receiptFooter, warrantyPolicy: f.warrantyPolicy, taxLabel: f.taxLabel, taxRate: Number(f.taxRate), taxRegNo: f.taxRegNo,
        invoicePrefix: f.invoicePrefix, currency: f.currency, language: f.language, logoUrl: f.logoUrl,
      });
      toast('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };

  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    try { const s = await api.post<Settings>('/settings/logo', fd); setF({ ...f, logoUrl: s.logoUrl }); toast('Logo uploaded'); qc.invalidateQueries({ queryKey: ['settings'] }); }
    catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <form onSubmit={save}>
      <PageHeader title="Settings" subtitle="Business details and invoice layout" actions={<Button type="submit" loading={busy}>Save settings</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Business">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Input label="Shop name" value={f.shopName} onChange={set('shopName')} required wrapClass="sm:col-span-2" />
            <Input label="Address" value={f.address} onChange={set('address')} wrapClass="sm:col-span-2" />
            <Input label="Telephone" value={f.phone} onChange={set('phone')} />
            <Input label="Email" value={f.email} onChange={set('email')} />
            <div className="sm:col-span-2">
              <span className="label">Logo (PNG/JPG, up to 1 MB)</span>
              <div className="flex items-center gap-3">
                {f.logoUrl && <img src={f.logoUrl} alt="Shop logo" className="h-14 w-14 rounded border object-contain" />}
                <input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                {f.logoUrl && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, logoUrl: null })}>Remove</Button>}
              </div>
            </div>
          </div>
        </Card>
        <Card title="Invoices and receipts">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Select label="Default print format" value={f.defaultPrintFormat} onChange={set('defaultPrintFormat')}><option value="80">80 mm thermal</option><option value="58">58 mm thermal</option><option value="A4">A4 invoice</option></Select>
            <Select label="Thermal receipt width" value={String(f.receiptWidth)} onChange={set('receiptWidth')}><option value="80">80 mm</option><option value="58">58 mm</option></Select>
            <Input label="Invoice number prefix" value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value.toUpperCase() })} hint="e.g. YM gives YM-2026-000001" />
            <Input label="Currency label" value={f.currency} onChange={set('currency')} />
            <Select label="Invoice language" value={f.language} onChange={set('language')} hint="Sinhala templates are planned; English is used for now"><option value="en">English</option><option value="si" disabled>Sinhala (not yet available)</option></Select>
            <Input label="Receipt footer / thank-you message" value={f.receiptFooter} onChange={set('receiptFooter')} wrapClass="sm:col-span-2" />
            <Textarea label="Warranty policy (printed when a warranty item is sold)" value={f.warrantyPolicy} onChange={set('warrantyPolicy')} wrapClass="sm:col-span-2" />
          </div>
        </Card>
        <Card title="Tax">
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <Input label="Tax label" value={f.taxLabel} onChange={set('taxLabel')} />
            <Input label="Rate (%)" type="number" min={0} max={50} step="0.01" value={String(f.taxRate)} onChange={set('taxRate')} hint="0 = no tax line" />
            <Input label="Tax registration no." value={f.taxRegNo} onChange={set('taxRegNo')} />
            <p className="text-xs text-slate-500 sm:col-span-3">Tax is added on top of the discounted bill amount. Changing the rate affects new sales only; old invoices keep their stored tax.</p>
          </div>
        </Card>
      </div>
    </form>
  );
}
