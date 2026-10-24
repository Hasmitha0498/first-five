import type { ProjectDetail } from "@firstfive/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Field, Input, PageHeader, Textarea } from "../../components/ui";
import { errorMessage, fieldErrors, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export function NewWebsitePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [websiteUrl, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const project = await post<ProjectDetail>("/api/projects", { name, websiteUrl, description: description || undefined });
      await Promise.all([qc.invalidateQueries({ queryKey: ["projects"] }), refresh()]);
      navigate(`/app/websites/${project.id}`);
    } catch (err) {
      setError({ message: errorMessage(err), code: (err as { code?: string }).code });
      setFields(fieldErrors(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={<Link to="/app/websites" className="hover:text-ink">← Websites</Link>} title="Which website do you want to test?" description="You'll add a small piece of code to it next." />
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && (
            <Alert tone="danger" action={error.code === "entitlement_limit" ? <Link to="/app/settings" className="font-medium underline">Settings</Link> : undefined}>
              {error.message}
            </Alert>
          )}
          <Field label="Website name" hint="A name you'll recognize, like “Acme Notes”." error={fields.name}>
            {(p) => <Input {...p} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Website address" hint="The public address people visit, e.g. https://acme.app" error={fields.websiteUrl}>
            {(p) => <Input {...p} type="url" inputMode="url" required placeholder="https://" value={websiteUrl} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
          <Field label="Short description" optional error={fields.description}>
            {(p) => <Textarea {...p} rows={3} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate("/app/websites")}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Continue
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
