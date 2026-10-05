import { CreateTenantForm } from "@/components/create-tenant-form";

export default function NewTenantPage() { return <><p className="eyebrow">Platform / tenants</p><h1 className="page-title">Create a tenant.</h1><p className="page-intro">Set up the store boundary, invite its Store Owner, and attach the first subscription in one transaction.</p><CreateTenantForm /></>; }